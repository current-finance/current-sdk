import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { NetworkConfig, MarketWithEmodes } from '../config/networks';
import { AssetConfig, AssetConfiguration, EModeParams, InterestModel, CircuitBreakStatus } from '../market-types/market';
import { TypeName, AssetBorrow, AssetDeposit, AssetValuation } from '../market-types/assets';
import { Decimal } from '../market-types/decimal';
import { GET_OBJECT_INCLUDE_JSON_TYPE, getObjectOrThrow } from '../utils/object-utils';
import { simulateTransactionChecked } from '../utils/transaction-utils';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000000';

interface ObligationOverviewBorrow {
  asset: TypeName;
  borrowIndex: Decimal;
  debt: Decimal;
}

interface ObligationOverviewDeposit {
  asset: TypeName;
  ctokenAmount: bigint;
}

interface ObligationOverview {
  emodeGroupId: number;
  borrows: ObligationOverviewBorrow[];
  deposits: ObligationOverviewDeposit[];
}

export interface AssetPrice {
  assetType: TypeName;
  price: number | Decimal;
}

export class QueryClient {
  private provider: SuiClient;
  private protocolPackageId: string;
  private coinDecimalsRegistryId: string;
  private markets: MarketWithEmodes[];

  constructor(provider: SuiClient, config: NetworkConfig) {
    this.provider = provider;
    this.protocolPackageId = config.protocolPackageId;
    this.coinDecimalsRegistryId = config.coinDecimalsRegistryId;
    this.markets = config.markets;
  }

  private static readonly U64_MAX = 18446744073709551615n;

  public async getAssetMarketOverview(
    marketType: TypeName,
    assetType: TypeName,
    price: number | Decimal,
  ): Promise<AssetConfiguration> {
    const market = this.resolveMarket(marketType);
    const tx = new Transaction();
    const { numerator, denominator } = this.toPriceInput(price);

    tx.moveCall({
      target: `${this.protocolPackageId}::market_query::get_asset_market_overview`,
      arguments: [
        tx.object(market.objectId),
        tx.pure.string(assetType),
        tx.object(this.coinDecimalsRegistryId),
        tx.pure.u64(numerator),
        tx.pure.u64(denominator),
        tx.object('0x6'),
      ],
      typeArguments: [marketType],
    });

    tx.setSenderIfNotSet(ZERO_ADDRESS);
    const result = await simulateTransactionChecked(this.provider, tx, false);

    if (!result.commandResults || result.commandResults.length === 0) {
      throw new Error('No results from market overview query');
    }

    return this.parseAssetConfiguration(result.commandResults[result.commandResults.length - 1].returnValues[0].bcs);
  }

  public async getAssetsMarketOverview(
    marketType: TypeName,
    assets: AssetPrice[],
  ): Promise<AssetConfiguration[]> {
    const market = this.resolveMarket(marketType);
    const tx = new Transaction();

    for (const { assetType, price } of assets) {
      const { numerator, denominator } = this.toPriceInput(price);
      tx.moveCall({
        target: `${this.protocolPackageId}::market_query::get_asset_market_overview`,
        arguments: [
          tx.object(market.objectId),
          tx.pure.string(assetType),
          tx.object(this.coinDecimalsRegistryId),
          tx.pure.u64(numerator),
          tx.pure.u64(denominator),
          tx.object('0x6'),
        ],
        typeArguments: [marketType],
      });
    }

    tx.setSenderIfNotSet(ZERO_ADDRESS);
    const result = await simulateTransactionChecked(this.provider, tx, false);

    if (!result.commandResults || result.commandResults.length === 0) {
      throw new Error('No results from market assets overview query');
    }

    const assetResults: AssetConfiguration[] = [];
    for (const r of result.commandResults) {
      if (r.returnValues && r.returnValues.length > 0) {
        assetResults.push(this.parseAssetConfiguration(r.returnValues[0].bcs));
      }
    }

    return assetResults;
  }

  public async getAssetMarketRates(
    marketType: TypeName,
    assetType: TypeName,
  ): Promise<{ exchangeRate: Decimal; borrowIndex: Decimal }> {
    const market = this.resolveMarket(marketType);
    const tx = new Transaction();

    tx.moveCall({
      target: `${this.protocolPackageId}::market_query::get_asset_market_rates`,
      arguments: [
        tx.object(market.objectId),
        tx.pure.string(assetType),
        tx.object('0x6'),
      ],
      typeArguments: [marketType],
    });

    tx.setSenderIfNotSet(ZERO_ADDRESS);
    const result = await simulateTransactionChecked(this.provider, tx, false);

    if (!result.commandResults || result.commandResults.length === 0) {
      throw new Error('No results from asset market rates query');
    }

    const returnData = result.commandResults[result.commandResults.length - 1].returnValues[0].bcs;
    const { decimalSchema } = this.createBcsSchemas();
    const parsed = bcs.vector(decimalSchema).parse(new Uint8Array(returnData));

    return {
      exchangeRate: new Decimal(BigInt(parsed[0].value)),
      borrowIndex: new Decimal(BigInt(parsed[1].value)),
    };
  }

  public async getAssetsMarketRates(
    marketType: TypeName,
    assetTypes: TypeName[],
  ): Promise<{ assetType: TypeName; exchangeRate: Decimal; borrowIndex: Decimal }[]> {
    const market = this.resolveMarket(marketType);
    const tx = new Transaction();

    for (const assetType of assetTypes) {
      tx.moveCall({
        target: `${this.protocolPackageId}::market_query::get_asset_market_rates`,
        arguments: [
          tx.object(market.objectId),
          tx.pure.string(assetType),
          tx.object('0x6'),
        ],
        typeArguments: [marketType],
      });
    }

    tx.setSenderIfNotSet(ZERO_ADDRESS);
    const result = await simulateTransactionChecked(this.provider, tx, false);

    if (!result.commandResults || result.commandResults.length === 0) {
      throw new Error('No results from assets market rates query');
    }

    const { decimalSchema } = this.createBcsSchemas();
    const rates: { assetType: TypeName; exchangeRate: Decimal; borrowIndex: Decimal }[] = [];

    for (let i = 0; i < result.commandResults.length; i++) {
      const r = result.commandResults[i];
      if (r.returnValues && r.returnValues.length > 0) {
        const parsed = bcs.vector(decimalSchema).parse(new Uint8Array(r.returnValues[0].bcs));
        rates.push({
          assetType: assetTypes[i],
          exchangeRate: new Decimal(BigInt(parsed[0].value)),
          borrowIndex: new Decimal(BigInt(parsed[1].value)),
        });
      }
    }

    return rates;
  }

  public async getMarketEmodeGroupOverview(
    marketType: TypeName,
    emodeGroup: number,
    assets: TypeName[],
  ): Promise<EModeParams[]> {
    const market = this.resolveMarket(marketType);
    const tx = new Transaction();

    tx.moveCall({
      target: `${this.protocolPackageId}::market_query::get_market_emode_group_overview`,
      arguments: [
        tx.object(market.objectId),
        tx.pure.u8(emodeGroup),
        tx.pure(bcs.vector(bcs.string()).serialize(assets)),
        tx.object('0x6'),
      ],
      typeArguments: [marketType],
    });

    tx.setSenderIfNotSet(ZERO_ADDRESS);
    const result = await simulateTransactionChecked(this.provider, tx, false);

    if (!result.commandResults || result.commandResults.length === 0) {
      throw new Error('No results from emode group overview query');
    }

    const returnData = result.commandResults[0].returnValues[0].bcs;
    const { eModeInfoSchema } = this.createBcsSchemas();
    const parsed = bcs.vector(eModeInfoSchema).parse(new Uint8Array(returnData));

    return parsed.map((info: any) => this.parseEModeInfo(info));
  }

  public getSupportedAssets(marketType: TypeName, emodeGroup: number): TypeName[] {
    const market = this.resolveMarket(marketType);
    return market.emodeGroups[emodeGroup].assets;
  }

  public getAllAssetsInMarket(marketType: TypeName): TypeName[] {
    const market = this.resolveMarket(marketType);

    const set: Set<TypeName> = new Set();
    for (const group of market.emodeGroups) {
      group.assets.forEach(asset => set.add(asset));
    }

    return [...set];
  }

  public async getCircuitBreakStatus(marketId: string): Promise<boolean> {
    const dfs = await this.provider.listDynamicFields({ parentId: marketId });
    const status = dfs.dynamicFields.find((field) => field.name?.type?.endsWith('::market::CircuitBreakKey'));
    if (!status) {
      throw new Error(`CircuitBreakKey dynamic field not found on market ${marketId}`);
    }
    const json = await getObjectOrThrow(this.provider, status.fieldId, GET_OBJECT_INCLUDE_JSON_TYPE);
    return Boolean(json.value);
  }

  public async getAllCircuitBreakStatus(): Promise<CircuitBreakStatus[]> {
    return Promise.all(
      this.markets.map(async (market) => ({
        name: market.name,
        type: market.type,
        marketId: market.objectId,
        triggered: await this.getCircuitBreakStatus(market.objectId),
      })),
    );
  }

  public async getObligationOwnerCapDetail(obligationOwnerCapId: string): Promise<{ obligationId: string; marketType: TypeName; marketId: string }> {
    const j = await getObjectOrThrow(this.provider, obligationOwnerCapId, GET_OBJECT_INCLUDE_JSON_TYPE);
    return {
      obligationId: j.obligation_id,
      marketType: j.market_type,
      marketId: j.market_id,
    };
  }

  public async getObligationIdFromOwnerCapId(obligationOwnerCapId: string): Promise<string> {
    const j = await getObjectOrThrow(this.provider, obligationOwnerCapId, GET_OBJECT_INCLUDE_JSON_TYPE);
    return j.obligation_id;
  }

  public async getObligationAssets(
    marketType: TypeName,
    obligationId: string,
  ): Promise<{ debtTypes: TypeName[]; depositTypes: TypeName[] }> {
    const market = this.resolveMarket(marketType);
    const tx = new Transaction();

    tx.moveCall({
      target: `${this.protocolPackageId}::obligation_query::get_obligation_assets`,
      arguments: [
        tx.object(market.objectId),
        tx.pure.id(obligationId),
      ],
      typeArguments: [marketType],
    });

    tx.setSenderIfNotSet(ZERO_ADDRESS);
    const result = await simulateTransactionChecked(this.provider, tx, false);

    if (!result.commandResults || result.commandResults.length === 0) {
      throw new Error('No results from obligation assets query');
    }

    const r = result.commandResults[0];
    if (!r.returnValues || r.returnValues.length < 2) {
      throw new Error('Invalid return values from obligation assets query');
    }

    const debtTypes = bcs.vector(bcs.string()).parse(new Uint8Array(r.returnValues[0].bcs));
    const depositTypes = bcs.vector(bcs.string()).parse(new Uint8Array(r.returnValues[1].bcs));

    return { debtTypes, depositTypes };
  }

  public async getObligationOverview(
    marketType: TypeName,
    obligationId: string,
  ): Promise<ObligationOverview> {
    const market = this.resolveMarket(marketType);
    const tx = new Transaction();

    tx.moveCall({
      target: `${this.protocolPackageId}::obligation_query::get_obligation_overview`,
      arguments: [
        tx.object(market.objectId),
        tx.pure.id(obligationId),
      ],
      typeArguments: [marketType],
    });

    tx.setSenderIfNotSet(ZERO_ADDRESS);
    const result = await simulateTransactionChecked(this.provider, tx, false);

    if (!result.commandResults || result.commandResults.length === 0) {
      throw new Error('No results from obligation overview query');
    }

    return this.parseObligationOverview(result.commandResults[result.commandResults.length - 1].returnValues[0].bcs);
  }

  private parseAssetConfiguration(returnValues: any): AssetConfiguration {
    if (!returnValues) {
      throw new Error('No return values for asset data parsing');
    }

    const { assetDataSchema } = this.createBcsSchemas();
    const asset = assetDataSchema.parse(new Uint8Array(returnValues));

    const depositValuation: AssetValuation = {
      coinType: asset.deposit_usage.valuation.coin_type,
      amount: BigInt(asset.deposit_usage.valuation.amount),
      usd: new Decimal(BigInt(asset.deposit_usage.valuation.usd.value)),
      price: new Decimal(BigInt(asset.deposit_usage.valuation.price.value)),
    };

    const borrowValuation: AssetValuation = {
      coinType: asset.borrow_usage.valuation.coin_type,
      amount: BigInt(asset.borrow_usage.valuation.amount),
      usd: new Decimal(BigInt(asset.borrow_usage.valuation.usd.value)),
      price: new Decimal(BigInt(asset.borrow_usage.valuation.price.value)),
    };

    const interestModel: InterestModel = {
      type: 'kinked_rate_model',
      params: {
        baseBorrowRatePerSec: new Decimal(BigInt(asset.interest_model.base_borrow_rate_per_sec.value)),
        borrowRateOnMidKink: new Decimal(BigInt(asset.interest_model.borrow_rate_on_mid_kink.value)),
        midKink: new Decimal(BigInt(asset.interest_model.mid_kink.value)),
        borrowRateOnHighKink: new Decimal(BigInt(asset.interest_model.borrow_rate_on_high_kink.value)),
        highKink: new Decimal(BigInt(asset.interest_model.high_kink.value)),
        maxBorrowRate: new Decimal(BigInt(asset.interest_model.max_borrow_rate.value)),
      },
    };

    const assetSetting: AssetConfig = {
      minBorrowAmount: BigInt(asset.asset_setting.min_borrow_amount),
      maxBorrowAmount: BigInt(asset.asset_setting.max_borrow_amount),
      maxDepositAmount: BigInt(asset.asset_setting.max_deposit_amount),
      repayFeeRate: new Decimal(BigInt(asset.asset_setting.repay_fee_rate.value)),
      liquidationFeeRate: new Decimal(BigInt(asset.asset_setting.liquidation_fee_rate.value)),
    };

    const depositUsage = new AssetDeposit(
      depositValuation,
      BigInt(asset.deposit_usage.ctoken_amount),
      new Decimal(BigInt(asset.deposit_usage.exchange_rate.value)),
    );

    const borrowUsage = new AssetBorrow(
      borrowValuation,
      new Decimal(BigInt(asset.borrow_usage.borrow_index.value)),
    );

    return new AssetConfiguration(
      asset.coin_type,
      interestModel,
      assetSetting,
      depositUsage,
      borrowUsage,
      asset.borrow_paused,
      asset.deposit_paused,
      asset.withdraw_paused,
      asset.liquidation_paused,
      asset.flash_loan_paused,
      BigInt(asset.reserve),
      new Decimal(BigInt(asset.utilization_rate.value)),
    );
  }

  private parseObligationOverview(returnValues: any): ObligationOverview {
    if (!returnValues) {
      throw new Error('No return values for obligation overview parsing');
    }

    const { decimalSchema } = this.createBcsSchemas();

    const overviewBorrowSchema = bcs.struct('ObligationBorrow', {
      asset: bcs.string(),
      borrow_index: decimalSchema,
      debt: decimalSchema,
    });

    const overviewDepositSchema = bcs.struct('ObligationDeposit', {
      asset: bcs.string(),
      ctoken_amount: bcs.u64(),
    });

    const overviewSchema = bcs.struct('ObligationDetail', {
      emode_group_id: bcs.u8(),
      borrows: bcs.vector(overviewBorrowSchema),
      deposits: bcs.vector(overviewDepositSchema),
    });

    const parsed = overviewSchema.parse(new Uint8Array(returnValues));

    return {
      emodeGroupId: parsed.emode_group_id,
      borrows: parsed.borrows.map((b: any) => ({
        asset: b.asset,
        borrowIndex: new Decimal(BigInt(b.borrow_index.value)),
        debt: new Decimal(BigInt(b.debt.value)),
      })),
      deposits: parsed.deposits.map((d: any) => ({
        asset: d.asset,
        ctokenAmount: BigInt(d.ctoken_amount),
      })),
    };
  }

  private resolveMarket(marketType: TypeName): MarketWithEmodes {
    marketType = marketType.startsWith('0x') ? marketType : `0x${marketType}`;
    const market = this.markets.find(m => m.type === marketType);
    if (!market) {
      throw new Error(`Market with type '${marketType}' not found in config`);
    }
    return market;
  }

  private toPriceInput(price: number | Decimal): { numerator: bigint; denominator: bigint } {
    const decimal = price instanceof Decimal ? price : Decimal.fromString(price.toString());
    let numerator = decimal.raw;
    let denominator = 10n ** 18n;

    // Scale down to fit u64 if needed
    while (numerator > QueryClient.U64_MAX || denominator > QueryClient.U64_MAX) {
      numerator /= 10n;
      denominator /= 10n;
    }

    return { numerator, denominator };
  }

  private parseEModeInfo(parsed: any): EModeParams {
    if (!parsed) {
      throw new Error('No EModeInfo data provided');
    }

    return {
      asset: parsed.asset,
      oracleBaseToken: parsed.oracle_base_token.id,
      collateralFactor: new Decimal(BigInt(parsed.collateral_factor.value)),
      liquidationFactor: new Decimal(BigInt(parsed.liquidation_factor.value)),
      liquidationIncentive: new Decimal(BigInt(parsed.liquidation_incentive.value)),
      borrowWeight: new Decimal(BigInt(parsed.borrow_weight.value)),
      maxBorrowAmount: BigInt(parsed.max_borrow_amount),
      currentBorrowAmount: BigInt(parsed.current_borrow_amount),
      flashLoanFeeRate: new Decimal(BigInt(parsed.flash_loan_fee_rate.value)),
      depositLimiter: {
        limit: BigInt(parsed.deposit_limiter.limit),
        usage: BigInt(parsed.deposit_limiter.usage),
      },
      borrowLimiter: {
        limit: BigInt(parsed.borrow_limiter.limit),
        usage: BigInt(parsed.borrow_limiter.usage),
      },
    };
  }

  private createBcsSchemas() {
    const decimalSchema = bcs.struct('Decimal', {
      value: bcs.u256(),
    });

    const assetValuationSchema = bcs.struct('AssetValuation', {
      coin_type: bcs.string(),
      amount: bcs.u64(),
      usd: decimalSchema,
      price: decimalSchema,
    });

    const assetBorrowSchema = bcs.struct('AssetBorrow', {
      valuation: assetValuationSchema,
      borrow_index: decimalSchema,
    });

    const assetDepositSchema = bcs.struct('AssetDeposit', {
      is_collateral: bcs.bool(),
      valuation: assetValuationSchema,
      ctoken_amount: bcs.u64(),
      exchange_rate: decimalSchema,
    });

    const interestModelSchema = bcs.struct('InterestModel', {
      base_borrow_rate_per_sec: decimalSchema,
      borrow_rate_on_mid_kink: decimalSchema,
      mid_kink: decimalSchema,
      borrow_rate_on_high_kink: decimalSchema,
      high_kink: decimalSchema,
      max_borrow_rate: decimalSchema,
    });

    const borrowConfigSchema = bcs.struct('BorrowConfig', {
      min_borrow_amount: bcs.u64(),
      max_borrow_amount: bcs.u64(),
      max_deposit_amount: bcs.u64(),
      repay_fee_rate: decimalSchema,
      liquidation_fee_rate: decimalSchema,
    });

    const rateLimitUsageSchema = bcs.struct('RateLimitUsage', {
      limit: bcs.u64(),
      usage: bcs.u64(),
    });

    const baseTokenSchema = bcs.struct('BaseToken', {
      id: bcs.u8(),
    });

    const assetDataSchema = bcs.struct('AssetConfiguration', {
      coin_type: bcs.string(),
      interest_model: interestModelSchema,
      utilization_rate: decimalSchema,
      borrow_paused: bcs.bool(),
      deposit_paused: bcs.bool(),
      withdraw_paused: bcs.bool(),
      liquidation_paused: bcs.bool(),
      flash_loan_paused: bcs.bool(),
      reserve: bcs.u64(),
      asset_setting: borrowConfigSchema,
      deposit_usage: assetDepositSchema,
      borrow_usage: assetBorrowSchema,
    });

    const eModeInfoSchema = bcs.struct('EModeInfo', {
      asset: bcs.string(),
      oracle_base_token: baseTokenSchema,
      collateral_factor: decimalSchema,
      liquidation_factor: decimalSchema,
      liquidation_incentive: decimalSchema,
      borrow_weight: decimalSchema,
      max_borrow_amount: bcs.u64(),
      current_borrow_amount: bcs.u64(),
      flash_loan_fee_rate: decimalSchema,
      deposit_limiter: rateLimitUsageSchema,
      borrow_limiter: rateLimitUsageSchema,
    });

    return {
      decimalSchema,
      assetValuationSchema,
      assetBorrowSchema,
      assetDepositSchema,
      interestModelSchema,
      borrowConfigSchema,
      rateLimitUsageSchema,
      baseTokenSchema,
      assetDataSchema,
      eModeInfoSchema,
    };
  }
}
