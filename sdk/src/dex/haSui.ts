import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { QuoteOutput, QuoteSwapIn, SwapIn, SwapInOutput, TokenExchange } from '.';
import { isSuiCoinType } from '../utils/transaction-utils';
import { GET_OBJECT_INCLUDE_JSON, getObjectOrThrow } from '../utils/object-utils';
import { Decimal } from '../market-types';
import { LST_INFO, SUI_SYSTEM_STATE_ID } from '../config/lstInfo';

const LST = LST_INFO.haSui;
const DEFAULT_STAKE_VALIDATOR = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** Instant unstake fee divisor: fee = gross * service_fee / HAEDAL_CONFIG_FEE_SCALE (on-chain staking module). */
const HAEDAL_CONFIG_FEE_SCALE = 10_000_000n;

export interface HaSuiState {
    totalStaked: bigint;
    totalRewards: bigint;
    totalProtocolFees: bigint;
    uncollectedProtocolFees: bigint;
    totalUnstaked: bigint;
    lstSupply: bigint;
    serviceFee: bigint;
}

export async function fetchHaSuiState(client: SuiClient): Promise<HaSuiState> {
  const fields = await getObjectOrThrow(client, LST.liquidStakingInfoId, GET_OBJECT_INCLUDE_JSON);
  const cfg = fields.config;
  const totalStaked = BigInt(fields.total_staked);
  const totalRewards = BigInt(fields.total_rewards);
  const totalProtocolFees = BigInt(fields.total_protocol_fees);
  const uncollectedProtocolFees = BigInt(fields.uncollected_protocol_fees);
  const totalUnstaked = BigInt(fields.total_unstaked);
  const lstSupply = BigInt(fields.stsui_supply);
  const serviceFee = BigInt(cfg.service_fee);

  return {
    totalStaked,
    totalRewards,
    totalProtocolFees,
    uncollectedProtocolFees,
    totalUnstaked,
    lstSupply,
    serviceFee,
  };
}

export async function estimateMintAmount(client: SuiClient, suiAmountIn: bigint): Promise<bigint> {
  const state = await fetchHaSuiState(client);
  return lstFromSui(state, suiAmountIn);
}

export async function estimateRedeemAmount(client: SuiClient, haSuiAmountIn: bigint): Promise<bigint> {
  const state = await fetchHaSuiState(client);
  const gross = suiFromLstGross(state, haSuiAmountIn);
  return gross - (gross * state.serviceFee) / HAEDAL_CONFIG_FEE_SCALE;
}

export async function quoteSwapIn(client: SuiClient, params: QuoteSwapIn): Promise<QuoteOutput> {
  const isMint = isSuiCoinType(params.inCoinType);

  const amountOut = isMint
    ? await estimateMintAmount(client, params.amountIn)
    : await estimateRedeemAmount(client, params.amountIn);

  const avgPrice = Decimal.zero();

  return {
    dex: TokenExchange.HaSui,
    amountIn: params.amountIn,
    amountOut,
    avgPrice,
    priceImpact: 0,
  };
}

export class HaSui {
  private client: SuiClient;

  constructor(client: SuiClient) {
    this.client = client;
  }

  public static newInstance(client: SuiClient): HaSui {
    return new HaSui(client);
  }

  public async populateSwapIn(tx: Transaction, params: SwapIn): Promise<SwapInOutput> {
    if (isSuiCoinType(params.inCoinType)) {
      return this.mint(tx, params);
    }
    return this.redeem(tx, params);
  }

  private mint(tx: Transaction, params: SwapIn): SwapInOutput {
    const suiCoin =
            typeof params.coinId === 'string' ? tx.object(params.coinId) : params.coinId;

    const [lst] = tx.moveCall({
      target: `${LST.packageId}::staking::request_stake_coin`,
      arguments: [
        tx.object(SUI_SYSTEM_STATE_ID),
        tx.object(LST.liquidStakingInfoId),
        suiCoin,
        tx.pure.address(DEFAULT_STAKE_VALIDATOR),
      ],
    });

    return { coin: lst as TransactionObjectArgument };
  }

  private redeem(tx: Transaction, params: SwapIn): SwapInOutput {
    const lstCoin =
            typeof params.coinId === 'string' ? tx.object(params.coinId) : params.coinId;

    const [sui] = tx.moveCall({
      target: `${LST.packageId}::staking::request_unstake_instant_coin`,
      arguments: [
        tx.object(SUI_SYSTEM_STATE_ID),
        tx.object(LST.liquidStakingInfoId),
        lstCoin,
      ],
    });

    return { coin: sui as TransactionObjectArgument };
  }

  public async estimateMintAmount(suiAmountIn: bigint): Promise<bigint> {
    return estimateMintAmount(this.client, suiAmountIn);
  }

  public async estimateRedeemAmount(haSuiAmountIn: bigint): Promise<bigint> {
    return estimateRedeemAmount(this.client, haSuiAmountIn);
  }

  public async quoteSwapIn(params: QuoteSwapIn): Promise<QuoteOutput> {
    return quoteSwapIn(this.client, params);
  }
}

function totalSuiFromState(state: HaSuiState): bigint {
  return (
    state.totalStaked +
        state.totalRewards -
        state.totalProtocolFees -
        state.uncollectedProtocolFees -
        state.totalUnstaked
  );
}

function lstFromSui(state: HaSuiState, suiAmount: bigint): bigint {
  const totalSui = totalSuiFromState(state);
  if (totalSui === 0n || state.lstSupply === 0n) {
    return suiAmount;
  }
  return (state.lstSupply * suiAmount) / totalSui;
}

function suiFromLstGross(state: HaSuiState, lstAmount: bigint): bigint {
  const totalSui = totalSuiFromState(state);
  if (totalSui === 0n || state.lstSupply === 0n) {
    return lstAmount;
  }
  return (totalSui * lstAmount) / state.lstSupply;
}
