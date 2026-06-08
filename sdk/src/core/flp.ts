import { Transaction, TransactionObjectInput } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { LendingClient } from './client';
import { TypeName } from '../market-types';
import { GET_OBJECT_INCLUDE_JSON_TYPE_BCS, getObjectOrThrow } from '../utils/object-utils';
import { simulateTransactionChecked } from '../utils/transaction-utils';
import { normalizeStructTag } from '@mysten/sui/utils';

export interface FLPQuotaData {
  obligationId: string;
  suiFlpAmount: number;
  usdcFlpAmount: number;
}

export interface FLPTotalAmounts {
  suiFlpAmount: number;
  usdcFlpAmount: number;
  hasEnded: boolean;
}

export interface FLPConstants {
  suiFlpCutOffCoinAmount: number;
  usdcFlpCutOffCoinAmount: number;
  suiFlpTotalQuota: number;
  usdcFlpTotalQuota: number;
}

export class FLPClient {
  readonly lendingClient: LendingClient;

  constructor(lendingClient: LendingClient) {
    this.lendingClient = lendingClient;
  }

  private get flpPackageId(): string {
    return this.lendingClient.config.flpPackageId;
  }

  private get config() {
    return this.lendingClient.config;
  }

  /**
   * Enter the market (create obligation) and deposit into FLP in one transaction.
   * Preserves the enterAndPurchase pattern.
   *
   * Move: enters market then calls public fun deposit<CoinType>(flp_app, app, market, owner_cap, coin, clock, ctx)
   */
  public populateEnterMarketAndDeposit(
    tx: Transaction,
    coinType: TypeName,
    coinObjectId: TransactionObjectInput,
    marketObjectId: string,
    marketType: TypeName,
    recipient: string,
  ) {
    const obligationOwnerCap = this.lendingClient.populateEnterMarketTxn(tx, marketObjectId, marketType);
    this.populateDeposit(tx, coinType, obligationOwnerCap, coinObjectId, marketObjectId);
    tx.transferObjects([tx.object(obligationOwnerCap)], recipient);
  }

  /**
   * Deposit coins into an existing FLP obligation.
   *
   * Move: public fun deposit<CoinType>(flp_app, app, market, owner_cap, coin, clock, ctx)
   */
  public populateDeposit(
    tx: Transaction,
    coinType: TypeName,
    obligationOwnerCapId: TransactionObjectInput,
    coinObjectId: TransactionObjectInput,
    marketObjectId: string,
  ) {
    tx.moveCall({
      target: `${this.flpPackageId}::flp::deposit`,
      arguments: [
        tx.object(this.config.flpAppId),
        tx.object(this.config.protocolAppId),
        tx.object(marketObjectId),
        tx.object(obligationOwnerCapId),
        tx.object(coinObjectId),
        tx.object('0x6'), // Clock
      ],
      typeArguments: [normalizeStructTag(coinType)],
    });
  }

  /**
   * Fetch the FLPApp object and return the global total FLP amounts across all obligations.
   * Also includes whether the FLP event has ended.
   */
  public async getFLPAppTotalAmounts(): Promise<FLPTotalAmounts> {
    const j = await getObjectOrThrow(
      this.lendingClient.provider,
      this.config.flpAppId,
      GET_OBJECT_INCLUDE_JSON_TYPE_BCS,
    );

    return {
      suiFlpAmount: Number(j.total_amount.sui_flp_amount),
      usdcFlpAmount: Number(j.total_amount.usdc_flp_amount),
      hasEnded: Boolean(j.has_ended),
    };
  }

  /**
   * Get FLP quotas for an obligation by its ID via devInspect.
   * Returns (sui_flp_amount, usdc_flp_amount) stored in FLPApp.
   *
   * Move: public fun quotas_by_id(flp_app: &FLPApp, obligation_objectId: ID): (u64, u64)
   */
  public async getQuotasByObligationId(obligationId: string): Promise<FLPQuotaData> {
    const tx = new Transaction();

    tx.moveCall({
      target: `${this.flpPackageId}::flp::quotas_by_id`,
      arguments: [
        tx.object(this.config.flpAppId),
        tx.pure.id(obligationId),
      ],
    });

    tx.setSenderIfNotSet('0x0000000000000000000000000000000000000000000000000000000000000000');
    const result = await simulateTransactionChecked(this.lendingClient.provider, tx, false);

    if (!result.commandResults?.length) {
      throw new Error('No results from quotas_by_id query');
    }

    const returnValues = result.commandResults[0].returnValues;
    if (!returnValues || returnValues.length < 2) {
      throw new Error('Unexpected return values from quotas_by_id');
    }

    const suiFlpAmount = Number(bcs.u64().parse(new Uint8Array(returnValues[0].bcs)));
    const usdcFlpAmount = Number(bcs.u64().parse(new Uint8Array(returnValues[1].bcs)));

    return { obligationId, suiFlpAmount, usdcFlpAmount };
  }

  /**
   * Get FLP quotas for an obligation via its ObligationOwnerCap using devInspect.
   * Returns (sui_flp_amount, usdc_flp_amount) stored in FLPApp.
   *
   * Move: public fun quotas_by_cap(flp_app: &FLPApp, cap: &ObligationOwnerCap): (u64, u64)
   */
  public async getQuotasByObligationOwnerCap(obligationOwnerCapId: string): Promise<FLPQuotaData> {
    const tx = new Transaction();

    tx.moveCall({
      target: `${this.flpPackageId}::flp::quotas_by_cap`,
      arguments: [
        tx.object(this.config.flpAppId),
        tx.object(obligationOwnerCapId),
      ],
    });

    tx.setSenderIfNotSet('0x0000000000000000000000000000000000000000000000000000000000000000');
    const result = await simulateTransactionChecked(this.lendingClient.provider, tx, false);

    if (!result.commandResults?.length) {
      throw new Error('No results from quotas_by_cap query');
    }

    const returnValues = result.commandResults[0].returnValues;
    if (!returnValues || returnValues.length < 2) {
      throw new Error('Unexpected return values from quotas_by_cap');
    }

    const suiFlpAmount = Number(bcs.u64().parse(new Uint8Array(returnValues[0].bcs)));
    const usdcFlpAmount = Number(bcs.u64().parse(new Uint8Array(returnValues[1].bcs)));

    return { obligationId: obligationOwnerCapId, suiFlpAmount, usdcFlpAmount };
  }

  /**
   * Get all FLP constants in a single devInspect call.
   * Batches 4 move calls into one PTB:
   *   sui_flp_cut_off_coin_amount, usdc_flp_cut_off_coin_amount,
   *   sui_flp_total_quota, usdc_flp_total_quota
   */
  public async getFLPConstants(): Promise<FLPConstants> {
    const tx = new Transaction();

    const targets = [
      'sui_flp_cut_off_coin_amount',
      'usdc_flp_cut_off_coin_amount',
      'sui_flp_total_quota',
      'usdc_flp_total_quota',
    ] as const;

    for (const fn of targets) {
      tx.moveCall({
        target: `${this.flpPackageId}::flp::${fn}`,
        arguments: [],
      });
    }

    tx.setSenderIfNotSet('0x0000000000000000000000000000000000000000000000000000000000000000');
    const result = await simulateTransactionChecked(this.lendingClient.provider, tx, false);

    if (!result.commandResults || result.commandResults.length < 4) {
      throw new Error('Unexpected results from FLP constants query');
    }

    const parseU64 = (idx: number): number => {
      const returnValues = result.commandResults[idx].returnValues;
      if (!returnValues || returnValues.length === 0) {
        throw new Error(`No return value for ${targets[idx]}`);
      }
      return Number(bcs.u64().parse(new Uint8Array(returnValues[0].bcs)));
    };

    return {
      suiFlpCutOffCoinAmount: parseU64(0),
      usdcFlpCutOffCoinAmount: parseU64(1),
      suiFlpTotalQuota: parseU64(2),
      usdcFlpTotalQuota: parseU64(3),
    };
  }
}
