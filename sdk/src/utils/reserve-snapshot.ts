import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { bcs } from '@mysten/sui/bcs';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { TypeName } from '../market-types/assets';
import { Env, getStaticReserveIds, ReserveIds } from '../config/networks';
import {
  GET_OBJECT_INCLUDE_JSON,
  GET_OBJECT_INCLUDE_JSON_TYPE_BCS,
  getObjectOrThrow,
  getObjectsJsonOrThrow,
} from './object-utils';

// ReserveBalanceKey is an "empty" struct in Move, but Sui adds a synthetic
// `dummy_field: bool = false` so the on-chain BCS is a single 0x00 byte, not
// zero bytes. Verified against a live dynamic field's bcsName = "AA==" (base64).
export const RESERVE_BALANCE_KEY_BCS = new Uint8Array([0]);
// math::float::Decimal stores a WAD-scaled integer (10^18). floor(d) = d / WAD.
const WAD = 1000000000000000000n;
// Every mutating path on Reserve takes &mut self, so any state change bumps the
// Reserve object's version. We use that as a fence and retry a bounded number
// of times under contention.
const MAX_RESERVE_READ_RETRIES = 3;

export interface ReserveSnapshot {
  actualTokenBalance: bigint;        // ReserveBalance.underlying_balance
  ledgerCashAccounting: bigint;      // Reserve.cash (u64 cache of underlying_balance)
  debt: bigint;                      // floor(Reserve.debt)
  cashReserve: bigint;               // floor(Reserve.cash_reserve)
  totalCtokenSupply: bigint;         // Reserve.total_supply (u64 cache of the ctoken count)
  ctokenBalance: bigint;             // ReserveBalance.ctoken_supply.supply_value (real ctoken count)
  borrowIndex: bigint;               // Reserve.borrow_index.value as raw WAD-scaled u256
  borrowIndexLastUpdated: bigint;    // Reserve.borrow_index.last_updated (unix seconds)
}

export function deriveReserveBalanceFieldId(
  innerReserveId: string,
  protocolPackageId: string,
): string {
  return deriveDynamicFieldID(
    innerReserveId,
    {
      struct: {
        address: protocolPackageId,
        module: 'reserve',
        name: 'ReserveBalanceKey',
        typeParams: [],
      },
    },
    RESERVE_BALANCE_KEY_BCS,
  );
}

export async function queryReserveIds(
  provider: SuiGrpcClient,
  marketObjectId: string,
  marketType: TypeName,
): Promise<Map<TypeName, ReserveIds>> {
  const marketJson = await getObjectOrThrow(
    provider,
    marketObjectId,
    GET_OBJECT_INCLUDE_JSON_TYPE_BCS,
  );

  const tableId = marketJson.reserves.table.table.id;

  const reserves = await provider.listDynamicFields({ parentId: tableId });
  const coinTypes: string[] = [];
  const reserveFieldIds: string[] = [];
  for (const entry of reserves.dynamicFields) {
    const coinType = bcs.struct('TypeName', { name: bcs.string() }).parse(entry.name.bcs).name;
    if (!coinType) continue;
    coinTypes.push(coinType);
    reserveFieldIds.push(entry.fieldId);
  }
  if (coinTypes.length === 0) {
    return new Map();
  }

  const protocolPackageId = marketType.split('::')[0];
  const discovery = await getObjectsJsonOrThrow(
    provider,
    reserveFieldIds,
    GET_OBJECT_INCLUDE_JSON,
  );
  const result = new Map<TypeName, ReserveIds>();
  for (let i = 0; i < coinTypes.length; i++) {
    const innerId = discovery[i]?.value?.id;
    if (!innerId) {
      throw new Error(`Failed to read inner reserve id for ${coinTypes[i]}`);
    }
    const balanceId = deriveReserveBalanceFieldId(innerId, protocolPackageId);
    result.set(coinTypes[i], { reserveId: reserveFieldIds[i], balanceId });
  }
  return result;
}

export async function getReserveIds(
  provider: SuiGrpcClient,
  network: 'mainnet',
  env: Env,
  marketObjectId: string,
  marketType: TypeName,
): Promise<Map<TypeName, ReserveIds>> {
  const staticIds = getStaticReserveIds(network, env, marketObjectId, marketType);
  if (staticIds) { return staticIds; }
  return queryReserveIds(provider, marketObjectId, marketType);
}

function parseReserveSnapshot(
  reserveRead: any,
  balanceRead: any,
  coinType: string,
): ReserveSnapshot {
  const reserveFields = reserveRead.json?.value;
  const balanceFields = balanceRead.json?.value;
  if (!reserveFields || !balanceFields) {
    throw new Error(`Reserve content malformed for coin type: ${coinType}`);
  }
  const debtRaw = reserveFields.debt?.value;
  const cashReserveRaw = reserveFields.cash_reserve?.value;
  const cash = reserveFields.cash;
  const totalSupply = reserveFields.total_supply;
  const underlyingBalance = balanceFields.underlying_balance;
  const ctokenSupply = balanceFields.ctoken_supply?.value;
  const borrowIndexRaw = reserveFields.borrow_index?.value?.value;
  const borrowIndexLastUpdated = reserveFields.borrow_index?.last_updated;
  if (
    debtRaw == null || cashReserveRaw == null || cash == null ||
    totalSupply == null || underlyingBalance == null || ctokenSupply == null ||
    borrowIndexRaw == null || borrowIndexLastUpdated == null
  ) {
    throw new Error(`Reserve content malformed for coin type: ${coinType}`);
  }
  return {
    actualTokenBalance: BigInt(underlyingBalance),
    ledgerCashAccounting: BigInt(cash),
    debt: BigInt(debtRaw) / WAD,
    cashReserve: BigInt(cashReserveRaw) / WAD,
    totalCtokenSupply: BigInt(totalSupply),
    ctokenBalance: BigInt(ctokenSupply),
    borrowIndex: BigInt(borrowIndexRaw),
    borrowIndexLastUpdated: BigInt(borrowIndexLastUpdated),
  };
}

// Bulk variant of getReserveSnapshot: one batched multi-read for all reserves
// + one multi-read fence. Same version-pinning guarantees.
export async function getAllReserveSnapshots(
  provider: SuiGrpcClient,
  network: 'mainnet',
  env: Env,
  marketObjectId: string,
  marketType: TypeName,
): Promise<Record<TypeName, ReserveSnapshot>> {
  const idMap = await getReserveIds(provider, network, env, marketObjectId, marketType);
  if (idMap.size === 0) { return {}; }

  const coinTypes: string[] = [];
  const reserveFieldIds: string[] = [];
  const balanceFieldIds: string[] = [];
  for (const [coinType, ids] of idMap) {
    coinTypes.push(coinType);
    reserveFieldIds.push(ids.reserveId);
    balanceFieldIds.push(ids.balanceId);
  }

  type VersionedRead = { json?: unknown; version?: string };

  for (let attempt = 0; attempt < MAX_RESERVE_READ_RETRIES; attempt++) {
    const batchRes = await provider.getObjects({
      objectIds: [...reserveFieldIds, ...balanceFieldIds],
      include: GET_OBJECT_INCLUDE_JSON,
    });
    const batch = batchRes.objects;
    if (batch.some((o) => o instanceof Error)) {
      throw new Error('Failed to read reserves in batch');
    }
    const reads = batch as unknown as VersionedRead[];
    const reserveReads = reads.slice(0, reserveFieldIds.length);
    const balanceReads = reads.slice(reserveFieldIds.length);

    const batchVersions = reserveReads.map((r) => r.version);
    if (batchVersions.some((v) => !v)) {
      throw new Error('Failed to read reserves in batch');
    }

    const fenceRes = await provider.getObjects({ objectIds: reserveFieldIds, include: {} });
    const fenceReads = fenceRes.objects;
    if (fenceReads.some((o) => o instanceof Error)) {
      throw new Error('Failed to read reserves in batch');
    }
    const fenceVersions = (fenceReads as unknown as VersionedRead[]).map((r) => r.version);
    const allConsistent = batchVersions.every((v, i) => v === fenceVersions[i]);

    if (allConsistent) {
      const result: Record<TypeName, ReserveSnapshot> = {};
      for (let i = 0; i < reserveFieldIds.length; i++) {
        result[coinTypes[i]] = parseReserveSnapshot(
          reserveReads[i],
          balanceReads[i],
          coinTypes[i],
        );
      }
      return result;
    }
  }
  throw new Error(
    `One or more reserves mutated during read after ${MAX_RESERVE_READ_RETRIES} attempts; retry later`,
  );
}
