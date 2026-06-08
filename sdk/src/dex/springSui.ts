import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { QuoteOutput, QuoteSwapIn, SwapIn, SwapInOutput, TokenExchange } from '.';
import { LeverageError } from '../leverage-types';
import { isSuiCoinType } from '../utils/transaction-utils';
import { GET_OBJECT_INCLUDE_JSON, getObjectOrThrow } from '../utils/object-utils';
import { Decimal } from '../market-types';
import { LST_INFO, SUI_SYSTEM_STATE_ID } from '../config/lstInfo';

const LST = LST_INFO.springSui;
const SSUI_TYPE = `${LST.lstPackageId}::spring_sui::SPRING_SUI`;

const BPS_DENOMINATOR = 10_000n;

export interface SpringSuiState {
    totalSuiSupply: bigint;
    totalLstSupply: bigint;
    accruedSpreadFees: bigint;
    suiMintFeeBps: bigint;
    redeemFeeBps: bigint;
}

export async function fetchSpringSuiState(client: SuiClient): Promise<SpringSuiState> {
  const fields = await getObjectOrThrow(client, LST.liquidStakingInfoId, GET_OBJECT_INCLUDE_JSON);
  const accruedSpreadFees = BigInt(fields.accrued_spread_fees);
  const storage = fields.storage;
  const totalSuiSupplyRaw = BigInt(storage.total_sui_supply);
  const totalSuiSupply = totalSuiSupplyRaw - accruedSpreadFees;
  const cap = fields.lst_treasury_cap;
  const ts = cap.total_supply;
  const totalLstSupply = BigInt(ts.value);
  const feeFields = fields.fee_config.element;
  const suiMintFeeBps = BigInt(feeFields.sui_mint_fee_bps);
  const redeemFeeBps = BigInt(feeFields.redeem_fee_bps);

  return {
    totalSuiSupply,
    totalLstSupply,
    accruedSpreadFees,
    suiMintFeeBps,
    redeemFeeBps,
  };
}

export async function estimateMintAmount(
  client: SuiClient,
  suiAmountIn: bigint,
): Promise<bigint> {
  const state = await fetchSpringSuiState(client);
  const mintFee = calculateMintFee(suiAmountIn, state.suiMintFeeBps);
  const suiAfterFee = suiAmountIn - mintFee;

  if (state.totalSuiSupply === 0n || state.totalLstSupply === 0n) {
    return suiAfterFee; 
  }
  return (state.totalLstSupply * suiAfterFee) / state.totalSuiSupply;
}

export async function estimateRedeemAmount(
  client: SuiClient,
  ssuiAmountIn: bigint,
): Promise<bigint> {
  const state = await fetchSpringSuiState(client);

  if (state.totalLstSupply === 0n) {
    throw new Error('SpringSui total LST supply is zero');
  }

  const grossSuiAmount = (state.totalSuiSupply * ssuiAmountIn) / state.totalLstSupply;
  const redeemFee = calculateRedeemFee(grossSuiAmount, state.redeemFeeBps);
  const netSuiAmount = grossSuiAmount - redeemFee;

  if (netSuiAmount <= 0n) {
    throw new LeverageError('Redeem amount would be zero after fees');
  }

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
    dex: TokenExchange.SpringSui,
    amountIn: params.amountIn,
    amountOut,
    avgPrice,
    priceImpact: 0,
  };
}

export class SpringSui {
  private client: SuiClient;

  constructor(client: SuiClient) {
    this.client = client;
  }

  public static newInstance(client: SuiClient): SpringSui {
    return new SpringSui(client);
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
      target: `${LST.packageId}::liquid_staking::mint`,
      typeArguments: [SSUI_TYPE],
      arguments: [
        tx.object(LST.liquidStakingInfoId),
        tx.object(SUI_SYSTEM_STATE_ID),
        suiCoin,
      ],
    });

    return { coin: lst as TransactionObjectArgument };
  }

  private redeem(tx: Transaction, params: SwapIn): SwapInOutput {
    const lstCoin =
            typeof params.coinId === 'string' ? tx.object(params.coinId) : params.coinId;

    const [sui] = tx.moveCall({
      target: `${LST.packageId}::liquid_staking::redeem`,
      typeArguments: [SSUI_TYPE],
      arguments: [
        tx.object(LST.liquidStakingInfoId),
        lstCoin,
        tx.object(SUI_SYSTEM_STATE_ID),
      ],
    });

    return { coin: sui as TransactionObjectArgument };
  }

  public async estimateMintAmount(suiAmountIn: bigint): Promise<bigint> {
    return estimateMintAmount(this.client, suiAmountIn);
  }

  public async estimateRedeemAmount(ssuiAmountIn: bigint): Promise<bigint> {
    return estimateRedeemAmount(this.client, ssuiAmountIn);
  }

  public async quoteSwapIn(params: QuoteSwapIn): Promise<QuoteOutput> {
    return quoteSwapIn(this.client, params);
  }
}


function calculateMintFee(suiAmount: bigint, suiMintFeeBps: bigint): bigint {
  if (suiMintFeeBps === 0n) return 0n;
  return (suiAmount * suiMintFeeBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

function calculateRedeemFee(suiAmount: bigint, redeemFeeBps: bigint): bigint {
  if (redeemFeeBps === 0n) return 0n;
  return (suiAmount * redeemFeeBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}
