import { Decimal } from './decimal';
import { TypeName, AssetBorrow, AssetDeposit } from './assets';
import { CoinMetadata, getCoinMetadata, parseCoinDecimals } from '../utils/coin-metadata';
import { typeNameWithout0x } from '../utils/transaction-utils';
import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { coinMetadatas } from '../config/coins';
import { LendingError } from './errors';

export interface InterestModel {
  type: string;
  params: {
    baseBorrowRatePerSec: Decimal;
    borrowRateOnMidKink: Decimal;
    midKink: Decimal;
    borrowRateOnHighKink: Decimal;
    highKink: Decimal;
    maxBorrowRate: Decimal;
  };
}

export interface AssetConfig {
  minBorrowAmount: bigint;
  maxBorrowAmount: bigint;
  maxDepositAmount: bigint;
  repayFeeRate: Decimal;
  liquidationFeeRate: Decimal;
}

export interface RateLimitUsage {
  limit: bigint;
  usage: bigint;
}

export interface EModeParams {
  asset: string;
  oracleBaseToken: number;
  collateralFactor: Decimal;
  liquidationFactor: Decimal;
  liquidationIncentive: Decimal;
  borrowWeight: Decimal;
  maxBorrowAmount: bigint;
  currentBorrowAmount: bigint;
  flashLoanFeeRate: Decimal;
  depositLimiter: RateLimitUsage;
  borrowLimiter: RateLimitUsage;
}

export function getAvailableAmount(rateLimitUsage: RateLimitUsage): bigint {
  const available = rateLimitUsage.limit - rateLimitUsage.usage;
  return available > BigInt(0) ? available : BigInt(0);
}

export function borrowInterestRate(interestModel: InterestModel, utilizationRate: Decimal): Decimal {
  const model = interestModel.params;
  const baseRate = model.baseBorrowRatePerSec;
  const midKink = model.midKink;
  const highKink = model.highKink;
  const borrowRateOnMidKink = model.borrowRateOnMidKink;
  const borrowRateOnHighKink = model.borrowRateOnHighKink;
  const maxBorrowRate = model.maxBorrowRate;

  let borrowRate: Decimal;

  if (!utilizationRate.greaterThan(midKink)) {
    // util_rate <= mid_kink
    const weight = utilizationRate.divDecimal(midKink);
    const range = borrowRateOnMidKink.sub(baseRate);
    borrowRate = weight.mul(range).add(baseRate);
  } else if (!utilizationRate.greaterThan(highKink)) {
    // mid_kink < util_rate <= high_kink
    const weight = utilizationRate.sub(midKink).divDecimal(highKink.sub(midKink));
    const range = borrowRateOnHighKink.sub(borrowRateOnMidKink);
    borrowRate = weight.mul(range).add(borrowRateOnMidKink);
  } else {
    // util_rate > high_kink
    const one = Decimal.one();
    const weight = utilizationRate.sub(highKink).divDecimal(one.sub(highKink));
    const range = maxBorrowRate.sub(borrowRateOnHighKink);
    borrowRate = weight.mul(range).add(borrowRateOnHighKink);
  }

  return borrowRate;
}

export function depositInterestRate(interestModel: InterestModel, utilizationRate: Decimal, repayFeeRate: Decimal): Decimal {
  const borrowRate = borrowInterestRate(interestModel, utilizationRate);
  return borrowRate.mul(Decimal.one().sub(repayFeeRate)).mul(utilizationRate);
}

export class AssetConfiguration {
  constructor(
    public coinType: TypeName,
    public interestModel: InterestModel,
    public assetSetting: AssetConfig,
    public depositUsage: AssetDeposit,
    public borrowUsage: AssetBorrow,
    public borrowPaused: boolean = false,
    public depositPaused: boolean = false,
    public withdrawPaused: boolean = false,
    public liquidationPaused: boolean = false,
    public flashLoanPaused: boolean = false,
    public reserve: bigint = BigInt(0),
    public utilizationRate: Decimal = Decimal.zero(),
  ) {}

  public borrowInterestRate(utilizationRate: Decimal): Decimal {
    if (this.borrowPaused) {
      return Decimal.zero();
    }

    return borrowInterestRate(this.interestModel, utilizationRate);
  }

  public depositInterestRate(utilizationRate: Decimal, repayFeeRate: Decimal): Decimal {
    return depositInterestRate(this.interestModel, utilizationRate, repayFeeRate);
  }
}

export class EmodeGroupConfigurations {
  private emodeGroups: Map<EmodeGroupId, EModeParams[]>;

  constructor(emodeGroups: Map<EmodeGroupId, EModeParams[]>) {
    this.emodeGroups = emodeGroups;
  }

  public static singleEmodeGroup(group: EmodeGroupId, params: EModeParams[]): EmodeGroupConfigurations {
    const map = new Map();
    map.set(group, params);
    return new EmodeGroupConfigurations(map);
  }

  public getAssetInEmodeGroup(group: EmodeGroupId, asset: TypeName): EModeParams {
    const params = this.emodeGroups.get(group);
    if (!params) {
      throw new LendingError(`EMode group ${group} not found`, { details: { group } });
    }
    const key = typeNameWithout0x(asset);
    const found = params.find((p) => typeNameWithout0x(p.asset) === key);
    if (!found) {
      throw new LendingError(`Asset ${asset} not in emode group ${group}`, { details: { group, asset } });
    }
    return found;
  }

  public findAssetInEmodeGroup(group: EmodeGroupId, asset: TypeName): EModeParams | undefined {
    const params = this.emodeGroups.get(group);
    if (!params) return undefined;
    const key = typeNameWithout0x(asset);
    return params.find((p) => typeNameWithout0x(p.asset) === key);
  }
}

export interface MarketData {
  assets: AssetConfiguration[];
  emodeGroups: Map<EmodeGroupId, EModeParams[]>;
}

export interface CloseFactorConfig {
  closeFactor: Decimal;
  closeFactorBypassMinValue: bigint;
}

export interface CircuitBreakStatus {
  name: string;
  type: string;
  marketId: string;
  triggered: boolean;
}

export type EmodeGroupId = number;
export type EmodeGroupAssetsBorrows = Record<EmodeGroupId, Record<TypeName, Decimal>>;

export interface EmodeGroupInfo {
  groupId: EmodeGroupId;
  coinTypes: string[];
  assets: Record<string, string>; // coinType -> emode asset ID
  oracleBaseTokenId: number;
}

export interface ADLParams {
  targetAmount: Decimal;
  liquidationFactorBase: Decimal;
  liquidationFactorHourlyDrop: Decimal;
  liquidationIncentiveBase: Decimal;
  liquidationIncentiveDailyPenalty: Decimal;
  closeFactor: Decimal;
}

export interface ADLInfo {
  coinType: string;
  timestamp: number;
  params: ADLParams;
}

export interface ADLData {
  collaterals: Record<string, ADLInfo>;
  borrows: Record<number, Record<string, ADLInfo>>;
}

export class Market {
  private assetConfigurations: Map<TypeName, AssetConfiguration>;

  readonly coinMetadatas: Map<TypeName, CoinMetadata>;

  readonly typeName: TypeName;
  readonly id: string;

  readonly emodeGroups: EmodeGroupConfigurations;

  constructor(typeName: TypeName, id: string, assets: AssetConfiguration[], emodeGroups: Map<EmodeGroupId, EModeParams[]>, coinMetadatas: Map<TypeName, CoinMetadata>) {
    this.assetConfigurations = new Map();
    for (const asset of assets) {
      this.assetConfigurations.set(asset.coinType, asset);
    }

    this.emodeGroups = new EmodeGroupConfigurations(emodeGroups);

    this.coinMetadatas = coinMetadatas;
    this.typeName = typeName;
    this.id = id;
  }

  public static assetOnlyMarket(typeName: TypeName, id: string, assets: AssetConfiguration[]): Market {
    for (const asset of assets) {
      if (coinMetadatas.has(asset.coinType)) { throw new LendingError(`Unknown asset ${asset.coinType}`); }
    }
    return new Market(typeName, id, assets, new Map(), coinMetadatas);
  }

  /** @deprecated */
  public static async loadNewMarket(typeName: TypeName, id: string, marketData: MarketData, client: SuiClient, coinMetadatas: Map<TypeName, CoinMetadata> = new Map()): Promise<Market> {
    for (const asset of marketData.assets) {
      if (coinMetadatas.has(asset.coinType)) { continue; }

      const metadata = await getCoinMetadata(client, asset.coinType);
      coinMetadatas.set(asset.coinType, metadata);
    }

    return new Market(typeName, id, marketData.assets, marketData.emodeGroups, coinMetadatas);
  }

  public updateAssetPriceUsd(asset: TypeName, priceUsd: Decimal) {
    const borrow = this.getBorrow(asset);
    borrow.setPrice(priceUsd);
    
    const deposit = this.getDeposit(asset);
    deposit.setPrice(priceUsd);
  }

  public coinDecimal(coinType: TypeName): number {
    const key = typeNameWithout0x(coinType);
    const metadata = this.coinMetadatas.get(key);
    if (!metadata) {
      throw new Error('no coin type in market');
    }

    return metadata.decimals;
  }

  public assets(): AssetConfiguration[] {
    return Array.from(this.assetConfigurations.values());
  }

  public assetEmodeParams(emodeGroupId: EmodeGroupId, asset: TypeName): EModeParams {
    return this.emodeGroups.getAssetInEmodeGroup(emodeGroupId, asset);
  }

  public findAssetEmodeParams(emodeGroupId: EmodeGroupId, asset: TypeName): EModeParams | undefined {
    return this.emodeGroups.findAssetInEmodeGroup(emodeGroupId, asset);
  }

  public getBorrow(asset: TypeName): AssetBorrow {
    const key = typeNameWithout0x(asset);
    const config = this.assetConfigurations.get(key);
    if (!config) {
      throw new Error(`Borrow data not found for asset: ${asset}`);
    }
    return config.borrowUsage;
  }

  public getTokenEvaluation(amount: bigint, asset: TypeName): Decimal {
    const deposit = this.getDeposit(asset);

    const amountDecimal = Decimal.fromBigInt(amount);
    const price = deposit.price();
    const decimals = parseCoinDecimals(this.coinDecimal(asset));

    return amountDecimal.mul(price).divDecimal(decimals);
  }

  public getTokenAmountFromValuation(usd: Decimal, asset: TypeName): Decimal {
    const deposit = this.getDeposit(asset);

    const price = deposit.price();
    const decimals = parseCoinDecimals(this.coinDecimal(asset));
    
    return usd.divDecimal(price).mul(decimals);
  }

  public deriveDebtEvaluation(amount: bigint, asset: TypeName): Decimal {
    const borrow = this.getBorrow(asset);
    const price = borrow.price();
    const decimals = parseCoinDecimals(this.coinDecimal(asset));
    
    return Decimal.fromBigInt(amount).mul(price).divDecimal(decimals);
  }

  public getTokenUsdEvaluation(amount: bigint, asset: TypeName): Decimal {
    const deposit = this.getDeposit(asset);
    const amountDecimal = Decimal.fromBigInt(amount);
    const price = deposit.price();
    const decimals = parseCoinDecimals(this.coinDecimal(asset));
    return amountDecimal.mul(price).divDecimal(decimals);
  }

  public getTokenAmountFromUsdValuation(usd: Decimal, asset: TypeName): Decimal {
    const deposit = this.getDeposit(asset);
    const price = deposit.price();
    const decimals = parseCoinDecimals(this.coinDecimal(asset));
    return usd.divDecimal(price).mul(decimals);
  }

  public deriveDebtUsdEvaluation(amount: bigint, asset: TypeName): Decimal {
    const borrow = this.getBorrow(asset);
    const price = borrow.price();
    const decimals = parseCoinDecimals(this.coinDecimal(asset));
    return Decimal.fromBigInt(amount).mul(price).divDecimal(decimals);
  }

  public deriveDebtAmount(valuation: Decimal, asset: TypeName): Decimal {
    const borrow = this.getBorrow(asset);
    const price = borrow.price();
    const decimals = parseCoinDecimals(this.coinDecimal(asset));
    
    return valuation.divDecimal(price).mul(decimals);
  }

  public exchangeRate(asset: TypeName): Decimal {
    const deposit = this.getDeposit(asset);

    return deposit.exchangeRate();
  }

  public borrowIndex(asset: TypeName): Decimal {
    const borrow = this.getBorrow(asset);

    return borrow.borrowIndex();
  }

  public depositToCtokens(asset: TypeName, amount: bigint): bigint{
    const exchangeRate = this.exchangeRate(asset);
    return Decimal.fromBigInt(amount).divDecimal(exchangeRate).floor();
  }

  public getCashAvailable(asset: TypeName): bigint {
    const config = this.getAssetConfiguration(asset);
    if (config === null || config === undefined) {
      return 0n;
    }

    const deposit = this.getDeposit(asset);
    const borrow = this.getBorrow(asset);
    const reserve = config.reserve;

    return deposit.amount() - borrow.amount() - reserve;
  }

  public getDeposit(asset: TypeName): AssetDeposit {
    const key = typeNameWithout0x(asset);
    const config = this.assetConfigurations.get(key);
    if (!config) {
      throw new Error(`Deposit data not found for asset: ${asset}`);
    }
    return config.depositUsage;
  }

  public utilizationRate(asset: TypeName): Decimal {
    const key = typeNameWithout0x(asset);
    const config = this.assetConfigurations.get(key);
    if (!config) {
      throw new Error(`Asset configuration not found for: ${asset}`);
    }
    return config.utilizationRate;
  }

  public getAssetConfiguration(asset: TypeName): AssetConfiguration | undefined {
    const key = typeNameWithout0x(asset);
    return this.assetConfigurations.get(key);
  }

  public availableBorrowAmount(asset: TypeName, emodeGroupId: EmodeGroupId): bigint {
    const key = typeNameWithout0x(asset);
    const assetConfig = this.assetConfigurations.get(key);
    if (!assetConfig) {
      throw new Error(`Asset configuration not found for asset: ${asset}`);
    }

    const emodeGroup = this.emodeGroups.getAssetInEmodeGroup(emodeGroupId, key);
    return getAvailableAmount(emodeGroup.borrowLimiter);
  }

  public availableWithdrawAmount(asset: TypeName, emodeGroupId: EmodeGroupId): bigint {
    const key = typeNameWithout0x(asset);
    const assetConfig = this.assetConfigurations.get(key);
    if (!assetConfig) {
      throw new Error(`Asset configuration not found for asset: ${asset}`);
    }

    const emodeGroup = this.emodeGroups.getAssetInEmodeGroup(emodeGroupId, key);
    return getAvailableAmount(emodeGroup.depositLimiter);
  }
}