import { LendingClient } from './client';
import { CurrentPosition, TokenExchangeQuote, LeverageIncreaseParams, LeverageOperationResponse, QuoteClient, ReduceLeverageResponse, ReduceOperationParams, ReduceSizeResponse, TokenPairId } from './quote';
import { Decimal, Market, Obligation, TypeName } from '../market-types';
import { Transaction, TransactionObjectArgument, TransactionObjectInput } from '@mysten/sui/transactions';
import { BestMultiTokenExchange, TokenExchange } from '../dex';
import { LeverageObligation, OnChainLeveragePosition, IncreaseOperationType, LeverageError } from '../leverage-types';
import { CoinMetadata, parseCoinDecimals } from '../utils/coin-metadata';
import { ClaimableRewardsBatchResult, RewardType } from '../liquidity-mining-types';
import { GET_OBJECT_INCLUDE_JSON_TYPE_BCS, getObjectOrThrow } from '../utils/object-utils';
import { normalizeStructTag } from '@mysten/sui/utils';
import { AssetPrice } from './query';

export interface LeverageClientParams {
  lendingMarketName: string;
  leverageMarketId: string;
  leveragePackageId: string;
}

export interface LeverageMarketConfig {
  lendingMarketName: string;
  leverageMarketId: string;
  leveragePackageId: string;
  lendingMarketId: string;
  lendingMarketType: TypeName;
  emodeGroupId: number;
}

export interface QuoteIncreaseResponse {
  dex: TokenExchangeQuote,
  operation: LeverageIncreaseParams,
  collateral: TypeName,
  borrow: TypeName,
}

export class LeverageMarketClient {
  readonly lendingClient: LendingClient;

  private quoteClient: QuoteClient;
  private exchange: BestMultiTokenExchange;

  // underlyingMarketName is deprecated, keep for back compatibility
  constructor(quoteClient: QuoteClient, exchange: BestMultiTokenExchange, lendingClient: LendingClient, _underlyingMarketName: string) {
    this.quoteClient = quoteClient;
    this.exchange = exchange;

    this.lendingClient = lendingClient;
  }

  private getLeverageConfig(leverageMarketId: number): LeverageMarketConfig {
    const networkConfig = this.lendingClient.config;
    const leverageMarket = networkConfig.leverageMarkets[leverageMarketId];

    if (!leverageMarket) {
      throw new Error(`Leverage market for lending market '${leverageMarketId}' not found in network configuration`);
    }

    // Set leverage config with lending market info from network config
    return {
      lendingMarketName: leverageMarket.lendingMarketName,
      leverageMarketId: leverageMarket.objectId,
      leveragePackageId: this.lendingClient.config.leveragePackageId,
      lendingMarketId: leverageMarket.lendingMarketId,
      lendingMarketType: leverageMarket.lendingMarketType,
      emodeGroupId: leverageMarket.emodeId,
    };
  }

  // =================== Quote Operations ===================

  // Quote open leverage position or increase leverage size. 
  // If inputCoin is true, it's the left side of the token pair.
  public async quoteIncreaseSize(params: {
    tokenPairId: TokenPairId;
    isLong: boolean;
    inputCoin: boolean;
    amount: bigint;
    leverage: number;
    swapSlippage: number;
    leverageMarketId: number;
  }): Promise<LeverageOperationResponse> {
    return await this.quoteClient.openLeverage({
      leverageMarketId: params.leverageMarketId,
      tokenPairId: params.tokenPairId,
      isLong: params.isLong,
      inputCoin: params.inputCoin,
      amount: params.amount.toString(),
      leverage: params.leverage,
      swapSlippage: params.swapSlippage,
      hasPos: true,
    });
  }

  public async quoteReduceSize(
    tokenPairId: TokenPairId,
    outputCoin: TypeName,
    obligation: LeverageObligation,
    percentage: number,
    swapSlippage: number,
    leverageMarketId: number,
  ): Promise<ReduceSizeResponse> {
    const totalDebt = obligation.debtAmount();
    if (totalDebt === 0n) {
      return {
        dexQuote: undefined,
        operation: {
          collateralWithdraw: Decimal.fromNumber(percentage).mulBigInt(obligation.collateralAmount()).asBigInt(),
          borrowRepay: 0n,
          borrowSwapOut: 0n,
          swapInAmount: 0n,
        },
      };
    }

    const collateral = this.isReduceAsCollateral(outputCoin, obligation);
    if (collateral) {
      return await this.quoteReduceSizeToCollateral({
        tokenPairId,
        obligation,
        percentage,
        swapSlippage,
        leverageMarketId,
      });
    }
    return await this.quoteReduceSizeToBorrow({
      tokenPairId,
      obligation,
      percentage,
      swapSlippage,
      leverageMarketId,
    });
  }

  public async quoteIncreaseLeverage(
    tokenPairId: TokenPairId,
    collateralIsLeftCoin: boolean,
    obligation: LeverageObligation,
    toLeverage: number,
    swapSlippage: number,
    leverageMarketId: number,
  ): Promise<{ dex: TokenExchangeQuote, operation: LeverageIncreaseParams }> {
    const r = await this.quoteClient.increaseLeverage({
      leverageMarketId: leverageMarketId,
      tokenPairId: tokenPairId,
      collateral: collateralIsLeftCoin,
      currentPosition: {
        collateralAmount: obligation.collateralAmount(),
        borrowAmount: obligation.debtAmount(),
      },
      swapSlippage,
      toLeverage,
    });

    return {
      dex: r.dexQuote,
      operation: {
        collateralCoin: obligation.collateralType(),
        borrowCoin: obligation.borrowType(),
        totalCollateral: r.operation.totalCollateral,
        totalDebt: r.operation.totalDebt,
        totalLeveragedDebt: r.operation.totalDebt,
        optType: IncreaseOperationType.BorrowSwap,

      },
    };
  }

  public async quoteReduceLeverage(
    tokenPairId: TokenPairId,
    leverageObligation: LeverageObligation,
    toLeverage: number,
    swapSlippage: number,
    leverageMarketId: number,
  ): Promise<ReduceLeverageResponse> {
    const principleCoinType = leverageObligation.principleType();
    const isReduceToCollateral = this.isReduceAsCollateral(principleCoinType, leverageObligation);

    if (isReduceToCollateral) {
      return await this.quoteReduceLeverageToCollateral({
        tokenPairId,
        obligation: leverageObligation,
        toLeverage,
        swapSlippage,
        leverageMarketId,
      });
    }
    return await this.quoteReduceLeverageToBorrow({
      tokenPairId,
      obligation: leverageObligation,
      toLeverage,
      swapSlippage,
      leverageMarketId,
    });
  }

  // =================== PTB ====================
  public async openAndApplyOperation(
    tx: Transaction,

    leverageMarketId: number,
    coinObjectId: TransactionObjectInput,

    operation: LeverageIncreaseParams,

    exchange: TokenExchange,
    swapSlippage: number,

    sender: string,

    oraclePrices: Map<TypeName, number>,
    decimalPlaces: Map<TypeName, number>,

    referralCode?: string,
  ) {
    const leverageConfig = this.getLeverageConfig(leverageMarketId);

    // First, open a leverage obligation if not already opened
    const leverageOwnerCap = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_obligation::open_obligation`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(this.lendingClient.config.leverageAppId),
        tx.object(leverageConfig.leverageMarketId),
        tx.object(leverageConfig.lendingMarketId),
      ],
      typeArguments: [normalizeStructTag(leverageConfig.lendingMarketType)],
    });

    await this.populateIncreaseSizeOperation(
      tx,

      leverageMarketId,
      leverageOwnerCap,
      coinObjectId,

      operation,

      exchange,
      swapSlippage,

      sender,
      
      oraclePrices,
      decimalPlaces,

      referralCode,
    );

    tx.transferObjects([leverageOwnerCap], sender);
  }

  public async populateDepositTransaction(
    tx: Transaction,
    leverageMarketId: number,
    ownerCapId: string,
    leverageObligation: LeverageObligation,
    coinObjectId: TransactionObjectInput,
  ): Promise<void> {
    const leverageConfig = this.getLeverageConfig(leverageMarketId);

    await this.refreshLeveragePrice(tx, [leverageObligation.collateralType(), leverageObligation.borrowType()]);

    tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_delegate::deposit`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(this.lendingClient.config.leverageAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(ownerCapId),

        tx.object(coinObjectId),

        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(leverageObligation.collateralType()),
        normalizeStructTag(leverageObligation.borrowType()),
      ],
    });
  }

  public async populateRepayTransaction(
    tx: Transaction,
    leverageMarketId: number,
    ownerCapId: string,
    leverageObligation: LeverageObligation,
    coinObjectId: TransactionObjectInput,
    sender: string,
  ): Promise<void> {
    const leverageConfig = this.getLeverageConfig(leverageMarketId);

    await this.refreshLeveragePrice(tx, [leverageObligation.collateralType(), leverageObligation.borrowType()]);
    
    const refundCoin = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_delegate::repay`,
      arguments: [
        tx.object(this.lendingClient.config.leverageAppId),
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(ownerCapId),
        tx.object(coinObjectId),
        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(leverageObligation.collateralType()),
        normalizeStructTag(leverageObligation.borrowType()),
      ],
    });

    // Transfer any refunded coins back to signer
    tx.transferObjects([refundCoin], sender);
  }

  public async populateIncreaseLeverage(
    tx: Transaction,

    market: Market,
    leverageMarketId: number,
    leverageOwnerCapId: TransactionObjectArgument,
    leverageObligation: LeverageObligation,

    exchange: TokenExchange,
    operation: LeverageIncreaseParams,

    newLeverage: Decimal,
    swapSlippage: number,

    sender: string,

    oraclePrices: Map<TypeName, number>,
    decimalPlaces: Map<TypeName, number>,

    referralCode?: string,
  ): Promise<void> {
    if (leverageObligation.leverage(market).greaterThan(newLeverage)) {
      throw new Error('invalid leverage');
    }

    const zeroCoin = tx.moveCall({
      target: '0x2::coin::zero',
      typeArguments: [normalizeStructTag(operation.collateralCoin)],
      arguments: [],
    });

    await this.borrowThenSwap(
      tx,
      leverageMarketId,
      leverageOwnerCapId,
      zeroCoin,
      operation,
      exchange,
      swapSlippage,
      sender,
      oraclePrices,
      decimalPlaces,
      referralCode);
  }

  public async populateIncreaseSizeOperation(
    tx: Transaction,

    leverageMarketId: number,
    obligationOwnerCapId: TransactionObjectArgument,
    coinObjectId: TransactionObjectInput,

    operation: LeverageIncreaseParams,

    exchange: TokenExchange,
    swapSlippage: number,

    sender: string,

    oraclePrices: Map<TypeName, number>,
    decimalPlaces: Map<TypeName, number>,

    referralCode?: string,
  ): Promise<void> {
    if (operation.optType === IncreaseOperationType.BorrowSwap) {
      await this.borrowThenSwap(
        tx,

        leverageMarketId,
        obligationOwnerCapId,
        coinObjectId,

        operation,
        exchange,
        swapSlippage,

        sender,

        oraclePrices,
        decimalPlaces,

        referralCode,
      );
    } else {
      await this.swapThenBorrow(
        tx,

        leverageMarketId,
        obligationOwnerCapId,
        coinObjectId,

        operation,
        exchange,
        swapSlippage,

        sender,

        oraclePrices,
        decimalPlaces,

        referralCode,
      );
    }
  }

  public async populateReduceSize(
    tx: Transaction,

    outputCoin: TypeName,

    leverageMarketId: number,

    leverageOwnerCapId: TransactionObjectArgument,
    leverageObligation: LeverageObligation,

    exchange: TokenExchange | undefined,
    quote: ReduceOperationParams,

    percentage: Decimal,
    swapSlippage: number,

    sender: string,

    oraclePrices: Map<TypeName, number>,
    decimalPlaces: Map<TypeName, number>,

    referralCode?: string,
  ): Promise<void> {
    const collateral = this.isReduceAsCollateral(outputCoin, leverageObligation);
    if (collateral) {
      return await this.populateReduceSizeToCollateral(
        tx,

        leverageMarketId,
        leverageOwnerCapId,
        leverageObligation,

        exchange,
        quote,

        percentage,
        swapSlippage,
        
        sender,

        oraclePrices,
        decimalPlaces,

        referralCode,
      );
    }

    return await this.populateReduceSizeToBorrow(
      tx,

      leverageMarketId,
      leverageOwnerCapId,
      leverageObligation,

      exchange,
      quote,

      percentage,
      swapSlippage,

      sender,

      oraclePrices,
      decimalPlaces,

      referralCode,
    );
  }

  public async populateReduceLeverage(
    tx: Transaction,

    leverageMarketId: number,
    leverageOwnerCapId: TransactionObjectArgument,
    leverageObligation: LeverageObligation,

    quote: ReduceOperationParams,

    exchange: TokenExchange,
    swapSlippage: number,

    sender: string,

    oraclePrices: Map<TypeName, number>,
    decimalPlaces: Map<TypeName, number>,

    referralCode?: string,
  ): Promise<void> {
    const principleCoinType = leverageObligation.principleType();
    const isReduceToCollateral = this.isReduceAsCollateral(principleCoinType, leverageObligation);

    if (isReduceToCollateral) {
      return await this.populateReduceLeverageAsCollateral(
        tx, 
        leverageMarketId, 
        leverageOwnerCapId, 
        leverageObligation, 
        exchange, 
        quote, 
        swapSlippage, 
        sender, 
        oraclePrices,
        decimalPlaces,
        referralCode,
      );
    }
    return await this.populateReduceLeverageAsBorrow(
      tx,
      leverageMarketId,
      leverageOwnerCapId,
      leverageObligation,
      exchange,
      quote,
      swapSlippage,
      sender,
      oraclePrices,
      decimalPlaces,
      referralCode,
    );
  }

  public populateClaimLiquidityMiningReward(
    tx: Transaction,

    leverageMarketId: number,
    leverageOwnerCapId: TransactionObjectArgument,

    coinType: string, // Reserve type

    rewardType: RewardType,
    rewardIndex: number,
    rewardCoinType: string, // Reward coin type
  ) {
    const leverageConfig = this.getLeverageConfig(leverageMarketId);

    tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_delegate::claim_liquidity_minging_rewards`,
      arguments: [
        tx.object(this.lendingClient.config.leverageAppId),
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageOwnerCapId),

        tx.pure.u8(rewardType),
        tx.pure.u64(rewardIndex),

        tx.object('0x6'), // Clock
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(coinType), // CoinType (reserve type)
        normalizeStructTag(rewardCoinType), // RewardCoinType
      ],
    });
  }

  // ================== Getter Methods ===============
  public async getObligationSummary(leverageOwnerCapId: string, market: Market): Promise<LeverageObligation> {
    const leverageObligation = await this.getLeverageObligationDetail(leverageOwnerCapId);
    const lendingObligation = new Obligation(await this.lendingClient.getObligationDetail(
      leverageObligation.lendingObligationId,
      market,
    ));
    return new LeverageObligation(leverageObligation, lendingObligation);
  }

  public async getUnderlyingMarket(leverageMarketId: number, coinMetadatas: Map<TypeName, CoinMetadata> = new Map(), prices: AssetPrice[] = []): Promise<Market> {
    const leverageConfig = this.getLeverageConfig(leverageMarketId);
    const marketData = await this.lendingClient.getEmodeGroupMarketSnapshot(leverageConfig.lendingMarketType, leverageConfig.emodeGroupId, prices);
    return new Market(leverageConfig.lendingMarketType, leverageConfig.lendingMarketId, marketData.assets, marketData.emodeGroups, coinMetadatas);
  }

  public async getLiquidityMiningRewards(obligation: LeverageObligation, leverageMarketId: number): Promise<ClaimableRewardsBatchResult> {
    const leverageConfig = this.getLeverageConfig(leverageMarketId);
    const lendingObligationId = obligation.leveragePosition.lendingObligationId;

    const liquidityClient = this.lendingClient.getLiquidityMiningClient();

    const coinTypes = [obligation.leveragePosition.info.borrow, obligation.leveragePosition.info.deposit];
    
    return await liquidityClient.getClaimableRewardsBatch(
      {
        marketObjectId: leverageConfig.lendingMarketId,
        obligationId: lendingObligationId,
        coinTypes,
      },
    );
  }

  public async maxLeverageForOpen(params: {
    tokenPairId: TokenPairId;
    isLong: boolean;
    inputCoin: boolean;
    swapSlippage: number;
    leverageMarketId: number;
  }[]): Promise<number[]> {
    const reqs = params.map(p => ({
      leverageMarketId: p.leverageMarketId,
      tokenPairId: p.tokenPairId,
      isLong: p.isLong,
      inputCoin: p.inputCoin,
      swapSlippage: p.swapSlippage,
    }));

    return await this.quoteClient.maxLeverageOpen({ reqs });
  }

  public async maxLeverageObligations(params: {
    tokenPairId: TokenPairId;
    collateral: boolean;
    currentPosition: CurrentPosition;
    swapSlippage: number;
    leverageMarketId: number;
  }[]): Promise<string[]> {
    const positions = params.map(p => ({
      leverageMarketId: p.leverageMarketId,
      tokenPairId: p.tokenPairId,
      collateral: p.collateral,
      currentPosition: p.currentPosition,
      swapSlippage: p.swapSlippage,
    }));
    return this.quoteClient.maxLeverageIncrease({ positions });
  }
  
  // ================== Internal =================
  private async quoteReduceSizeToCollateral(params: {
    tokenPairId: TokenPairId;
    obligation: LeverageObligation;
    percentage: number;
    swapSlippage: number;
    leverageMarketId: number;
  }): Promise<ReduceSizeResponse> {
    return await this.quoteClient.reduceSizeToCollateral({
      leverageMarketId: params.leverageMarketId,
      tokenPairId: params.tokenPairId,
      collateral: params.obligation.leveragePosition.info.deposit,
      currentPosition: {
        collateralAmount: params.obligation.collateralAmount(),
        borrowAmount: params.obligation.debtAmount(),
      },
      percentage: params.percentage,
      swapSlippage: params.swapSlippage,
    });
  }

  private async quoteReduceSizeToBorrow(params: {
    tokenPairId: TokenPairId;
    obligation: LeverageObligation;
    percentage: number;
    swapSlippage: number;
    leverageMarketId: number;
  }): Promise<ReduceSizeResponse> {
    return await this.quoteClient.reduceSizeToBorrow({
      leverageMarketId: params.leverageMarketId,
      tokenPairId: params.tokenPairId,
      collateral: params.obligation.leveragePosition.info.deposit,
      currentPosition: {
        collateralAmount: params.obligation.collateralAmount(),
        borrowAmount: params.obligation.debtAmount(),
      },
      percentage: params.percentage,
      swapSlippage: params.swapSlippage,
    });
  }

  private async quoteReduceLeverageToCollateral(params: {
    tokenPairId: TokenPairId;
    obligation: LeverageObligation;
    toLeverage: number;
    swapSlippage: number;
    leverageMarketId: number;
  }): Promise<ReduceLeverageResponse> {
    return await this.quoteClient.reduceLeverageToCollateral({
      leverageMarketId: params.leverageMarketId,
      tokenPairId: params.tokenPairId,
      collateral: params.obligation.leveragePosition.info.deposit,
      currentPosition: {
        collateralAmount: params.obligation.collateralAmount(),
        borrowAmount: params.obligation.debtAmount(),
      },
      toLeverage: params.toLeverage,
      swapSlippage: params.swapSlippage,
    });
  }

  private async quoteReduceLeverageToBorrow(params: {
    tokenPairId: TokenPairId;
    obligation: LeverageObligation;
    toLeverage: number;
    swapSlippage: number;
    leverageMarketId: number;
  }): Promise<ReduceLeverageResponse>  {
    return await this.quoteClient.reduceLeverageToBorrow({
      leverageMarketId: params.leverageMarketId,
      tokenPairId: params.tokenPairId,
      collateral: params.obligation.leveragePosition.info.deposit,
      currentPosition: {
        collateralAmount: params.obligation.collateralAmount(),
        borrowAmount: params.obligation.debtAmount(),
      },
      toLeverage: params.toLeverage,
      swapSlippage: params.swapSlippage,
    });
  }

  private async getLeverageObligationDetail(leverageOwnerCapId: string): Promise<OnChainLeveragePosition> {
    const json = await getObjectOrThrow(
      this.lendingClient.provider,
      leverageOwnerCapId,
      GET_OBJECT_INCLUDE_JSON_TYPE_BCS,
    );
    const lendingObligationId = json.obligation_owner_cap?.obligation_id;

    const infoJson = json.info;
    const variant = infoJson?.operation?.['@variant'];
    if (!variant) {
      throw new LeverageError('empty leverage obligation');
    }

    let info = {
      operation: parseLeverageOperationTypeFromStr(variant),
      deposit: infoJson.deposit,
      borrow: infoJson.borrow,
    };

    return { lendingObligationId, info };
  }

  private async populateReduceLeverageAsCollateral(
    tx: Transaction,

    leverageMarketId: number,
    leverageOwnerCapId: TransactionObjectArgument,
    leverageObligation: LeverageObligation,

    exchange: TokenExchange,
    operation: ReduceOperationParams,

    swapSlippage: number,

    sender: string,

    oraclePrices: Map<TypeName, number>,
    decimalPlaces: Map<TypeName, number>,

    referralCode?: string,
  ): Promise<void> {

    let { collateralWithdraw: collateral, borrowRepay: debt } = operation;
    const leverageConfig = this.getLeverageConfig(leverageMarketId);

    // Refresh oracle prices for all assets
    await this.refreshLeveragePrice(tx, [leverageObligation.collateralType(), leverageObligation.borrowType()]);

    // Request reduce leverage: returns flash loan and collateral coins
    const [flashLoan, collateralCoins] = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_reduce_to_borrow_coin::request_reduce_leverage`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(this.lendingClient.config.leverageAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageOwnerCapId),
        tx.object(leverageConfig.leverageMarketId),

        tx.pure.u64(debt),
        tx.pure.u64(collateral),

        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(leverageObligation.collateralType()),
        normalizeStructTag(leverageObligation.borrowType()),
      ],
    });

    const [coinIn] = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_repay::split_with_event`,
      arguments: [
        tx.object(collateralCoins),
        tx.pure.u64(collateral),
      ],
      typeArguments: [normalizeStructTag(leverageObligation.collateralType())],
    });

    const minOutAmount = minSwapOut(leverageObligation.collateralType(), leverageObligation.borrowType(), collateral, oraclePrices, decimalPlaces, swapSlippage);

    const swapOutput = await this.exchange.populateSwapIn(
      exchange,
      tx,
      {
        inCoinType: leverageObligation.collateralType(),
        outCoinType: leverageObligation.borrowType(),
        amountIn: collateral,
        coinId: coinIn,
        slippage: swapSlippage,
        sender,
        minOutAmount,
      },
    );

    // Complete the leverage operation
    const refundCoin = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_reduce_to_borrow_coin::complete_reduce`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageConfig.leverageMarketId),
        tx.object(leverageOwnerCapId),
        flashLoan,
        swapOutput.coin,
        referralCode ? tx.pure.option('string', referralCode) : tx.pure.option('string', null),
        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(leverageObligation.borrowType()),
      ],
    });

    // Transfer any refunded coins back to the signer
    tx.transferObjects([refundCoin, collateralCoins], sender);
  }

  private async populateReduceLeverageAsBorrow(
    tx: Transaction,

    leverageMarketId: number,
    leverageOwnerCapId: TransactionObjectArgument,
    leverageObligation: LeverageObligation,

    exchange: TokenExchange,
    operation: ReduceOperationParams,

    swapSlippage: number,

    sender: string,

    oraclePrices: Map<TypeName, number>,
    decimalPlaces: Map<TypeName, number>,

    referralCode?: string,
  ): Promise<void> {
    let { collateralWithdraw, borrowRepay } = operation;
    const leverageConfig = this.getLeverageConfig(leverageMarketId);

    await this.refreshLeveragePrice(tx, [leverageObligation.collateralType(), leverageObligation.borrowType()]);

    // Request reduce leverage: returns flash loan and collateral coins
    const [flashLoan, collateralCoins] = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_reduce_to_borrow_coin::request_reduce_leverage`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(this.lendingClient.config.leverageAppId),
        tx.object(leverageConfig.lendingMarketId),
        leverageOwnerCapId,
        tx.object(leverageConfig.leverageMarketId),

        tx.pure.u64(borrowRepay),
        tx.pure.u64(collateralWithdraw),

        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(leverageObligation.collateralType()),
        normalizeStructTag(leverageObligation.borrowType()),
      ],
    });

    const minOutAmount = minSwapOut(leverageObligation.collateralType(), leverageObligation.borrowType(), collateralWithdraw, oraclePrices, decimalPlaces, swapSlippage);

    const swapOutput = await this.exchange.populateSwapIn(
      exchange,
      tx,
      {
        inCoinType: leverageObligation.collateralType(),
        outCoinType: leverageObligation.borrowType(),
        amountIn: collateralWithdraw,
        coinId: collateralCoins,
        slippage: swapSlippage,
        sender,
        minOutAmount,
      },
    );

    // Complete the leverage operation
    const refundCoin = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_reduce_to_borrow_coin::complete_reduce`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageConfig.leverageMarketId),
        leverageOwnerCapId,
        flashLoan,
        swapOutput.coin,
        referralCode ? tx.pure.option('string', referralCode) : tx.pure.option('string', null),
        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(leverageObligation.borrowType()),
      ],
    });

    // Transfer any refunded coins back to the signer
    tx.transferObjects([refundCoin], sender);
  }

  private async populateWithdrawSize(
    tx: Transaction,

    leverageMarketId: number,
    leverageOwnerCapId: TransactionObjectArgument,
    leverageObligation: LeverageObligation,

    percentage: Decimal,
  ): Promise<TransactionObjectArgument> {
    const info = leverageObligation.leveragePosition.info;
    const leverageConfig = this.getLeverageConfig(leverageMarketId);

    await this.refreshLeveragePrice(tx, [info.deposit, info.borrow]);

    return tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_reduce_to_collateral_coin::withdraw_size`,
      arguments: [
        tx.object(this.lendingClient.config.leverageAppId),
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(leverageConfig.lendingMarketId),
        leverageOwnerCapId,

        tx.pure.u8(percentage.mulBigInt(100n).asNumber()),

        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(info.deposit),
        normalizeStructTag(info.borrow),
      ],
    });
  }

  private async populateReduceSizeToCollateral(
    tx: Transaction,

    leverageMarketId: number,
    leverageOwnerCapId: TransactionObjectArgument,
    leverageObligation: LeverageObligation,

    exchange: TokenExchange | undefined,
    quote: ReduceOperationParams,

    percentage: Decimal,
    slippage: number,

    sender: string,

    oraclePrices: Map<TypeName, number>,
    decimalPlaces: Map<TypeName, number>,

    referralCode?: string,
  ): Promise<void> {
    const collateralType = leverageObligation.leveragePosition.info.deposit;
    const borrowType = leverageObligation.leveragePosition.info.borrow;

    const totalDebt = leverageObligation.debtAmount();
    if (totalDebt === 0n) {
      const refunded = await this.populateWithdrawSize(tx, leverageMarketId, leverageOwnerCapId, leverageObligation, percentage);
      tx.transferObjects([refunded], sender);
      return;
    }

    if (exchange === undefined) {
      throw new LeverageError('No possible dex router for swap');
    }

    const { borrowRepay } = quote;
    const leverageConfig = this.getLeverageConfig(leverageMarketId);

    await this.refreshLeveragePrice(tx, [collateralType, borrowType]);

    // Request repay: returns flash loan and collateral coins
    const [flashLoan, collateralCoins] = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_reduce_to_borrow_coin::request_reduce_size`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(this.lendingClient.config.leverageAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageOwnerCapId),
        tx.object(leverageConfig.leverageMarketId),

        tx.pure.u8(percentage.mulBigInt(100n).asNumber()),
        tx.pure.u64(borrowRepay),

        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(collateralType),
        normalizeStructTag(borrowType),
      ],
    });

    const [coinIn] = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_repay::split_with_event`,
      arguments: [
        tx.object(collateralCoins),
        tx.pure.u64(quote.swapInAmount),
      ],
      typeArguments: [normalizeStructTag(collateralType)],
    });

    const minOutAmount = minSwapOut(leverageObligation.collateralType(), leverageObligation.borrowType(), quote.swapInAmount, oraclePrices, decimalPlaces, slippage);

    const swapOutput = await this.exchange.populateSwapIn(
      exchange,
      tx,
      {
        inCoinType: leverageObligation.collateralType(),
        outCoinType: leverageObligation.borrowType(),
        amountIn: quote.swapInAmount,
        coinId: coinIn,
        slippage,
        sender,
        minOutAmount,
      },
    );
    
    // Complete the leverage operation
    const refundCoin = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_reduce_to_borrow_coin::complete_reduce`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageConfig.leverageMarketId),
        tx.object(leverageOwnerCapId),
        flashLoan,
        swapOutput.coin,
        referralCode ? tx.pure.option('string', referralCode) : tx.pure.option('string', null),

        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(borrowType),
      ],
    });

    // Transfer any refunded coins back to the signer
    tx.transferObjects([refundCoin, collateralCoins], sender);
  }

  private async populateReduceSizeToBorrow(
    tx: Transaction,

    leverageMarketId: number,
    leverageOwnerCapId: TransactionObjectArgument,
    leverageObligation: LeverageObligation,

    exchange: TokenExchange | undefined,
    quote: ReduceOperationParams,

    percentage: Decimal,
    swapSlippage: number,

    sender: string,

    oraclePrices: Map<TypeName, number>,
    decimalPlaces: Map<TypeName, number>,

    referralCode?: string,
  ): Promise<void> {
    const collateralType = leverageObligation.leveragePosition.info.deposit;
    const borrowType = leverageObligation.leveragePosition.info.borrow;

    const totalDebt = leverageObligation.debtAmount();
    if (totalDebt === 0n) {
      const refunded = await this.populateWithdrawSize(tx, leverageMarketId, leverageOwnerCapId, leverageObligation, percentage);
      tx.transferObjects([refunded], sender);
      return;
    }

    if (exchange === undefined) {
      throw new LeverageError('No possible exchange router for swap');
    }

    let { collateralWithdraw: withdrawAmount, borrowRepay: debtRepay } = quote;
    const leverageConfig = this.getLeverageConfig(leverageMarketId);

    await this.refreshLeveragePrice(tx, [collateralType, borrowType]);

    // Request repay: returns flash loan and collateral coins
    const [flashLoan, collateralCoins] = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_reduce_to_borrow_coin::request_reduce_size`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(this.lendingClient.config.leverageAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageOwnerCapId),
        tx.object(leverageConfig.leverageMarketId),

        tx.pure.u8(percentage.mulBigInt(100n).asNumber()),
        tx.pure.u64(debtRepay),

        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(collateralType),
        normalizeStructTag(borrowType),
      ],
    });

    const minOutAmount = minSwapOut(leverageObligation.collateralType(), leverageObligation.borrowType(), withdrawAmount, oraclePrices, decimalPlaces, swapSlippage);

    // Swap collateral coins to borrow type to repay the flash loan
    const swapOutput = await this.exchange.populateSwapIn(
      exchange,
      tx,
      {
        inCoinType: leverageObligation.collateralType(),
        outCoinType: leverageObligation.borrowType(),
        amountIn: withdrawAmount,
        coinId: collateralCoins,
        slippage: swapSlippage,
        sender,
        minOutAmount,
      },
    );

    // Complete the leverage operation
    const refundCoin = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_reduce_to_borrow_coin::complete_reduce`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageConfig.leverageMarketId),
        tx.object(leverageOwnerCapId),
        flashLoan,
        swapOutput.coin,
        referralCode ? tx.pure.option('string', referralCode) : tx.pure.option('string', null),

        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(borrowType),
      ],
    });

    // Transfer any refunded coins back to the signer
    tx.transferObjects([refundCoin], sender);
  }

  private isReduceAsCollateral(outputCoin: TypeName, leverageObligation: LeverageObligation): boolean {
    const collateralType = leverageObligation.collateralType();
    return outputCoin === collateralType;
  }

  private async borrowThenSwap(
    tx: Transaction,

    leverageMarketId: number,
    obligationOwnerCapId: TransactionObjectArgument,
    coinObjectId: TransactionObjectInput,

    operation: LeverageIncreaseParams,
    exchange: TokenExchange,
    swapSlippage: number,

    sender: string,

    oraclePrices: Map<TypeName, number>,
    decimalPlaces: Map<TypeName, number>,

    referralCode?: string,
  ): Promise<void> {
    const leverageConfig = this.getLeverageConfig(leverageMarketId);
    await this.refreshLeveragePrice(tx, [operation.collateralCoin, operation.borrowCoin]);

    // Request leverage: returns flash loan and borrowed coins
    const [flashLoan, borrowed] = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_borrow_swap::request_leverage`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(this.lendingClient.config.leverageAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageConfig.leverageMarketId),
        obligationOwnerCapId,

        tx.object(coinObjectId),
        tx.pure.u64(operation.totalCollateral),
        tx.pure.u64(operation.totalDebt),

        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
        tx.object('0x6'), // Clock object
        tx.object(this.lendingClient.config.xOracleId),
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(operation.collateralCoin),
        normalizeStructTag(operation.borrowCoin),
      ],
    });

    const minOutAmount = minSwapOut(operation.borrowCoin, operation.collateralCoin, operation.totalDebt, oraclePrices, decimalPlaces, swapSlippage);

    // Swap borrowed coins to collateral type
    const swapOutput = await this.exchange.populateSwapIn(
      exchange,
      tx,
      {
        inCoinType: operation.borrowCoin,
        outCoinType: operation.collateralCoin,
        amountIn: operation.totalDebt,
        coinId: borrowed,
        slippage: swapSlippage,
        sender,
        minOutAmount,
      },
    );

    // Complete the leverage operation using leverage_repay::complete_leverage
    const refundCoin = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_repay::complete_leverage`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageConfig.leverageMarketId),

        obligationOwnerCapId,

        flashLoan,
        referralCode ? tx.pure.option('string', referralCode) : tx.pure.option('string', null),
        swapOutput.coin,

        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(operation.collateralCoin),
      ],
    });

    // Transfer any refunded coins back to the signer
    tx.transferObjects([refundCoin], sender);
  }

  private async swapThenBorrow(
    tx: Transaction,

    leverageMarketId: number,
    obligationOwnerCapId: TransactionObjectArgument,
    coinObjectId: TransactionObjectInput,

    operation: LeverageIncreaseParams,
    exchange: TokenExchange,
    swapSlippage: number,

    sender: string,

    oraclePrices: Map<TypeName, number>,
    decimalPlaces: Map<TypeName, number>,

    referralCode?: string,
  ): Promise<void> {
    const leverageConfig = this.getLeverageConfig(leverageMarketId);

    await this.refreshLeveragePrice(tx, [operation.collateralCoin, operation.borrowCoin]);

    // Request leverage for swap_borrow: returns flash loan and total debt coins
    const [hotPotato, debtCoins] = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_swap_borrow::request_leverage`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(this.lendingClient.config.leverageAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageConfig.leverageMarketId),
        typeof obligationOwnerCapId === 'string' ? tx.object(obligationOwnerCapId) : obligationOwnerCapId,

        tx.object(coinObjectId), // initial debt coin
        tx.pure.u64(operation.totalLeveragedDebt),

        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(operation.collateralCoin),
        normalizeStructTag(operation.borrowCoin),
      ],
    });

    const minOutAmount = minSwapOut(operation.borrowCoin, operation.collateralCoin, operation.totalLeveragedDebt, oraclePrices, decimalPlaces, swapSlippage);

    // Swap debt coins to collateral type
    const swapOutput = await this.exchange.populateSwapIn(
      exchange,
      tx,
      {
        inCoinType: operation.borrowCoin,
        outCoinType: operation.collateralCoin,
        amountIn: operation.totalLeveragedDebt,
        coinId: debtCoins,
        slippage: swapSlippage,
        sender,
        minOutAmount,
      },
    );

    // Complete the leverage operation using leverage_swap_borrow::complete_leverage
    const refundCoin = tx.moveCall({
      target: `${leverageConfig.leveragePackageId}::leverage_swap_borrow::complete_leverage`,
      arguments: [
        tx.object(this.lendingClient.config.protocolAppId),
        tx.object(leverageConfig.lendingMarketId),
        tx.object(leverageConfig.leverageMarketId),

        obligationOwnerCapId,

        hotPotato,
        swapOutput.coin,
        referralCode ? tx.pure.option('string', referralCode) : tx.pure.option('string', null),

        tx.object(this.lendingClient.config.coinDecimalsRegistryId),
        tx.object(this.lendingClient.config.xOracleId),
        tx.object('0x6'), // Clock object
      ],
      typeArguments: [
        normalizeStructTag(leverageConfig.lendingMarketType),
        normalizeStructTag(operation.collateralCoin),
        normalizeStructTag(operation.borrowCoin),
      ],
    });

    // Transfer any refunded coins back to the signer
    tx.transferObjects([refundCoin], sender);
  }

  private async refreshLeveragePrice(
    tx: Transaction,
    operationAssets: TypeName[],
  ): Promise<void> {
    try {
      await this.lendingClient.refreshPythOracle(tx, [...operationAssets]);
    } catch (e) {
      throw new LeverageError(`Could not refresh price from Pyth: ${e}`);
    }
  }
}

function minSwapOut(inType: TypeName, outType: TypeName, amountIn: bigint, oraclePrices: Map<TypeName, number>, decimalPlaces: Map<TypeName, number>, slippage: number): bigint {
  const inPrice = Decimal.fromNumber(getPrice(inType, oraclePrices));
  const outPrice = Decimal.fromNumber(getPrice(outType, oraclePrices));

  const inDecimal = getDecimalMultiplier(inType, decimalPlaces);
  const outDecimal = getDecimalMultiplier(outType, decimalPlaces);

  const slippageDecimal = Decimal.fromNumber(1 + slippage);

  const minOut = inPrice
    .mulBigInt(amountIn)
    .divDecimal(inDecimal)
    .divDecimal(outPrice)
    .mul(outDecimal)
    .divDecimal(slippageDecimal);

  return minOut.asBigInt();
}

function getDecimalMultiplier(coinType: TypeName, decimalPlaces: Map<TypeName, number>): Decimal {
  const decimalPlace = decimalPlaces.get(coinType);
  if (!decimalPlace) {
    throw new Error(`Decimal places not found: ${coinType}`);
  }
  return parseCoinDecimals(decimalPlace);
}

function getPrice(coinType: TypeName,oraclePrices: Map<TypeName, number>): number {
  const price = oraclePrices.get(coinType);
  if (!price) {
    throw new Error(`Price not found: ${coinType}`);
  }
  return price;
}

function parseLeverageOperationTypeFromStr(variant: string): IncreaseOperationType {
  if (variant === 'SwapBorrow') {
    return IncreaseOperationType.SwapBorrow;
  }
  
  if (variant === 'BorrowSwap') {
    return IncreaseOperationType.BorrowSwap;
  }

  throw new Error(`unknown leverage operation type variant ${variant}`);
}