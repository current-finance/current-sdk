import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { QuoteOutput, QuoteSwapIn, SwapIn, SwapInOutput, TokenExchange } from '.';
import { isUnderlyingCoinType } from '../utils/transaction-utils';
import { GET_OBJECT_INCLUDE_JSON, getObjectOrThrow } from '../utils/object-utils';
import { EMBER_INFO } from '../config/emberInfo';
import { Decimal } from '../market-types';
import { normalizeStructTag, SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';

const EMBER = EMBER_INFO;
const BASE = 1_000_000_000n;

type EmberVaultKey = keyof typeof EMBER_INFO.vaults;

export interface EmberVaultState {
    exchangeRate: bigint; // base: 1e9
}

async function fetchEmberVaultState(
  client: SuiClient,
  vaultKey: EmberVaultKey,
): Promise<EmberVaultState> {
  const fields = await getObjectOrThrow(client, EMBER.vaults[vaultKey].id, GET_OBJECT_INCLUDE_JSON);
  const rate = fields.rate;
  const exchangeRate = BigInt(rate.value);

  return {
    exchangeRate,
  };
}

function shareFromUnderlyingAsset(state: EmberVaultState, underlyingAssetAmount: bigint): bigint {
  return (state.exchangeRate * underlyingAssetAmount) / BASE;
}

async function estimateEmberMintAmount(
  client: SuiClient,
  vaultKey: EmberVaultKey,
  underlyingAmountIn: bigint,
): Promise<bigint> {
  const state = await fetchEmberVaultState(client, vaultKey);
  return shareFromUnderlyingAsset(state, underlyingAmountIn);
}

async function quoteEmberSwapIn(
  client: SuiClient,
  vaultKey: EmberVaultKey,
  dex: TokenExchange,
  label: string,
  params: QuoteSwapIn,
): Promise<QuoteOutput> {
  const underlying = EMBER.vaults[vaultKey].underlyingCoinType;
  const isMint = isUnderlyingCoinType(params.inCoinType, underlying);

  if (!isMint) {
    throw new Error(`Redeem not supported for ${label}`);
  }
  const amountOut = await estimateEmberMintAmount(client, vaultKey, params.amountIn);
  const avgPrice = Decimal.zero();

  return {
    dex,
    amountIn: params.amountIn,
    amountOut,
    avgPrice,
    priceImpact: 0,
  };
}

export class EmberVault {
  private readonly client: SuiClient;
  private readonly vaultKey: EmberVaultKey;
  private readonly dex: TokenExchange;
  private readonly label: string;

  constructor(client: SuiClient, vaultKey: EmberVaultKey, dex: TokenExchange, label: string) {
    this.client = client;
    this.vaultKey = vaultKey;
    this.dex = dex;
    this.label = label;
  }

  public async populateSwapIn(tx: Transaction, params: SwapIn): Promise<SwapInOutput> {
    const underlying = EMBER.vaults[this.vaultKey].underlyingCoinType;
    if (isUnderlyingCoinType(params.inCoinType, underlying)) {
      return this.mint(tx, params);
    }
    throw new Error(`Redeem not supported for ${this.label}`);
  }

  private mint(tx: Transaction, params: SwapIn): SwapInOutput {
    const underlying = EMBER.vaults[this.vaultKey].underlyingCoinType;
    if (!isUnderlyingCoinType(params.inCoinType, underlying)) {
      throw new Error('Invalid input coin type');
    }
    if (params.outCoinType != EMBER.vaults[this.vaultKey].fullCoinType) {
      throw new Error('Invalid output coin type');
    }

    const underlyingCoin =
            typeof params.coinId === 'string' ? tx.object(params.coinId) : params.coinId;

    const inType = normalizeStructTag(params.inCoinType);
    const outType = normalizeStructTag(params.outCoinType);

    const underlyingBalance = tx.moveCall({
      target: '0x2::coin::into_balance',
      typeArguments: [inType],
      arguments: [underlyingCoin],
    });

    const outCoin = tx.moveCall({
      target: `${EMBER.packageId}::vault::deposit_asset_v2`,
      arguments: [
        tx.object(EMBER.vaults[this.vaultKey].id),
        tx.object(EMBER.protocolConfigId),
        underlyingBalance,
        tx.pure.u64(params.minOutAmount),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
      typeArguments: [inType, outType],
    });

    return { coin: outCoin as TransactionObjectArgument };
  }

  public async estimateMintAmount(underlyingAmountIn: bigint): Promise<bigint> {
    return estimateEmberMintAmount(this.client, this.vaultKey, underlyingAmountIn);
  }

  public async quoteSwapIn(params: QuoteSwapIn): Promise<QuoteOutput> {
    return quoteEmberSwapIn(this.client, this.vaultKey, this.dex, this.label, params);
  }
}
