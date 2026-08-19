import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction, TransactionObjectInput, TransactionResult } from '@mysten/sui/transactions';
import { Keypair } from '@mysten/sui/cryptography';
import { EmodeGroupId, MarketData } from '../market-types/market';
import { ObligationData } from '../market-types/obligation';
import { AssetBorrow, AssetDeposit, TypeName } from '../market-types/assets';
import { Decimal } from '../market-types/decimal';
import { Signer, WalletAdapter, Market } from '../market-types';
import { NetworkConfig, getNetworkConfig, MarketWithEmodes, Env } from '../config/networks';
import { simulateTransactionChecked, waitForTransaction } from '../utils/transaction-utils';
import { parseCoinDecimals } from '../utils/coin-metadata';
import { LiquidityMiningClient } from './liquidity-mining';
import { ReferralClient } from './referral';
import { AssetPrice } from './query';
import { CachedQueryClient } from './cached-query';
import { OracleRefresher } from './oracle';
import { normalizeStructTag } from '@mysten/sui/utils';

export type TxnHash = string;

const DEFAULT_MAINNET_GRPC = 'https://fullnode.mainnet.sui.io:443';

export interface LendingClientConfig {
  network: 'mainnet',
  suiEndpoint?: string,
  oracleChannelUrl?: string,
}

export class LendingClient {
  readonly env: Env;
  readonly provider: SuiGrpcClient;
  readonly config: NetworkConfig;

  private network: 'mainnet';

  private xOracleClient: OracleRefresher;

  private liquidityMiningClient: LiquidityMiningClient;
  private referralClient: ReferralClient;
  public readonly query: CachedQueryClient;

  private constructor(config: LendingClientConfig, provider: SuiGrpcClient, xOracleClient: OracleRefresher, env = Env.Production) {
    this.network = config.network;
    this.config = getNetworkConfig(config.network);

    this.provider = provider;

    this.xOracleClient = xOracleClient;

    this.liquidityMiningClient = new LiquidityMiningClient(
      this.provider,
      this.config.protocolPackageId,
      this.config.protocolAppId,
    );
    this.referralClient = new ReferralClient(this.provider, this.config.protocolPackageId, this.config.protocolAppId);
    this.query = new CachedQueryClient(this.provider, this.config);
    this.env = env;
  }

  public static from(config: LendingClientConfig, xOracleClient: OracleRefresher, provider: SuiGrpcClient): LendingClient {
    return new LendingClient(config, provider, xOracleClient);
  }
  
  public static fromConfig(config: LendingClientConfig, xOracleClient: OracleRefresher): LendingClient {
    const grpcUrl = config.suiEndpoint ?? DEFAULT_MAINNET_GRPC;
    return LendingClient.from(config, xOracleClient, new SuiGrpcClient({ baseUrl: grpcUrl, network: 'mainnet' }));
  }

  public getNetwork(): 'mainnet' {
    return this.network;
  }

  /** A util method to get just one emode group under a market */
  public async getEmodeGroupMarketSnapshot(
    marketType: TypeName,
    emodeGroupId: number,
    prices: AssetPrice[],
  ): Promise<MarketData> {
    const assetTypes = prices.map(p => p.assetType);
    const [assetResults, emodeGroup] = await Promise.all([
      this.query.getAssetsMarketOverview(marketType, prices),
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

    await this.refreshOraclePrices(tx, allAssets);

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
      typeArguments: [normalizeStructTag(marketType), normalizeStructTag(coinType)],
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

    await this.refreshOraclePrices(tx, allAssets);

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
      typeArguments: [normalizeStructTag(marketType), normalizeStructTag(coinType)],
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
      typeArguments: [normalizeStructTag(marketType), normalizeStructTag(coinType)],
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
      typeArguments: [normalizeStructTag(marketType), normalizeStructTag(coinType)],
    });
  }

  public listMarkets(): MarketWithEmodes[] {
    const config = getNetworkConfig(this.network);
    return config.markets;
  }

  public async refreshOraclePrices(
    tx: Transaction,
    assets: TypeName[],
  ): Promise<void> {
    await this.xOracleClient.refreshOraclePrices(tx, assets);
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