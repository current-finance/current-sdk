import { Transaction } from '@mysten/sui/transactions';

const DEFAULT_SINGLE_UPDATE_FEE_IN_MIST = 1;

export interface StorkConfig {
  /** Current Stork package id — the target package for move calls. */
  contractAddress: string;
  /**
   * Original (first-published) Stork package id. Used to build fully-qualified
   * type tags (e.g. `<original>::encoded_asset_id::EncodedAssetId`), which keep
   * pointing at the original module address even after a package upgrade.
   */
  originalContractAddress: string;
  /** Shared StorkState object id. */
  storkStateId: string;
  singleUpdateFeeInMist?: number;
}

const DEFAULT_CONFIG = {
  contractAddress: '0x1ec537522efd3567cacc4e2f65d38f3db77c9c5353c682d9fe95e41f15a15d70',
  originalContractAddress: '0xbc96aa8e79e0831131f00e7d9568fb40f283e6b96c2516dd99aa26b67459b60a',
  storkStateId: '0x88ca8f0ce0f6b30a39bdf71be27ffd0c5571adba28c49a1a3bd530e8fcffb29a',
};

/** A decoded on-chain Stork feed value. */
export interface TemporalNumericValue {
  /** Feed timestamp in nanoseconds. */
  timestampNs: bigint;
  /** Signed quantized value (sign already applied). */
  value: bigint;
  /** Absolute magnitude of the quantized value. */
  magnitude: bigint;
  /** Whether {@link value} is negative. */
  negative: boolean;
}

/**
 * One asset's signed Stork price, decoded into the byte/scalar fields the on-chain
 * `update_temporal_numeric_value_evm_input_vec::new` consumes (transposed into column vectors at the
 * move-call boundary in {@link StorkClient.populateStorkUpdateFromRows}).
 *
 * `timestampNs` and `magnitude` are decimal strings — not `bigint` — so a row is JSON-native (an
 * oracle backend can serve it as-is, no encode step); they're parsed to `bigint` only at tx-build time.
 */
export interface StorkUpdateRow {
  id: number[];
  timestampNs: string;
  magnitude: string;
  negative: boolean;
  publisherMerkleRoot: number[];
  valueComputeAlgHash: number[];
  r: number[];
  s: number[];
  v: number;
}

export interface StorkUpdateGetter {
  obtainStorkUpdate(assetPairs: string[]): Promise<StorkUpdateRow[]>;
  storkConfig(): StorkConfig;
}

export class StorkClient {
  public readonly config: StorkConfig;

  constructor(config: StorkConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  private get singleUpdateFee(): number {
    return this.config.singleUpdateFeeInMist ?? DEFAULT_SINGLE_UPDATE_FEE_IN_MIST;
  }

  /**
   * Build-only: append the on-chain Stork update move calls for already-fetched `rows` (e.g. from an
   * oracle backend). Transposes the per-asset rows into the column vectors `..._input_vec::new`
   * expects, then writes them to `StorkState` in one call. The update fee is taken from the gas coin.
   */
  public populateStorkUpdateFromRows(tx: Transaction, rows: StorkUpdateRow[]): void {
    const numUpdates = rows.length;
    if (numUpdates === 0) {
      throw new Error('Stork update has no rows');
    }

    const config = this.config;
    const fee = this.singleUpdateFee * numUpdates;
    const coin = tx.coin({ balance: BigInt(fee), useGasCoin: true });

    const [updateInputVec] = tx.moveCall({
      target: `${config.contractAddress}::update_temporal_numeric_value_evm_input_vec::new`,
      arguments: [
        tx.pure.vector('vector<u8>', rows.map((r) => r.id)),
        tx.pure.vector('u64', rows.map((r) => BigInt(r.timestampNs))),
        tx.pure.vector('u128', rows.map((r) => BigInt(r.magnitude))),
        tx.pure.vector('bool', rows.map((r) => r.negative)),
        tx.pure.vector('vector<u8>', rows.map((r) => r.publisherMerkleRoot)),
        tx.pure.vector('vector<u8>', rows.map((r) => r.valueComputeAlgHash)),
        tx.pure.vector('vector<u8>', rows.map((r) => r.r)),
        tx.pure.vector('vector<u8>', rows.map((r) => r.s)),
        tx.pure.vector('u8', rows.map((r) => r.v)),
      ],
    });

    tx.moveCall({
      target: `${config.contractAddress}::stork::update_multiple_temporal_numeric_values_evm`,
      arguments: [tx.object(config.storkStateId), updateInputVec, coin],
    });
  }
}