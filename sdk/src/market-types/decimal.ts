export class Decimal {
  private value: bigint;
  private static PRECISION = 18; // Fixed precision for decimal calculations
  private static WAD = 1000000000000000000n;

  constructor(value: bigint) {
    this.value = value;
  }

  static fromQuotientBigInt(numberator: bigint, denominator: bigint): Decimal {
    const num = numberator * BigInt(Math.pow(10, Decimal.PRECISION));
    return new Decimal(BigInt(num / denominator));
  }

  static fromQuotient(numberator: number, denominator: number): Decimal {
    const num = BigInt(Math.floor(numberator)) * BigInt(Math.pow(10, Decimal.PRECISION));
    const den = BigInt(Math.floor(denominator));
    return new Decimal(BigInt(num / den));
  }

  static fromBigInt(value: bigint): Decimal {
    const scaled = value * Decimal.WAD;
    return new Decimal(scaled);
  }

  static fromNumber(value: number): Decimal {
    const scaled = Math.floor(value * Math.pow(10, Decimal.PRECISION));
    return new Decimal(BigInt(scaled));
  }

  static fromString(value: string): Decimal {
    const parts = value.split('.');
    const integerPart = BigInt(parts[0] || '0');
    const decimalPart = parts[1] || '';
    
    const paddedDecimal = decimalPart.padEnd(Decimal.PRECISION, '0').slice(0, Decimal.PRECISION);
    const decimalValue = BigInt(paddedDecimal);
    
    const scaledValue = integerPart * BigInt(10 ** Decimal.PRECISION) + decimalValue;
    return new Decimal(scaledValue);
  }

  static fromRaw(value: bigint, decimals: number): Decimal {
    if (decimals === Decimal.PRECISION) {
      return new Decimal(value);
    } else if (decimals < Decimal.PRECISION) {
      const scale = BigInt(10 ** (Decimal.PRECISION - decimals));
      return new Decimal(value * scale);
    } else {
      const scale = BigInt(10 ** (decimals - Decimal.PRECISION));
      return new Decimal(value / scale);
    }
  }

  asNumber(): number {
    return Number(this.value) / Math.pow(10, Decimal.PRECISION);
  }

  asBigInt(): bigint {
    // Returns the integer part of the decimal value
    return this.value / BigInt(10 ** Decimal.PRECISION);
  }

  add(other: Decimal): Decimal {
    return new Decimal(this.value + other.value);
  }

  sub(other: Decimal): Decimal {
    return new Decimal(this.value - other.value);
  }

  mul(other: Decimal): Decimal {
    const result = (this.value * other.value) / BigInt(10 ** Decimal.PRECISION);
    return new Decimal(result);
  }

  mulBigInt(other: bigint): Decimal {
    const result = this.value * other;
    return new Decimal(result);
  }

  div(number: bigint): Decimal {
    return new Decimal(this.value / number);
  }

  divDecimal(other: Decimal): Decimal {
    const result = (this.value * BigInt(10 ** Decimal.PRECISION)) / other.value;
    return new Decimal(result);
  }

  toString(): string {
    const isNegative = this.value < 0n;
    const absValue = isNegative ? -this.value : this.value;
    
    const integerPart = absValue / BigInt(10 ** Decimal.PRECISION);
    const decimalPart = absValue % BigInt(10 ** Decimal.PRECISION);
    
    const decimalStr = decimalPart.toString().padStart(Decimal.PRECISION, '0');
    const trimmedDecimal = decimalStr.replace(/0+$/, '');
    
    const sign = isNegative ? '-' : '';
    return trimmedDecimal ? `${sign}${integerPart}.${trimmedDecimal}` : `${sign}${integerPart}`;
  }

  toRaw(decimals: number): bigint {
    if (decimals === Decimal.PRECISION) {
      return this.value;
    } else if (decimals < Decimal.PRECISION) {
      const scale = BigInt(10 ** (Decimal.PRECISION - decimals));
      return this.value / scale;
    } else {
      const scale = BigInt(10 ** (decimals - Decimal.PRECISION));
      return this.value * scale;
    }
  }

  greaterThan(other: Decimal): boolean {
    return this.value > other.value;
  }

  lessThan(other: Decimal): boolean {
    return this.value < other.value;
  }

  equals(other: Decimal): boolean {
    return this.value === other.value;
  }

  min(other: Decimal): Decimal {
    if (this.lessThan(other)) {
      return this;
    }
    return other;
  }
  
  ceiling(): bigint {
    // Returns the ceiling of the decimal value as a bigint
    // Using the formula (value + WAD - 1) / WAD for positive values
    if (this.value <= 0n) {
      return this.value / Decimal.WAD;
    }
    return (this.value + Decimal.WAD - 1n) / Decimal.WAD;
  }

  floor(): bigint {
    return this.value / Decimal.WAD;
  }
  
  isZero(): boolean {
    return this.value === 0n;
  }

  static zero(): Decimal {
    return new Decimal(0n);
  }

  static one(): Decimal {
    return new Decimal(BigInt(10 ** Decimal.PRECISION));
  }

  get raw(): bigint {
    return this.value;
  }
}