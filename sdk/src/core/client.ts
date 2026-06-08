import { SuiJsonRpcClient as SuiClient } from '@mysten/sui/jsonRpc';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction, TransactionObjectInput, TransactionResult } from '@mysten/sui/transactions';
import { Keypair } from '@mysten/sui/cryptography';
import { EmodeGroupId, MarketData } from '../market-types/market';
import { fetchPythPrices } from '../utils/pyth-utils';
import { normalizeStructTag } from '@mysten/sui/utils';
import { ObligationData } from '../market-types/obligation';
import { AssetBorrow, AssetDeposit, TypeName } from '../market-types/assets';
import { Decimal } from '../market-types/decimal';
import { Signer, WalletAdapter, Market } from '../market-types';
import { LendingError } from '../market-types/errors';
import { NetworkConfig, getNetworkConfig, MarketWithEmodes, Env } from '../config/networks';
import { getPythConfig } from '../utils/pyth-utils';
import { simulateTransactionChecked, waitForTransaction } from '../utils/transaction-utils';
import { parseCoinDecimals } from '../utils/coin-metadata';
import { LiquidityMiningClient } from './liquidity-mining';
import { ReferralClient } from './referral';
import { SuiPriceServiceConnection, SuiPythClient } from '@pythnetwork/pyth-sui-js';
import { AssetPrice } from './query';
import { CachedQueryClient } from './cached-query';

export type TxnHash = string;

const DEFAULT_MAINNET_FULLNODE = 'https://fullnode.mainnet.sui.io:443';

export interface LendingClientConfig {
  network: 'mainnet',
  suiEndpoint?: string,
  pythEndpoint?: string,
}

export class LendingClient {
  readonly env: Env;
  readonly provider: SuiGrpcClient;
  readonly config: NetworkConfig;

  private network: 'mainnet';

  private pythConnnection: SuiPriceServiceConnection;
  private pythClient: SuiPythClient;

  private liquidityMiningClient: LiquidityMiningClient;
  private referralClient: ReferralClient;
  public readonly query: CachedQueryClient;

  private constructor(config: LendingClientConfig, provider: SuiGrpcClient, env = Env.Production) {
    this.network = config.network;
    this.config = getNetworkConfig(config.network);

    this.provider = provider;

    let pythUrl = config.pythEndpoint;

    const p = getPythConfig(config.network);
    if (!pythUrl) { pythUrl = p.hermesEndpoint; }
    
    const jsonRpcUrl = config.suiEndpoint || DEFAULT_MAINNET_FULLNODE;
    const jsonRpcProvider = new SuiClient({ url: jsonRpcUrl, network: 'mainnet' });
    this.pythClient = new SuiPythClient(jsonRpcProvider as any, p.pythStateId, p.wormholeStateId);
    this.pythConnnection = new SuiPriceServiceConnection(pythUrl);

    this.liquidityMiningClient = new LiquidityMiningClient(
      this.provider,
      this.config.protocolPackageId,
      this.config.protocolAppId,
    );
    this.referralClient = new ReferralClient(this.provider, this.config.protocolPackageId, this.config.protocolAppId);
    this.query = new CachedQueryClient(this.provider, this.config);
    this.env = env;
  }

  public static from(config: LendingClientConfig, provider: SuiGrpcClient): LendingClient {
    return new LendingClient(config, provider);
  }
  
  public static fromConfig(config: LendingClientConfig): LendingClient {
    const grpcUrl = config.suiEndpoint ?? DEFAULT_MAINNET_FULLNODE;
    return LendingClient.from(config, new SuiGrpcClient({ baseUrl: grpcUrl, network: 'mainnet' }));
  }

  public getNetwork(): 'mainnet' {
    return this.network;
  }

  /** Fetch latest Pyth prices for the given assets using the client's pyth connection. */
  public async fetchPythPrices(assets: TypeName[]): Promise<Map<TypeName, Decimal>> {
    return fetchPythPrices(this.pythConnnection, this.network, assets);
  }

  /** A util method to get just one emode group under a market */
  public async getEmodeGroupMarketSnapshot(
    marketType: TypeName,
    emodeGroupId: number,
    prices: AssetPrice[] = [],
  ): Promise<MarketData> {
    let assetPrices = prices;
    if (assetPrices.length === 0) {
      const assets = this.query.getSupportedAssets(marketType, emodeGroupId);
      const pythPrices = await fetchPythPrices(this.pythConnnection, this.network, assets);
      assetPrices = assets.map((assetType) => {
        const price = pythPrices.get(assetType);
        if (price === undefined) {
          throw new LendingError(
            `Pyth price not available for asset: ${assetType}`,
            { details: { assetType, marketType, emodeGroupId } },
          );
        }
        return { assetType, price };
      });
    }

    const assetTypes = assetPrices.map(p => p.assetType);
    const [assetResults, emodeGroup] = await Promise.all([
      this.query.getAssetsMarketOverview(marketType, assetPrices),
      this.query.getMarketEmodeGroupOverview(marketType, emodeGroupId, assetTypes),
    ]);

    const emodeGroups = new Map();
    emodeGroups.set(emodeGroupId, emodeGroup);
    return { assets: assetResults, emodeGroups };
  }

  public async getObligationDetail(
    obligationID: string,
    market: Market,
  ): Promise<ObligationData> {
    const marketType = market.typeName.startsWith('0x') ? market.typeName : `0x${market.typeName}`;
    const overview = await this.query.getObligationOverview(marketType, obligationID);

    const borrows: AssetBorrow[] = overview.borrows.map((b) => {
      const price = market.getBorrow(b.asset).price();
      const decimals = Decimal.fromString(`1${'0'.repeat(market.coinDecimal(b.asset))}`);
      const amount = b.debt.mul(market.borrowIndex(b.asset)).divDecimal(b.borrowIndex).ceiling();
      const usd = Decimal.fromBigInt(amount).mul(price).divDecimal(decimals);
      return new AssetBorrow({ coinType: b.asset, amount, usd, price }, b.borrowIndex);
    });
    const deposits: AssetDeposit[] = overview.deposits.map((d) => {
      const depositData = market.getDeposit(d.asset);
      const price = depositData.price();
      const exchangeRate = depositData.exchangeRate();
      const decimals = Decimal.fromString(`1${'0'.repeat(market.coinDecimal(d.asset))}`);
      const amount = exchangeRate.mulBigInt(d.ctokenAmount).asBigInt();
      const usd = Decimal.fromBigInt(amount).mul(price).divDecimal(decimals);
      return new AssetDeposit({ coinType: d.asset, amount, usd, price }, d.ctokenAmount, exchangeRate);
    });
    return { emodeGroupId: overview.emodeGroupId, borrows, deposits };
  }

  public async populateBorrowTransactionWithAllAssets(
    tx: Transaction,
    marketObjectId: string,
    marketType: TypeName,
    obligationOwnerCapId: string,

    coinType: TypeName,
    allAssets: TypeName[],
    
    borrowAmount: bigint,
    recipient: string,
  ): Promise<void> {
    if (!allAssets.includes(coinType)) {
      allAssets.push(coinType);
    }

    await this.refreshPythOracle(tx, allAssets);

    const [borrowedCoin] = tx.moveCall({
      target: `${this.config.protocolPackageId}::borrow::borrow`,
      arguments: [
        tx.object(this.config.protocolAppId),
        tx.object(obligationOwnerCapId),
        tx.object(marketObjectId),
        tx.object(this.config.coinDecimalsRegistryId),
        tx.pure.u64(borrowAmount),
        tx.object(this.config.xOracleId),
        tx.object('0x6'), // Clock object
      ],
      typeArguments: [marketType, coinType],
    });

    tx.transferObjects([borrowedCoin], recipient);
  }

  public async populateWithdrawTransactionWithAssets(
    tx: Transaction,
    marketObjectId: string,
    marketType: TypeName,
    obligationOwnerCapId: string,

    coinType: TypeName,
    allAssets: TypeName[],

    withdrawCtokenAmount: bigint,
  ): Promise<void> {
    if (!allAssets.includes(coinType)) {
      allAssets.push(coinType);
    }

    await this.refreshPythOracle(tx, allAssets);

    tx.moveCall({
      target: `${this.config.protocolPackageId}::withdraw::withdraw`,
      arguments: [
        tx.object(this.config.protocolAppId),
        tx.object(marketObjectId),
        tx.object(obligationOwnerCapId),
        tx.object(this.config.coinDecimalsRegistryId),
        tx.pure.u64(withdrawCtokenAmount),
        tx.object(this.config.xOracleId),
        tx.object('0x6'), // Clock object
      ],
      typeArguments: [marketType, coinType],
    });
  }

  public populateEnterMarketAndDepositTxn(
    txn: Transaction,
    marketObjectId: string,
    marketType: TypeName,
    coinType: TypeName,
    coinObjectId: TransactionObjectInput,
    sender: string,
  ) {
    const obligationOwnerCap = this.populateEnterMarketTxn(txn, marketObjectId, marketType);
    this.populatedDepositTxn(txn, marketObjectId, marketType, obligationOwnerCap, coinType, coinObjectId);
    txn.transferObjects([txn.object(obligationOwnerCap)], sender);
  }

  public populateEnterMarketTxn(txn: Transaction, marketObjectId: string, marketType: TypeName): TransactionObjectInput {
    return txn.moveCall({
      target: `${this.config.protocolPackageId}::enter_market::enter_market_return`,
      arguments: [
        txn.object(this.config.protocolAppId),
        txn.object(marketObjectId),
      ],
      typeArguments: [marketType],
    });
  }

  public populatedDepositTxn(
    tx: Transaction,
    marketObjectId: string,
    marketType: TypeName,
    obligationOwnerCapId: TransactionObjectInput,
    coinType: TypeName,
    coinObject: any,
  ) {
    if (typeof (coinObject) === 'string') {
      coinObject = tx.object(coinObject);
    }

    tx.moveCall({
      target: `${this.config.protocolPackageId}::deposit::deposit`,
      arguments: [
        tx.object(this.config.protocolAppId),
        tx.object(marketObjectId),
        tx.object(obligationOwnerCapId),
        coinObject,
        tx.object('0x6'), // Clock object
      ],
      typeArguments: [marketType, coinType],
    });

  }

  public populateRepayTxn(
    tx: Transaction,
    marketObjectId: string,
    marketType: TypeName,
    obligationOwnerCapId: string,
    coinType: TypeName,
    coinObject: any,
  ) {
    if (typeof (coinObject) === 'string') {
      coinObject = tx.object(coinObject);
    }

    tx.moveCall({
      target: `${this.config.protocolPackageId}::repay::repay`,
      arguments: [
        tx.object(this.config.protocolAppId),
        tx.object(obligationOwnerCapId),
        tx.object(marketObjectId),
        coinObject,
        tx.object('0x6'), // Clock object
      ],
      typeArguments: [marketType, coinType],
    });
  }

  public listMarkets(): MarketWithEmodes[] {
    const config = getNetworkConfig(this.network);
    return config.markets;
  }

  public async refreshPythOracle(
    tx: Transaction,
    assets: TypeName[],
  ): Promise<void> {
    const normalizedAssetTypes = assets.map((a) => normalizeStructTag(a));

    const pythConfig = getPythConfig(this.network);

    // Collect price feed IDs (assets[i] corresponds to priceFeedIds[i])
    const priceFeedIds = normalizedAssetTypes.map((assetType) => {
      const coinSymbol = this.extractCoinSymbol(assetType);
      const feedConfig = pythConfig.priceFeeds[coinSymbol];
      if (!feedConfig) {
        throw Error(`No Pyth price feed found for coin: ${coinSymbol}`);
      }
      return feedConfig.priceFeedId;
    });

    const priceInfoObjectIds = await Promise.all(
      priceFeedIds.map((priceFeedId) => this.pythClient.getPriceFeedObjectId(priceFeedId)),
    );

    // Always push fresh Pyth updates — the on-chain update_price_feeds call
    // no-ops when the supplied VAA isn't newer than the stored timestamp, so
    // unconditionally emitting is safe and lets us drop the per-asset
    // getObject probes that used to gate this.
    await this.updatePythPricesByTxn(tx, priceFeedIds);

    // Sync the freshly-updated PriceInfoObjects into XOracle so downstream
    // protocol calls in this tx see the new prices.
    for (let i = 0; i < normalizedAssetTypes.length; i++) {
      const priceInfoObjectId = priceInfoObjectIds[i];
      if (!priceInfoObjectId) {
        throw new LendingError(
          `Pyth PriceInfoObject not found for asset: ${normalizedAssetTypes[i]}`,
          { details: { assetType: normalizedAssetTypes[i], priceFeedId: priceFeedIds[i] } },
        );
      }
      tx.moveCall({
        target: `${this.config.xOraclePackageId}::user_oracle::refresh_usd_price`,
        typeArguments: [normalizedAssetTypes[i]],
        arguments: [
          tx.object(this.config.xOracleId),
          tx.object(priceInfoObjectId),
          tx.object('0x6'),
        ],
      });
    }
  }

  private extractCoinSymbol(coinType: TypeName): string {
    // Extract coin symbol from Move type
    // Example: "0x123...::usdt::USDT" -> "USDT"
    // Example: "0x123...::eth::ETH" -> "ETH"

    const parts = coinType.split('::');
    if (parts.length >= 3) {
      return parts[parts.length - 1].toUpperCase();
    }

    // Fallback: try to extract from module name
    if (parts.length >= 2) {
      return parts[parts.length - 2].toUpperCase();
    }

    throw new Error(`Cannot extract coin symbol from type: ${coinType}`);
  }

  /**
   * Execute a transaction with a signer
   */
  public async executeTransaction(
    transaction: Transaction,
    signer: Signer,
  ): Promise<TransactionResult> {
    const signerAddress = 'getPublicKey' in signer ? signer.getPublicKey().toSuiAddress() : signer.toSuiAddress();
    transaction.setSenderIfNotSet(signerAddress);
    await simulateTransactionChecked(this.provider, transaction);

    // Execute the transaction
    let result: any;
    if ('getSecretKey' in signer) {
      result = await this.provider.signAndExecuteTransaction({
        signer: signer as Keypair,
        transaction,
        include: {
          effects: true,
          events: true,
          balanceChanges: true,
          objectChanges: true,
        },
      });
    } else {
      result = await (signer as WalletAdapter).signAndExecuteTransaction(transaction);
    }

    // Wait for transaction confirmation
    await waitForTransaction(this.provider, result.digest);

    return result;
  }

  public getLiquidityMiningClient(): LiquidityMiningClient {
    return this.liquidityMiningClient;
  }

  public getReferralClient(): ReferralClient {
    return this.referralClient;
  }

  private async updatePythPricesByTxn(
    transaction: Transaction,
    priceIDs: string[],
  ): Promise<any[]> {
    const priceUpdateData = await this.pythConnnection.getPriceFeedsUpdateData(priceIDs); // see quickstart section

    /// By calling the updatePriceFeeds function, the SuiPythClient adds the necessary
    /// transactions to the transaction block to update the price feeds.
    /// This should return transaction result objects, not object IDs
    const priceInfoObjects = await this.pythClient.updatePriceFeeds(
      transaction,
      priceUpdateData,
      priceIDs,
    );
    
    if (!priceInfoObjects[0]) {
      throw new Error('priceInfoObjects is undefined');
    }

    return priceInfoObjects;
  }

}

export function collateralAmountFromDebtAmount(
  market: Market,
  emodeGroupId: EmodeGroupId,
  debtType: TypeName,
  debtPriceUsd: Decimal,
  collateralType: TypeName,
  collateralPriceUsd: Decimal,
  debtRepay: bigint,
  slippage: Decimal,
): bigint {
  const flashLoanFeeRate = market.assetEmodeParams(emodeGroupId, debtType).flashLoanFeeRate;
  const flashLoanFeeMul = flashLoanFeeRate.add(Decimal.one());
  const slippageMul = Decimal.one().add(slippage);

  const totalDebtForSwap = slippageMul.mul(flashLoanFeeMul).mulBigInt(debtRepay);
  const debtDecimalsMul = parseCoinDecimals(market.coinDecimal(debtType));
  const collateralDecimalsMul = parseCoinDecimals(market.coinDecimal(collateralType));

  return totalDebtForSwap
    .divDecimal(debtDecimalsMul)
  // use market ema to estimate
    .mul(debtPriceUsd)
    .divDecimal(collateralPriceUsd)
    .mul(collateralDecimalsMul)
    .ceiling(); 
}