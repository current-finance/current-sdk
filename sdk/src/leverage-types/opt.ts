import { LeverageOperationResponse, ReduceOperationParams } from '../core/quote';
import { CollateralWeightMode, Decimal, Market, Obligation, Operation, OperationName, TypeName } from '../market-types';
import { parseCoinDecimals } from '../utils/coin-metadata';


export enum IncreaseOperationType {
  BorrowSwap = 0,
  SwapBorrow = 1,
}

export interface LeveragePositionInfo {
  operation: IncreaseOperationType;
  deposit: TypeName;
  borrow: TypeName;
}

export interface OnChainLeveragePosition {
  lendingObligationId: string;
  info: LeveragePositionInfo;
}

export class LeverageObligation {
  readonly leveragePosition: OnChainLeveragePosition;
  readonly lendingMarketObligation: Obligation;

  constructor(
    leverageObligation: OnChainLeveragePosition,
    lendingMarketObligation: Obligation,
  ) {
    this.leveragePosition = leverageObligation;
    this.lendingMarketObligation = lendingMarketObligation;
  }

  public static createMockedFromQuote(
    quote: LeverageOperationResponse,
    principleAmount: bigint,
    principleCoinType: string,
    market: Market,
  ): LeverageObligation {
    if (principleCoinType === quote.operation.borrowCoin) {
      const usd = market.getTokenUsdEvaluation(principleAmount, principleCoinType);
      principleAmount = market.getTokenAmountFromUsdValuation(usd, quote.operation.collateralCoin).asBigInt();
    }

    const leveragePosition = {
      lendingObligationId: 'mockedEmptyID',
      info: {
        operation: quote.operation.optType,
        deposit: quote.operation.collateralCoin,
        borrow: quote.operation.borrowCoin,
        amount: principleAmount,
        averagePrice: market.getDeposit(quote.operation.collateralCoin).price().divDecimal(market.getBorrow(quote.operation.borrowCoin).price()),
      },
    };

    let lendingObligation = Obligation.emptyObligation();
    lendingObligation = lendingObligation.applyOperation(
      Operation.from(OperationName.Deposit, quote.operation.collateralCoin, Decimal.fromBigInt(quote.operation.totalCollateral)),
      market,
    );
    lendingObligation = lendingObligation.applyOperation(
      Operation.from(OperationName.Borrow, quote.operation.borrowCoin, Decimal.fromBigInt(quote.operation.totalDebt)),
      market,
    );

    return new LeverageObligation(leveragePosition, lendingObligation);
  }

  public principleType(): TypeName {
    return this.operationType() === IncreaseOperationType.BorrowSwap ? this.collateralType() : this.borrowType();
  }

  public operationType(): IncreaseOperationType {
    return this.leveragePosition.info.operation;
  }

  public isActive(): boolean {
    return this.lendingMarketObligation.isActive();
  }

  public isLong(leftCoinType: TypeName): boolean {
    return isLong(leftCoinType, this.leveragePosition.info.deposit);
  }

  public collateralLiquidationPrice(market: Market): Decimal {
    if (!this.leveragePosition.info) {
      return Decimal.zero();
    }

    if (!this.leveragePosition.info.deposit) {
      return Decimal.zero();
    }

    const collateralType = this.leveragePosition.info.deposit;

    const collateralUSDValue = this.lendingMarketObligation.collateralUSDValue(market, new Set([collateralType]), CollateralWeightMode.LiquidationFactor);
    const totalBorrow = this.lendingMarketObligation.totalBorrowUsdWeighted(market);

    // totalBorrow == collateralUSDValue + liquidationFactor * newCollateralPrice * amount / decimals
    const decimalMulti = parseCoinDecimals(market.coinDecimal(collateralType));
    const liquidationFactor = market.assetEmodeParams(this.lendingMarketObligation.getEmodeGroupId(), collateralType).liquidationFactor;
    const amountDecimal = this.lendingMarketObligation.depositAssets().includes(collateralType) ? Decimal.fromBigInt(this.lendingMarketObligation.getDeposit(collateralType).amount()) : Decimal.zero();
    const mul = amountDecimal.divDecimal(decimalMulti).mul(liquidationFactor);

    return mul.isZero() ? Decimal.zero() : totalBorrow.sub(collateralUSDValue).divDecimal(mul);
  }

  public debtLiquidationPrice(market: Market): Decimal {
    if (!this.leveragePosition.info) {
      return Decimal.zero();
    }

    if (!this.leveragePosition.info.deposit) {
      return Decimal.zero();
    }

    const debtType = this.leveragePosition.info.borrow;

    const maxBorrowValueWithMarket = this.lendingMarketObligation.collateralUSDValue(market, new Set(), CollateralWeightMode.LiquidationFactor);
    const totalBorrow = this.lendingMarketObligation.totalBorrowUsdWeighted(market, new Set([debtType]));

    // totalBorrow + newDebtPrice * amount * borrowWeight / decimals == maxBorrowValueWithMarket
    const borrowWeight = market.assetEmodeParams(this.lendingMarketObligation.getEmodeGroupId(), debtType).borrowWeight;

    const decimalMulti = parseCoinDecimals(market.coinDecimal(debtType));
    const amountDecimal = Decimal.fromBigInt(this.lendingMarketObligation.getBorrow(debtType, market).amount());
    if (amountDecimal.isZero()) {
      return Decimal.zero();
    }

    return maxBorrowValueWithMarket.sub(totalBorrow).mul(decimalMulti).divDecimal(amountDecimal).divDecimal(borrowWeight);
  }

  public applyIncreaseOperation(collateralIncrease: bigint, borrowIncrease: bigint, market: Market): LeverageObligation {
    // Deep copy leverageObligation
    const copiedLeverageObligation: OnChainLeveragePosition = {
      lendingObligationId: this.leveragePosition.lendingObligationId,
      info: this.leveragePosition.info,
    };

    // Apply deposit then borrow operations (applyOperation already creates deep copy)
    const updatedLendingObligation = this.lendingMarketObligation
      .applyOperation(
        new Operation(
          OperationName.Deposit,
          this.leveragePosition.info.deposit,
          Decimal.fromBigInt(collateralIncrease),
        ),
        market,
      )
      .applyOperation(
        new Operation(
          OperationName.Borrow,
          this.leveragePosition.info.borrow,
          Decimal.fromBigInt(borrowIncrease),
        ),
        market,
      );

    return new LeverageObligation(copiedLeverageObligation, updatedLendingObligation);
  }

  public applyRepay(debt: bigint, market: Market): LeverageObligation {
    const borrow = this.leveragePosition.info.borrow;
    const updatedLendingObligation = this.lendingMarketObligation.applyOperation(Operation.from(OperationName.Repay, borrow, Decimal.fromBigInt(debt)), market);

    const copiedLeverageObligation: OnChainLeveragePosition = {
      lendingObligationId: this.leveragePosition.lendingObligationId,
      info: {
        operation: this.leveragePosition.info.operation,
        deposit: this.leveragePosition.info.deposit,
        borrow: this.leveragePosition.info.borrow,
      },
    };

    return new LeverageObligation(copiedLeverageObligation, updatedLendingObligation);
  }

  public applyDeposit(amount: bigint, market: Market): LeverageObligation {
    const deposit = this.leveragePosition.info.deposit;
    const updatedLendingObligation = this.lendingMarketObligation.applyOperation(Operation.from(OperationName.Deposit, deposit, Decimal.fromBigInt(amount)), market);

    const copiedLeverageObligation: OnChainLeveragePosition = {
      lendingObligationId: this.leveragePosition.lendingObligationId,
      info: {
        operation: this.leveragePosition.info.operation,
        deposit: this.leveragePosition.info.deposit,
        borrow: this.leveragePosition.info.borrow,
      },
    };

    return new LeverageObligation(copiedLeverageObligation, updatedLendingObligation);
  }

  public applyReduce(quote: ReduceOperationParams, market: Market): LeverageObligation {
    if (!this.leveragePosition.info) {
      throw new Error('no leverage position yet');
    }

    // Deep copy leverageObligation - principle and average price remain the same
    const copiedLeverageObligation = {
      lendingObligationId: this.leveragePosition.lendingObligationId,
      info: {
        operation: this.leveragePosition.info.operation,
        deposit: this.leveragePosition.info.deposit,
        borrow: this.leveragePosition.info.borrow,
      },
    };
    
    // Calculate the reduction amounts using reduceLeverage
    const { collateralWithdraw, borrowRepay } = quote;

    let updatedLendingObligation = this.lendingMarketObligation;

    if (borrowRepay > 0n) {
      updatedLendingObligation = updatedLendingObligation.applyOperation(
        new Operation(
          OperationName.Repay,
          this.leveragePosition.info.borrow,
          Decimal.fromBigInt(borrowRepay),
        ),
        market,
      );
    }

    if (collateralWithdraw > 0n) {
      updatedLendingObligation = updatedLendingObligation.applyOperation(
        new Operation(
          OperationName.Withdraw,
          this.leveragePosition.info.deposit,
          Decimal.fromBigInt(collateralWithdraw),
        ),
        market,
      );
    }

    return new LeverageObligation(copiedLeverageObligation, updatedLendingObligation);
  }
  
  public withEstimatedInterests(market: Market): LeverageObligation {
    if (!this.leveragePosition.info) {
      throw new Error('no leverage position yet');
    }

    const updatedLendingObligation = this.lendingMarketObligation.withEstimateInterest(market);

    // Deep copy leverageObligation - principle and average price remain the same
    const copiedLeverageObligation = {
      lendingObligationId: this.leveragePosition.lendingObligationId,
      info: {
        operation: this.leveragePosition.info.operation,
        deposit: this.leveragePosition.info.deposit,
        borrow: this.leveragePosition.info.borrow,
      },
    };

    return new LeverageObligation(copiedLeverageObligation, updatedLendingObligation);
  }

  public totalCollateralValuation(market: Market): Decimal {
    const amount = this.collateralAmount();
    const collateralType = this.leveragePosition.info.deposit;
    return market.getTokenEvaluation(amount, collateralType);
  }

  public collateralType(): TypeName {
    if (!this.leveragePosition.info) {
      throw new Error('no leverage position yet');
    }
    return this.leveragePosition.info.deposit;
  }

  public borrowType(): TypeName {
    if (!this.leveragePosition.info) {
      throw new Error('no leverage position yet');
    }
    return this.leveragePosition.info.borrow;
  }

  public collateralAmount(): bigint {
    if (!this.leveragePosition.info) {
      throw new Error('no leverage position yet');
    }

    const collateralType = this.leveragePosition.info.deposit;

    if (this.lendingMarketObligation.hasDeposit(collateralType)) {
      return this.lendingMarketObligation.getDeposit(collateralType).amount();
    }
    return 0n;
  }

  public debtAmount(): bigint {
    if (!this.leveragePosition.info) {
      throw new Error('no leverage position yet');
    }

    const borrowType = this.leveragePosition.info.borrow;

    if (this.lendingMarketObligation.hasBorrow(borrowType)) {
      return this.lendingMarketObligation.getBorrow(borrowType).amount();
    }

    return 0n;
  }

  public debtValuation(market: Market): Decimal {
    const debt = this.debtAmount();
    const borrowType = this.leveragePosition.info.borrow;
    return market.getTokenUsdEvaluation(debt, borrowType);
  }

  public netValue(market: Market): Decimal {
    return this.leverageSizeUSD(market).sub(this.debtUSD(market));
  }

  public leverage(market: Market): Decimal {
    const net = this.netValue(market);

    if (net.isZero()) {
      return Decimal.zero();
    }

    return this.totalCollateralValuation(market).divDecimal(net);
  }

  public leverageAsFixedOne(market: Market): number {
    return Number(this.leverage(market).asNumber().toFixed(1));
  }

  // @deprecated
  public leverageSizeUSD(market: Market): Decimal {
    const amount = this.collateralAmount();
    const collateralType = this.leveragePosition.info.deposit;
    return market.getTokenUsdEvaluation(amount, collateralType);
  }

  public debtUSD(market: Market): Decimal {
    const debt = this.debtAmount();
    const borrowType = this.leveragePosition.info.borrow;
    return market.getTokenUsdEvaluation(debt, borrowType);
  }

  public netValueUSD(market: Market): Decimal {
    return this.leverageSizeUSD(market).sub(this.debtUSD(market));
  }
}

function isLong(leftCoinType: TypeName, collateral: TypeName): boolean {
  return leftCoinType === collateral;
}