import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { QuoteOutput, QuoteSwapIn, SwapIn, SwapInOutput, TokenExchange } from '.';
import { isSuiCoinType } from '../utils/transaction-utils';
import { GET_OBJECT_INCLUDE_JSON, getObjectOrThrow } from '../utils/object-utils';
import { Decimal } from '../market-types';
import { LST_INFO, SUI_SYSTEM_STATE_ID } from '../config/lstInfo';

const LST = LST_INFO.vSui;
const VSUI_METADATA_OBJECT_ID = LST.extraIds.metadataId;

const BPS_DENOMINATOR = 10_000n;
const BURNED_CERT_AMOUNT = 157_564_800_000_000n;

export interface VSuiState {
    totalSuiSupply: bigint;
    totalLstSupply: bigint;
    stakeFeeBps: bigint;
    unstakeFeeBps: bigint;
}

export async function fetchVSuiState(client: SuiClient): Promise<VSuiState> {
  const [poolFields, metaFields] = await Promise.all([
    getObjectOrThrow(client, LST.liquidStakingInfoId, GET_OBJECT_INCLUDE_JSON),
    getObjectOrThrow(client, VSUI_METADATA_OBJECT_ID, GET_OBJECT_INCLUDE_JSON),
  ]);

  const validatorPool = poolFields.validator_pool;
  const totalSuiSupplyRaw = BigInt(validatorPool.total_sui_supply);
  const accruedRewardFees = BigInt(poolFields.accrued_reward_fees);
  const totalSuiSupply = totalSuiSupplyRaw - accruedRewardFees;
  const feeConfig = poolFields.fee_config;
  const stakeFeeBps = BigInt(feeConfig.stake_fee_bps);
  const unstakeFeeBps = BigInt(feeConfig.unstake_fee_bps);

  const totalSupplyField = metaFields.total_supply;
  const totalLstSupplyRaw = BigInt(totalSupplyField.value);
  const totalLstSupply = totalLstSupplyRaw - BURNED_CERT_AMOUNT;

  return {
    totalSuiSupply,
    totalLstSupply,
    stakeFeeBps,
    unstakeFeeBps,
  };
}

export async function estimateMintAmount(
  client: SuiClient,
  suiAmountIn: bigint,
): Promise<bigint> {
  const state = await fetchVSuiState(client);
  const mintFee = calculateStakeFee(suiAmountIn, state.stakeFeeBps);
  const suiAfterFee = suiAmountIn - mintFee;

  if (state.totalSuiSupply === 0n || state.totalLstSupply === 0n) {
    return suiAfterFee;
  }
  return (state.totalLstSupply * suiAfterFee) / state.totalSuiSupply;
}

export async function estimateRedeemAmount(
  client: SuiClient,
  vsuiAmountIn: bigint,
): Promise<bigint> {
  const state = await fetchVSuiState(client);

  if (state.totalLstSupply === 0n) {
    throw new Error('vSui total LST supply is zero');
  }

  const grossSuiAmount = (state.totalSuiSupply * vsuiAmountIn) / state.totalLstSupply;
  const redeemFee = calculateUnstakeFee(grossSuiAmount, state.unstakeFeeBps);
  const netSuiAmount = grossSuiAmount - redeemFee;

  return netSuiAmount;
}

export async function quoteSwapIn(
  client: SuiClient,
  params: QuoteSwapIn,
): Promise<QuoteOutput> {
  const isMint = isSuiCoinType(params.inCoinType);

  const amountOut = isMint
    ? await estimateMintAmount(client, params.amountIn)
    : await estimateRedeemAmount(client, params.amountIn);

  const avgPrice = Decimal.zero();

  return {
    dex: TokenExchange.VSui,
    amountIn: params.amountIn,
    amountOut,
    avgPrice,
    priceImpact: 0,
  };
}

export class VSui {
  private client: SuiClient;

  constructor(client: SuiClient) {
    this.client = client;
  }

  public static newInstance(client: SuiClient): VSui {
    return new VSui(client);
  }

  public async populateSwapIn(tx: Transaction, params: SwapIn): Promise<SwapInOutput> {
    if (isSuiCoinType(params.inCoinType)) {
      return this.stake(tx, params);
    }
    return this.unstake(tx, params);
  }

  private stake(tx: Transaction, params: SwapIn): SwapInOutput {
    const suiCoin =
            typeof params.coinId === 'string' ? tx.object(params.coinId) : params.coinId;

    const [cert] = tx.moveCall({
      target: `${LST.packageId}::stake_pool::stake`,
      arguments: [
        tx.object(LST.liquidStakingInfoId),
        tx.object(VSUI_METADATA_OBJECT_ID),
        tx.object(SUI_SYSTEM_STATE_ID),
        suiCoin,
      ],
    });
    return { coin: cert as TransactionObjectArgument };
  }

  private unstake(tx: Transaction, params: SwapIn): SwapInOutput {
    const lstCoin =
            typeof params.coinId === 'string' ? tx.object(params.coinId) : params.coinId;

    const [sui] = tx.moveCall({
      target: `${LST.packageId}::stake_pool::unstake`,
      arguments: [
        tx.object(LST.liquidStakingInfoId),
        tx.object(VSUI_METADATA_OBJECT_ID),
        tx.object(SUI_SYSTEM_STATE_ID),
        lstCoin,
      ],
    });
    return { coin: sui as TransactionObjectArgument };
  }

  public async estimateMintAmount(suiAmountIn: bigint): Promise<bigint> {
    return estimateMintAmount(this.client, suiAmountIn);
  }

  public async estimateRedeemAmount(vsuiAmountIn: bigint): Promise<bigint> {
    return estimateRedeemAmount(this.client, vsuiAmountIn);
  }

  public async quoteSwapIn(params: QuoteSwapIn): Promise<QuoteOutput> {
    return quoteSwapIn(this.client, params);
  }
}

function calculateStakeFee(suiAmount: bigint, stakeFeeBps: bigint): bigint {
  if (stakeFeeBps === 0n) return 0n;
  return (suiAmount * stakeFeeBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

function calculateUnstakeFee(suiAmount: bigint, unstakeFeeBps: bigint): bigint {
  if (unstakeFeeBps === 0n) return 0n;
  return (suiAmount * unstakeFeeBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}
