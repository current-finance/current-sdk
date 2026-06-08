import { Decimal } from './decimal';

export type TypeName = string;
const YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

export interface AssetValuation {
  coinType: TypeName;
  amount: bigint;
  usd: Decimal;
  price: Decimal;
}

export class AssetBorrow {
  private valuation: AssetValuation;
  private _borrowIndex: Decimal;

  constructor(valuation: AssetValuation, borrowIndex: Decimal) {
    this.valuation = valuation;
    this._borrowIndex = borrowIndex;
  }
  
  clone(): AssetBorrow {
    return new AssetBorrow(
      { ...this.valuation },  // shallow copy of valuation object
      this._borrowIndex,       // Decimal is likely immutable, no need to clone
    );
  }

  amount(): bigint {
    return this.valuation.amount;
  }

  price(): Decimal {
    return this.valuation.price;
  }
  
  setPrice(price: Decimal) {
    this.valuation.price = price;
  }

  setAmount(amount: bigint) {
    this.valuation.amount = amount;
  }

  borrowIndex(): Decimal {
    return this._borrowIndex;
  }

  apy(prevIndex: Decimal, previousTimestamp: number): Decimal {
    const timeDiff = Date.now() / 1000 - previousTimestamp; // seconds
    if (timeDiff <= 0) return Decimal.zero();

    const currentIndex = this._borrowIndex;
    const indexDiff = currentIndex.sub(prevIndex);
    const diff = Decimal.fromQuotient(YEAR_IN_SECONDS, timeDiff);

    return indexDiff.mul(diff);
  }

  get coinType(): TypeName {
    return this.valuation.coinType;
  }

  get usdValue(): Decimal {
    return this.valuation.usd;
  }
}

export class AssetDeposit {
  private valuation: AssetValuation;
  private _ctokenAmount: bigint;
  private _exchangeRate: Decimal;

  constructor(valuation: AssetValuation, ctokenAmount: bigint, exchangeRate: Decimal) {
    this.valuation = valuation;
    this._ctokenAmount = ctokenAmount;
    this._exchangeRate = exchangeRate;
  }

  clone(): AssetDeposit {
    return new AssetDeposit(
      { ...this.valuation },
      this._ctokenAmount,
      this._exchangeRate,
    );
  }

  exchangeRate(): Decimal {
    return this._exchangeRate;
  }

  apy(previousExchangeRate: Decimal, previousTimestamp: number): Decimal {
    const timeDiff = Date.now() / 1000 - previousTimestamp; // seconds
    if (timeDiff <= 0) return Decimal.zero();

    const rateDiff = this._exchangeRate.sub(previousExchangeRate);
    const diff = Decimal.fromQuotient(YEAR_IN_SECONDS, timeDiff);

    return rateDiff.mul(diff);
  }

  amount(): bigint {
    return this.valuation.amount;
  }

  ctokenAmount(): bigint {
    return this._ctokenAmount;
  }

  price(): Decimal {
    return this.valuation.price;
  }

  setPrice(price: Decimal) {
    this.valuation.price = price;
  }

  setAmount(amount: bigint) {
    this.valuation.amount = amount;
  }

  get coinType(): TypeName {
    return this.valuation.coinType;
  }

  get usdValue(): Decimal {
    return this.valuation.usd;
  }
}