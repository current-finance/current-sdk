import { Decimal } from './decimal';
import { TypeName, AssetBorrow, AssetDeposit } from './assets';
import { Operation, OperationName } from './operation';
import { Market } from './market';
import { parseCoinDecimals } from '../utils/coin-metadata';
import { typeNameWithout0x } from '../utils/transaction-utils';
import { LendingError } from './errors';

export interface ObligationData {
  emodeGroupId: number;
  borrows: AssetBorrow[];
  deposits: AssetDeposit[];
}

export type ObligationID = string;

export enum CollateralWeightMode {
  NoWeight,
  CollateralFactor,
  LiquidationFactor,
}

export class Obligation {
  private emodeGroupId: number;
  private borrowsMap: Map<TypeName, AssetBorrow>;
  private depositsMap: Map<TypeName, AssetDeposit>;

  constructor(data: ObligationData) {
    this.emodeGroupId = data.emodeGroupId;
    this.borrowsMap = new Map();
    this.depositsMap = new Map();

    for (const borrow of data.borrows) {
      this.borrowsMap.set(borrow.coinType, borrow);
    }

    for (const deposit of data.deposits) {
      this.depositsMap.set(deposit.coinType, deposit);
    }
  }

  private findBorrow(asset: TypeName): AssetBorrow | undefined {
    return this.borrowsMap.get(typeNameWithout0x(asset));
  }

  private findDeposit(asset: TypeName): AssetDeposit | undefined {
    return this.depositsMap.get(typeNameWithout0x(asset));
  }

  public static emptyObligation(emodeGroupId: number = 0): Obligation {
    return new Obligation({ emodeGroupId, borrows: [], deposits: [] });
  }

  public getEmodeGroupId(): number {
    return this.emodeGroupId;
  }

  public isActive(): boolean {
    return this.borrowsMap.size > 0 || this.depositsMap.size > 0;
  }

  public borrowedAssets(): TypeName[] {
    return Array.from(this.borrowsMap.keys());
  }

  public depositAssets(): TypeName[] {
    return Array.from(this.depositsMap.keys());
  }

  /// Estimate the debt amount since the last operation. This is only an estimate
  /// as the Market data lags slightly the actual data onchain
  public estimateDebtAmount(asset: TypeName, market: Market): bigint {
    const borrow = this.getBorrow(asset, market);

    const obligationBorrowIndex = borrow.borrowIndex();
    const debt = borrow.amount();

    const marketBorrowIndex = market.borrowIndex(asset);

    return marketBorrowIndex
      .mulBigInt(debt)
      .divDecimal(obligationBorrowIndex)
      .ceiling();
  }

  public estimateDepositAmount(asset: TypeName, market: Market): bigint {
    const deposit = this.getDeposit(asset);

    const ctokenAmount = deposit.ctokenAmount();
    return market.getDeposit(asset).exchangeRate().mulBigInt(ctokenAmount).asBigInt();
  }

  public hasBorrow(asset: TypeName): boolean {
    return this.findBorrow(asset) !== undefined;
  }

  public getBorrow(asset: TypeName, market?: Market): AssetBorrow {
    const borrow = this.findBorrow(asset);
    if (!borrow) {
      let price = Decimal.zero();
      if (market) {
        price = market.getBorrow(asset).price();
      }
      const valuation = {
        coinType: asset,
        amount: 0n,
        usd: Decimal.zero(),
        price,
      };
      const borrowIndex = Decimal.one();
      return new AssetBorrow(valuation, borrowIndex);
    }
    return borrow;
  }

  hasDeposit(asset: TypeName): boolean {
    return this.findDeposit(asset) !== undefined;
  }

  getDeposit(asset: TypeName): AssetDeposit {
    const deposit = this.findDeposit(asset);
    if (!deposit) {
      throw new Error(`No deposit found for asset: ${asset}`);
    }
    return deposit;
  }

  public currentLTV(market: Market): Decimal {
    const totalCollateralValue = this.collateralUSDValue(market, new Set(), CollateralWeightMode.NoWeight);
    if (totalCollateralValue.equals(Decimal.zero())) {
      return Decimal.zero();
    }

    const totalBorrowValue = this.totalBorrowUsdWeighted(market);
    return totalBorrowValue.divDecimal(totalCollateralValue);
  }

  public maxLTV(market: Market): Decimal {
    const weighted = this.collateralUSDValue(market, new Set(), CollateralWeightMode.CollateralFactor);
    if (weighted.equals(Decimal.zero())) {
      return Decimal.zero();
    }

    const total = this.collateralUSDValue(market, new Set(), CollateralWeightMode.NoWeight);
    return weighted.divDecimal(total);
  }

  public liquidationLTV(market: Market): Decimal {
    const weighted = this.collateralUSDValue(market, new Set(), CollateralWeightMode.LiquidationFactor);
    if (weighted.equals(Decimal.zero())) {
      return Decimal.zero();
    }
    const total = this.collateralUSDValue(market, new Set(), CollateralWeightMode.NoWeight);
    return weighted.divDecimal(total);
  }

  // deprecated
  public weightedLtv(market: Market): Decimal {
    const totalCollateralValue = this.collateralUSDValue(market);
    if (totalCollateralValue.equals(Decimal.zero())) {
      return Decimal.zero();
    }

    const totalBorrowValue = this.totalBorrowUsdWeighted(market);

    return totalBorrowValue.divDecimal(totalCollateralValue);
  }

  public netValue(): Decimal {
    let totalCollateralValue = Decimal.zero();
    const totalBorrowValue = this.totalBorrowUsd();

    // Calculate total collateral value with collateral factors
    for (const deposit of this.depositsMap.values()) {
      totalCollateralValue = totalCollateralValue.add(deposit.usdValue);
    }

    return totalCollateralValue.sub(totalBorrowValue);
  }

  public maxBorrow(
    targetLTV: Decimal,
    market: Market,
    assetType: TypeName,
    decimals: number,
  ): Decimal {
    const decimalMulti = Decimal.fromString(`1${'0'.repeat(decimals)}`);

    const price = market.getBorrow(assetType).price();
    const borrowWeight = market.assetEmodeParams(this.emodeGroupId, assetType).borrowWeight;

    const borrowOverEstimation = Decimal.fromQuotient(990, 1000); // borrow only 99% of the max amount, account for price change or interest
    const surplus = this.surplus(market, targetLTV);
    const obligationMaxBorrow = surplus
      .mul(decimalMulti)
      .mul(borrowOverEstimation)
      .divDecimal(price)
      .divDecimal(borrowWeight);

    return obligationMaxBorrow
      .min(Decimal.fromBigInt(market.getCashAvailable(assetType)))
      .min(Decimal.fromBigInt(market.availableBorrowAmount(assetType, this.emodeGroupId)));
  }

  public maxWithdraw(
    market: Market,
    assetType: TypeName,
    decimals: number | undefined,
    targetLTV: Decimal = Decimal.fromString('0.8'),
  ): Decimal {
    if (!decimals) { decimals = market.coinDecimal(assetType); }

    const amount = this.maxWithdrawInObligation(
      market,
      assetType,
      decimals,
      targetLTV,
    );

    return amount
      .min(Decimal.fromBigInt(market.availableWithdrawAmount(assetType, this.emodeGroupId)))
      .min(Decimal.fromBigInt(market.getCashAvailable(assetType)));
  }

  maxWithdrawInObligation(
    market: Market,
    assetType: TypeName,
    decimals: number,
    targetLTV: Decimal = Decimal.fromString('0.8'),
  ): Decimal {
    // Get the current deposit for this asset if it exists
    const currentDeposit = this.findDeposit(assetType);
    if (!currentDeposit) {
      return Decimal.zero();
    }

    const availableAmount = Decimal.fromBigInt(currentDeposit.amount());

    if (this.totalBorrowUsd().equals(Decimal.zero())) {
      // there is no borrow at all, return everything
      return availableAmount;
    }

    const emodeParams = market.findAssetEmodeParams(this.emodeGroupId, assetType);
    if (!emodeParams || emodeParams.collateralFactor.isZero()) {
      // not collateral in this emode group, just withdraw whatever is available
      return availableAmount;
    }
    const collateralFactor = emodeParams.collateralFactor;

    const surplus = this.surplus(market, targetLTV);
    if (surplus.isZero()) {
      return Decimal.zero();
    }

    // we are withdrawing collateral
    const price = market.getDeposit(assetType).price();
    const decimalMulti = Decimal.fromString(`1${'0'.repeat(decimals)}`);
    // Calculate max withdrawable amount based on surplus collateral (convert USD to token amount)
    // surplus (USD) = maxWithdraw * price / decimalMulti * collateralFactor
    // withdrawAmount = surplus * decimalMulti / (price * collateralFactor)
    const maxWithdraw = surplus
      .mul(decimalMulti)
      .divDecimal(price.mul(collateralFactor));

    return maxWithdraw.min(availableAmount);
  }

  // Calculate maximum borrow value based on current collateral
  public collateralUSDValue(
    market: Market,
    exclude: Set<TypeName> = new Set(),
    weightMode: CollateralWeightMode = CollateralWeightMode.CollateralFactor,
  ): Decimal {
    let totalCollateralValue = Decimal.zero();

    // Calculate total collateral value with collateral factors
    for (const deposit of this.depositsMap.values()) {
      if (exclude.has(deposit.coinType)) { continue; }

      const emode = market.findAssetEmodeParams(this.emodeGroupId, deposit.coinType);
      if (!emode) { continue; }
      if (emode.collateralFactor.equals(Decimal.zero())) { continue; }

      let collateralValue;
      if (weightMode === CollateralWeightMode.CollateralFactor) {
        collateralValue = deposit.usdValue.mul(emode.collateralFactor);
      } else if(weightMode === CollateralWeightMode.LiquidationFactor) {
        collateralValue = deposit.usdValue.mul(emode.liquidationFactor);
      } else {
        collateralValue = deposit.usdValue;
      }
      totalCollateralValue = totalCollateralValue.add(collateralValue);
    }

    return totalCollateralValue;
  }

  public totalBorrowUsd(exclude: Set<TypeName> = new Set()): Decimal {
    let totalBorrowValue = Decimal.zero();
    for (const borrow of this.borrowsMap.values()) {
      if (exclude.has(borrow.coinType)) {
        continue;
      }
      totalBorrowValue = totalBorrowValue.add(borrow.usdValue);
    }
    return totalBorrowValue;
  }

  public totalBorrowUsdWeighted(
    market: Market,
    exclude: Set<TypeName> = new Set(),
  ): Decimal {
    let totalBorrowValue = Decimal.zero();
    for (const borrow of this.borrowsMap.values()) {
      if (exclude.has(borrow.coinType)) { continue; }

      const emode = market.findAssetEmodeParams(this.emodeGroupId, borrow.coinType);
      if (!emode) { continue; }

      totalBorrowValue = totalBorrowValue.add(borrow.usdValue.mul(emode.borrowWeight));
    }

    return totalBorrowValue;
  }

  public surplus(market: Market, _targetLTV: Decimal = Decimal.one()): Decimal {
    const weightedCollateralValue = this.collateralUSDValue(market, new Set(), CollateralWeightMode.CollateralFactor);
    const totalBorrowValue = this.totalBorrowUsdWeighted(market);

    if (weightedCollateralValue.lessThan(totalBorrowValue)) {
      return Decimal.zero();
    }

    return weightedCollateralValue.sub(totalBorrowValue);
  }

  public withEstimateInterest(market: Market): Obligation {
    const newBorrows = new Map<TypeName, AssetBorrow>();
    const newDeposits = new Map<TypeName, AssetDeposit>();

    for (const [coinType, borrow] of this.borrowsMap.entries()) {
      const borrowCopy = borrow.clone();
      const updatedDebt = this.estimateDebtAmount(coinType, market);
      borrowCopy.setAmount(updatedDebt);
      newBorrows.set(coinType, borrowCopy);
    }

    for (const [coinType, deposit] of this.depositsMap.entries()) {
      const depositCopy = deposit.clone();
      const updatedDeposit = this.estimateDepositAmount(coinType, market);
      depositCopy.setAmount(updatedDeposit);
      newDeposits.set(coinType, depositCopy);
    }

    const obligation = Obligation.emptyObligation(this.emodeGroupId);
    obligation.borrowsMap = newBorrows;
    obligation.depositsMap = newDeposits;

    return obligation;
  }

  applyOperation(operation: Operation, market: Market): Obligation {
    // Create deep copies of current state
    const newBorrows = new Map<TypeName, AssetBorrow>();
    const newDeposits = new Map<TypeName, AssetDeposit>();

    // Copy existing borrows
    for (const [coinType, borrow] of this.borrowsMap.entries()) {
      newBorrows.set(coinType, borrow);
    }

    // Copy existing deposits
    for (const [coinType, deposit] of this.depositsMap.entries()) {
      newDeposits.set(coinType, deposit);
    }

    const assetConfig = market.getAssetConfiguration(operation.assetType);
    if (!assetConfig) {
      throw new LendingError(
        `Asset configuration not found for: ${operation.assetType}`,
      );
    }

    // Get current market data for the asset
    const marketDeposit = market.getDeposit(operation.assetType);
    const marketBorrow = market.getBorrow(operation.assetType);
    const price = marketDeposit.price();

    const coinMetadata = market.coinMetadatas.get(operation.assetType);
    if (!coinMetadata) {
      throw new LendingError(
        `Coin metadata not found for asset: ${operation.assetType}`,
        { details: { assetType: operation.assetType } },
      );
    }
    const deciamls = parseCoinDecimals(coinMetadata.decimals);

    switch (operation.name) {
    case OperationName.Deposit: {
      if (assetConfig.depositPaused) {
        throw new Error(`Asset ${operation.assetType} cannot be deposited`);
      }
      const existingDeposit = newDeposits.get(operation.assetType);

      if (existingDeposit) {
        // Update existing deposit
        const newAmount =
            existingDeposit.amount() + operation.amount.asBigInt();
        const newUsdValue = Decimal.fromBigInt(newAmount)
          .mul(price)
          .divDecimal(deciamls);
          // Calculate ctoken amount based on exchange rate
        const ctokenAmount = Decimal.fromBigInt(newAmount)
          .divDecimal(marketDeposit.exchangeRate())
          .asBigInt();

        const updatedDeposit = new AssetDeposit(
          {
            coinType: operation.assetType,
            amount: newAmount,
            usd: newUsdValue,
            price: price,
          },
          ctokenAmount,
          marketDeposit.exchangeRate(),
        );
        newDeposits.set(operation.assetType, updatedDeposit);
      } else {
        // Create new deposit
        const newUsdValue = operation.amount.mul(price).divDecimal(deciamls);
        // Calculate ctoken amount based on exchange rate
        const ctokenAmount = operation.amount
          .divDecimal(marketDeposit.exchangeRate())
          .asBigInt();

        const newDeposit = new AssetDeposit(
          {
            coinType: operation.assetType,
            amount: operation.amount.asBigInt(),
            usd: newUsdValue,
            price: price,
          },
          ctokenAmount,
          marketDeposit.exchangeRate(),
        );
        newDeposits.set(operation.assetType, newDeposit);
      }
      break;
    }

    case OperationName.Withdraw: {
      if (assetConfig.withdrawPaused) {
        throw new Error(`Asset ${operation.assetType} cannot be withdrawn`);
      }
      const existingDeposit = newDeposits.get(operation.assetType);
      if (!existingDeposit) {
        throw new Error(
          `No deposit found to withdraw from asset: ${operation.assetType}`,
        );
      }

      const withdrawAmount = operation.amount.asBigInt();

      let newAmount = 0n;
      if (withdrawAmount < existingDeposit.amount()) {
        newAmount = existingDeposit.amount() - withdrawAmount;
      }
      // if withdraw amount more than existing deposit, we dont really care at this level
      // as contract will always refund.

      if (newAmount === 0n) {
        // Remove deposit if fully withdrawn
        newDeposits.delete(operation.assetType);
      } else {
        // Update deposit with reduced amount
        const newUsdValue = Decimal.fromBigInt(newAmount)
          .mul(price)
          .divDecimal(deciamls);
          // Calculate ctoken amount based on exchange rate
        const ctokenAmount = Decimal.fromBigInt(newAmount)
          .divDecimal(marketDeposit.exchangeRate())
          .asBigInt();

        const updatedDeposit = new AssetDeposit(
          {
            coinType: operation.assetType,
            amount: newAmount,
            usd: newUsdValue,
            price: price,
          },
          ctokenAmount,
          marketDeposit.exchangeRate(),
        );
        newDeposits.set(operation.assetType, updatedDeposit);
      }
      break;
    }

    case OperationName.Borrow: {
      if (assetConfig.borrowPaused) {
        throw new Error(`Asset ${operation.assetType} cannot be borrowed`);
      }

      const existingBorrow = newBorrows.get(operation.assetType);

      if (existingBorrow) {
        // Update existing borrow
        const newAmount =
            existingBorrow.amount() + operation.amount.asBigInt();
        const newUsdValue = Decimal.fromBigInt(newAmount)
          .mul(price)
          .divDecimal(deciamls);

        const updatedBorrow = new AssetBorrow(
          {
            coinType: operation.assetType,
            amount: newAmount,
            usd: newUsdValue,
            price: price,
          },
          marketBorrow.borrowIndex(),
        );
        newBorrows.set(operation.assetType, updatedBorrow);
      } else {
        // Create new borrow
        const newUsdValue = operation.amount.mul(price).divDecimal(deciamls);
        const newBorrow = new AssetBorrow(
          {
            coinType: operation.assetType,
            amount: operation.amount.asBigInt(),
            usd: newUsdValue,
            price: price,
          },
          marketBorrow.borrowIndex(),
        );
        newBorrows.set(operation.assetType, newBorrow);
      }
      break;
    }

    case OperationName.Repay: {
      const existingBorrow = newBorrows.get(operation.assetType);
      if (!existingBorrow) {
        throw new Error(
          `No borrow found to repay for asset: ${operation.assetType}`,
        );
      }

      const repayAmount = operation.amount.asBigInt();
      let newAmount;
      if (repayAmount > existingBorrow.amount()) {
        // don't worry, contract will refund
        newAmount = 0n;
      } else {
        newAmount = existingBorrow.amount() - repayAmount;
      }

      if (newAmount === 0n) {
        // Remove borrow if fully repaid
        newBorrows.delete(operation.assetType);
      } else {
        // Update borrow with reduced amount
        const newUsdValue = Decimal.fromBigInt(newAmount)
          .mul(price)
          .divDecimal(deciamls);

        const updatedBorrow = new AssetBorrow(
          {
            coinType: operation.assetType,
            amount: newAmount,
            usd: newUsdValue,
            price: price,
          },
          marketBorrow.borrowIndex(),
        );
        newBorrows.set(operation.assetType, updatedBorrow);
      }
      break;
    }

    default:
      throw new Error(`Unknown operation: ${operation.name}`);
    }

    // Create new obligation data
    const newData: ObligationData = {
      emodeGroupId: this.emodeGroupId,
      borrows: Array.from(newBorrows.values()),
      deposits: Array.from(newDeposits.values()),
    };

    // Validate the new state
    return new Obligation(newData);
  }
}
