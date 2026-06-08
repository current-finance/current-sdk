import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { deriveDynamicFieldID } from '@mysten/sui/utils';

type DynamicFieldKeyType = Parameters<typeof deriveDynamicFieldID>[1];

export const GET_OBJECT_INCLUDE_JSON_TYPE_BCS = { json: true, type: true, objectBcs: true };
export const GET_OBJECT_INCLUDE_JSON_TYPE = { json: true, type: true };
export const GET_OBJECT_INCLUDE_JSON = { json: true };
export const GET_OBJECT_INCLUDE_TYPE_BCS = { type: true, objectBcs: true };

export type GetObjectIncludeWithJson =
  | typeof GET_OBJECT_INCLUDE_JSON_TYPE_BCS
  | typeof GET_OBJECT_INCLUDE_JSON_TYPE
  | typeof GET_OBJECT_INCLUDE_JSON;

// gRPC's `object.json` is untyped (Move struct shape unknown to the client).
// Helpers accept a generic <T> so callers can declare the expected shape
// at the call site. Defaults to `any` so legacy callers stay valid; new
// callers can opt into typed access via `getObjectOrThrow<MyShape>(...)`.
type DefaultJson = any;

async function getObject<T = DefaultJson>(
  provider: SuiGrpcClient,
  objectId: string,
  include: GetObjectIncludeWithJson,
): Promise<{ json: T; type?: string; objectBcs?: Uint8Array }> {
  const res = await provider.getObject({ objectId, include });
  if (!res.object?.json) {
    throw new Error(`Object not found or missing json: ${objectId}`);
  }
  return res.object as unknown as { json: T; type?: string; objectBcs?: Uint8Array };
}

export async function getObjectOrThrow<T = DefaultJson>(
  provider: SuiGrpcClient,
  objectId: string,
  include: GetObjectIncludeWithJson = GET_OBJECT_INCLUDE_JSON_TYPE_BCS,
): Promise<T> {
  const obj = await getObject<T>(provider, objectId, include);
  return obj.json;
}

export async function getObjectJsonAndTypeOrThrow<T = DefaultJson>(
  provider: SuiGrpcClient,
  objectId: string,
  include: GetObjectIncludeWithJson = GET_OBJECT_INCLUDE_JSON_TYPE_BCS,
): Promise<{ json: T; type: string }> {
  const obj = await getObject<T>(provider, objectId, include);
  if (!obj.type) {
    throw new Error(`Object not found or missing type: ${objectId}`);
  }
  return { json: obj.json, type: obj.type };
}

export async function getObjectsJsonOrThrow<T = DefaultJson>(
  provider: SuiGrpcClient,
  objectIds: string[],
  include: GetObjectIncludeWithJson = GET_OBJECT_INCLUDE_JSON_TYPE_BCS,
): Promise<T[]> {
  if (objectIds.length === 0) {
    return [];
  }
  const res = await provider.getObjects({ objectIds, include });
  const out: T[] = [];
  for (let i = 0; i < res.objects.length; i++) {
    const obj = res.objects[i];
    if (obj instanceof Error) {
      throw obj;
    }
    if (!obj.json) {
      throw new Error(`Object not found or missing json: ${objectIds[i]}`);
    }
    out.push(obj.json as T);
  }
  return out;
}

export async function getObjectsJsonOrNull<T = DefaultJson>(
  provider: SuiGrpcClient,
  objectIds: string[],
  include: GetObjectIncludeWithJson = GET_OBJECT_INCLUDE_JSON_TYPE_BCS,
): Promise<(T | null)[]> {
  if (objectIds.length === 0) {
    return [];
  }
  const res = await provider.getObjects({ objectIds, include });
  const out: (T | null)[] = [];
  for (let i = 0; i < res.objects.length; i++) {
    const obj = res.objects[i];
    if (obj instanceof Error) {
      out.push(null);
      continue;
    }
    if (!obj.json) {
      out.push(null);
      continue;
    }
    out.push(obj.json as T);
  }
  return out;
}

export async function getObjectJsonOrNull<T = DefaultJson>(
  provider: SuiGrpcClient,
  objectId: string,
  include: GetObjectIncludeWithJson = GET_OBJECT_INCLUDE_JSON_TYPE_BCS,
): Promise<T | null> {
  const res = await provider.getObject({ objectId, include });
  if (!res.object?.json) {
    return null;
  }
  return res.object.json as T;
}

export async function getDynamicFieldJsonOrNull<T = DefaultJson>(
  provider: SuiGrpcClient,
  parentId: string,
  keyType: DynamicFieldKeyType,
  keyBytes: Uint8Array,
  include: GetObjectIncludeWithJson = GET_OBJECT_INCLUDE_JSON,
): Promise<T | null> {
  const fieldId = deriveDynamicFieldID(parentId, keyType, keyBytes);
  const [json] = await getObjectsJsonOrNull<T>(provider, [fieldId], include);
  return json ?? null;
}

export async function getDynamicFieldJsonOrThrow<T = DefaultJson>(
  provider: SuiGrpcClient,
  parentId: string,
  keyType: DynamicFieldKeyType,
  keyBytes: Uint8Array,
  include: GetObjectIncludeWithJson = GET_OBJECT_INCLUDE_JSON,
): Promise<T> {
  const fieldId = deriveDynamicFieldID(parentId, keyType, keyBytes);
  return getObjectOrThrow<T>(provider, fieldId, include);
}

export async function getObjectTypeBcsOrThrow(
  provider: SuiGrpcClient,
  objectId: string,
): Promise<{ type: string; objectBcs: Uint8Array }> {
  const res = await provider.getObject({
    objectId,
    include: GET_OBJECT_INCLUDE_TYPE_BCS,
  });
  const raw = res.object?.objectBcs;
  if (!raw) {
    throw new Error(`Object not found or missing BCS data: ${objectId}`);
  }
  const objectBcs = new Uint8Array(raw);
  const type = res.object?.type;
  if (!type) {
    throw new Error(`Object not found or missing type: ${objectId}`);
  }
  return { type, objectBcs };
}
