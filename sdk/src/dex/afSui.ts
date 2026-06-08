import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { bcs } from '@mysten/sui/bcs';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { QuoteOutput, QuoteSwapIn, SwapIn, SwapInOutput, TokenExchange } from '.';
import { isSuiCoinType } from '../utils/transaction-utils';
import { GET_OBJECT_INCLUDE_JSON, getObjectJsonOrNull, getObjectOrThrow, getDynamicFieldJsonOrNull } from '../utils/object-utils';
import { Decimal } from '../market-types';
import { LST_INFO, SUI_SYSTEM_STATE_ID } from '../config/lstInfo';

const afSuiLstConfig = LST_INFO.afSui;
const VAULT_STATE_ID = afSuiLstConfig.extraIds.vaultState;
const AFSUI_TREASURY_CAP_SAFE_ID = afSuiLstConfig.extraIds.safe;
const REFERRAL_VAULT_ID = afSuiLstConfig.extraIds.referralVault;
const PROTOCOL_TREASURY_ID = afSuiLstConfig.extraIds.treasury;

const WAD = 1_000_000_000_000_000_000n;

export interface AfSuiVaultState {
    totalSuiAmount: bigint;
    atomicUnstakeSuiReserves: bigint;
    atomicUnstakeSuiReservesTarget: bigint;
    atomicUnstakeMaxFee: bigint;
    atomicUnstakeMinFee: bigint;
    atomicTreasuryAllocation: bigint;
    atomicDevWalletAllocation: bigint;
    atomicCrankIncentiveAllocation: bigint;
    atomicRefereeDiscount: bigint;
    validatorConfigsTableId: string;
}

export async function fetchAfSuiVaultState(client: SuiClient): Promise<AfSuiVaultState> {
  const vaultFields = await getObjectOrThrow(client, VAULT_STATE_ID, GET_OBJECT_INCLUDE_JSON);
  const protocolConfig = vaultFields.protocol_config;
  const atomicUnstakeFee = protocolConfig.atomic_unstake_protocol_fee;
  const validatorConfigsTableId = vaultFields.validator_configs.id;

  return {
    totalSuiAmount: BigInt(vaultFields.total_sui_amount),
    atomicUnstakeSuiReserves: BigInt(vaultFields.atomic_unstake_sui_reserves as string),
    atomicUnstakeSuiReservesTarget: BigInt(protocolConfig.atomic_unstake_sui_reserves_target_value),
    atomicUnstakeMaxFee: BigInt(atomicUnstakeFee.max_fee),
    atomicUnstakeMinFee: BigInt(atomicUnstakeFee.min_fee),
    atomicTreasuryAllocation: BigInt(atomicUnstakeFee.treasury_allocation),
    atomicDevWalletAllocation: BigInt(atomicUnstakeFee.dev_wallet_allocation),
    atomicCrankIncentiveAllocation: BigInt(atomicUnstakeFee.crank_incentive_allocation),
    atomicRefereeDiscount: BigInt(atomicUnstakeFee.referee_discount),
    validatorConfigsTableId,
  };
}

async function fetchAfsuiSupplyFromSafe(client: SuiClient): Promise<bigint> {
  const json = await getObjectOrThrow(client, AFSUI_TREASURY_CAP_SAFE_ID, GET_OBJECT_INCLUDE_JSON);
  return BigInt(json.obj.total_supply.value);
}

async function fetchValidatorFeeWad(
  client: SuiClient,
  validatorConfigsTableId: string,
  validatorAddress: string,
): Promise<bigint> {
  const validatorConfigField = await getDynamicFieldJsonOrNull(
    client,
    validatorConfigsTableId,
    'address',
    bcs.Address.serialize(normalizeSuiAddress(validatorAddress)).toBytes(),
  );
  if (!validatorConfigField) {
    return 0n;
  }
  return BigInt(validatorConfigField.value.value.fee);
}

async function referrerVaultHasReferrer(client: SuiClient, userAddress: string): Promise<boolean> {
  const refJson = await getObjectJsonOrNull(client, REFERRAL_VAULT_ID, GET_OBJECT_INCLUDE_JSON);
  if (!refJson) {
    return false;
  }
  const referrerAddressTableId = refJson.referrer_addresses.id;
  if (!referrerAddressTableId) {
    return false;
  }
  const refereeReferrerEntry = await getDynamicFieldJsonOrNull(
    client,
    referrerAddressTableId,
    'address',
    bcs.Address.serialize(normalizeSuiAddress(userAddress)).toBytes(),
  );
  return refereeReferrerEntry != null;
}

function suiToAfsuiAmount(suiAmount: bigint, afsuiSupply: bigint, totalSuiAmount: bigint): bigint {
  if (afsuiSupply === 0n || totalSuiAmount === 0n) {
    return suiAmount;
  }
  const afsuiPerSuiRateWad = (afsuiSupply * WAD) / totalSuiAmount;
  return (suiAmount * afsuiPerSuiRateWad) / WAD;
}

function afsuiToSuiAmount(afsuiAmount: bigint, afsuiSupply: bigint, totalSuiAmount: bigint): bigint {
  if (afsuiSupply === 0n || totalSuiAmount === 0n) {
    return 0n;
  }
  const suiPerAfsuiRateWad = (totalSuiAmount * WAD) / afsuiSupply;
  return (afsuiAmount * suiPerAfsuiRateWad) / WAD;
}

function percentageOf(amount: bigint, fractionOfWad: bigint): bigint {
  return (amount * fractionOfWad) / WAD;
}

function atomicUnstakeFeeRateWad(state: AfSuiVaultState, atomicReservesAfterThisWithdrawal: bigint): bigint {
  const maxFeeWad = state.atomicUnstakeMaxFee;
  const minFeeWad = state.atomicUnstakeMinFee;
  const reservesTarget = state.atomicUnstakeSuiReservesTarget;
  const reservesAfter = atomicReservesAfterThisWithdrawal;

  if (reservesTarget === 0n) {
    return maxFeeWad;
  }
  if (reservesAfter >= reservesTarget) {
    return minFeeWad;
  }
  const feeSpanWad = maxFeeWad - minFeeWad;
  return maxFeeWad - (feeSpanWad * reservesAfter) / reservesTarget;
}

function estimateAtomicUnstakeNetSui(grossSui: bigint, state: AfSuiVaultState, hasReferrer: boolean): bigint {
  const reservesAfterSplit = state.atomicUnstakeSuiReserves - grossSui;
  const unstakeFeeRateWad = atomicUnstakeFeeRateWad(state, reservesAfterSplit);
  const protocolFeeBaseMist = percentageOf(grossSui, unstakeFeeRateWad);
  const treasuryShareBeforeDiscountMist = percentageOf(protocolFeeBaseMist, state.atomicTreasuryAllocation);
  const treasuryShareMist = hasReferrer
    ? treasuryShareBeforeDiscountMist -
          percentageOf(treasuryShareBeforeDiscountMist, state.atomicRefereeDiscount)
    : treasuryShareBeforeDiscountMist;
  const devWalletShareMist = percentageOf(protocolFeeBaseMist, state.atomicDevWalletAllocation);
  const crankIncentiveShareMist = percentageOf(protocolFeeBaseMist, state.atomicCrankIncentiveAllocation);
  return grossSui - treasuryShareMist - devWalletShareMist - crankIncentiveShareMist;
}

export async function estimateMintAmount(client: SuiClient, suiAmountIn: bigint): Promise<bigint> {
  const vaultState = await fetchAfSuiVaultState(client);
  const [afsuiTotalSupply, defaultValidatorFeeWad] = await Promise.all([
    fetchAfsuiSupplyFromSafe(client),
    fetchValidatorFeeWad(
      client,
      vaultState.validatorConfigsTableId,
      afSuiLstConfig.extraIds.defaultStakeValidator,
    ),
  ]);
  if (vaultState.totalSuiAmount === 0n) {
    return suiAmountIn;
  }
  const grossAfsuiOut = suiToAfsuiAmount(suiAmountIn, afsuiTotalSupply, vaultState.totalSuiAmount);
  return grossAfsuiOut - percentageOf(grossAfsuiOut, defaultValidatorFeeWad);
}

export async function estimateRedeemAmount(
  client: SuiClient,
  afsuiAmountIn: bigint,
  sender?: string,
): Promise<bigint> {
  const vaultState = await fetchAfSuiVaultState(client);
  const [afsuiTotalSupply, userHasReferrer] = await Promise.all([
    fetchAfsuiSupplyFromSafe(client),
    sender ? referrerVaultHasReferrer(client, sender) : Promise.resolve(false),
  ]);
  if (afsuiTotalSupply === 0n) {
    throw new Error('afSUI total supply is zero');
  }
  const grossSuiBeforeProtocolFee = afsuiToSuiAmount(
    afsuiAmountIn,
    afsuiTotalSupply,
    vaultState.totalSuiAmount,
  );
  return estimateAtomicUnstakeNetSui(grossSuiBeforeProtocolFee, vaultState, userHasReferrer);
}

export async function quoteSwapIn(
  client: SuiClient,
  params: QuoteSwapIn,
  senderForAtomicUnstakeReferrerCheck?: string,
): Promise<QuoteOutput> {
  const inputIsSui = isSuiCoinType(params.inCoinType);
  const amountOut = inputIsSui
    ? await estimateMintAmount(client, params.amountIn)
    : await estimateRedeemAmount(client, params.amountIn, senderForAtomicUnstakeReferrerCheck);

  return {
    dex: TokenExchange.AfSui,
    amountIn: params.amountIn,
    amountOut,
    avgPrice: Decimal.zero(),
    priceImpact: 0,
  };
}

export class AfSui {
  private client: SuiClient;

  constructor(client: SuiClient) {
    this.client = client;
  }

  public static newInstance(client: SuiClient): AfSui {
    return new AfSui(client);
  }

  public async populateSwapIn(tx: Transaction, params: SwapIn): Promise<SwapInOutput> {
    if (isSuiCoinType(params.inCoinType)) {
      return this.mint(tx, params);
    }
    return this.redeemAtomic(tx, params);
  }

  private mint(tx: Transaction, params: SwapIn): SwapInOutput {
    const suiCoinIn =
            typeof params.coinId === 'string' ? tx.object(params.coinId) : params.coinId;

    const [afsuiCoinOut] = tx.moveCall({
      target: `${afSuiLstConfig.packageId}::staked_sui_vault::request_stake`,
      arguments: [
        tx.object(afSuiLstConfig.liquidStakingInfoId),
        tx.object(AFSUI_TREASURY_CAP_SAFE_ID),
        tx.object(SUI_SYSTEM_STATE_ID),
        tx.object(REFERRAL_VAULT_ID),
        suiCoinIn,
        tx.pure.address(afSuiLstConfig.extraIds.defaultStakeValidator),
      ],
    });

    return { coin: afsuiCoinOut as TransactionObjectArgument };
  }

  private redeemAtomic(tx: Transaction, params: SwapIn): SwapInOutput {
    const afSuiCoinIn =
            typeof params.coinId === 'string' ? tx.object(params.coinId) : params.coinId;

    const [suiCoinOut] = tx.moveCall({
      target: `${afSuiLstConfig.packageId}::staked_sui_vault::request_unstake_atomic`,
      arguments: [
        tx.object(afSuiLstConfig.liquidStakingInfoId),
        tx.object(AFSUI_TREASURY_CAP_SAFE_ID),
        tx.object(REFERRAL_VAULT_ID),
        tx.object(PROTOCOL_TREASURY_ID),
        afSuiCoinIn,
      ],
    });

    return { coin: suiCoinOut as TransactionObjectArgument };
  }

  public async estimateMintAmount(suiAmountIn: bigint): Promise<bigint> {
    return estimateMintAmount(this.client, suiAmountIn);
  }

  public async estimateRedeemAmount(afsuiAmountIn: bigint, sender?: string): Promise<bigint> {
    return estimateRedeemAmount(this.client, afsuiAmountIn, sender);
  }

  public async quoteSwapIn(params: QuoteSwapIn, senderForAtomicUnstakeReferrerCheck?: string): Promise<QuoteOutput> {
    return quoteSwapIn(this.client, params, senderForAtomicUnstakeReferrerCheck);
  }
}
