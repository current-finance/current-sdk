import { AssetConfiguration, EModeParams } from '../market-types/market';
import { TypeName } from '../market-types/assets';
import { Decimal } from '../market-types/decimal';
import { AssetPrice, QueryClient } from './query';

const DEFAULT_TTL_MS = 60_000;

// Cache entries hold the in-flight (or already-resolved) Promise, not the
// resolved value. Concurrent callers for the same key share the single
// underlying fetch — equivalent to Rust's `futures::future::Shared`.
type Entry<T> = { expiresAt: number; value: Promise<T> };

export class CachedQueryClient extends QueryClient {
  private assetCache: Map<string, Entry<AssetConfiguration>> = new Map();
  private emodeCache: Map<string, Entry<EModeParams>> = new Map();
  private ttlMs: number;

  constructor(...args: ConstructorParameters<typeof QueryClient>) {
    super(...args);
    this.ttlMs = DEFAULT_TTL_MS;
  }

  public setTtlMs(ttlMs: number): void {
    this.ttlMs = ttlMs;
  }

  private assetKey(marketType: TypeName, assetType: TypeName): string {
    return `${marketType}::${assetType}`;
  }

  private emodeKey(marketType: TypeName, emodeGroup: number, assetType: TypeName): string {
    return `${marketType}::${emodeGroup}::${assetType}`;
  }

  // Cache a freshly-issued fetch promise. On rejection, evict — but only if
  // the entry still points at *this* promise, to avoid clobbering a newer
  // entry that races in after the rejection.
  private trackEntry<T>(
    cache: Map<string, Entry<T>>,
    key: string,
    value: Promise<T>,
    expiresAt: number,
  ): Promise<T> {
    const entry = { expiresAt, value };
    cache.set(key, entry);
    value.catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
    return value;
  }

  public override async getAssetMarketOverview(
    marketType: TypeName,
    assetType: TypeName,
    price: number | Decimal,
  ): Promise<AssetConfiguration> {
    const key = this.assetKey(marketType, assetType);
    const cached = this.assetCache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }
    const value = super.getAssetMarketOverview(marketType, assetType, price);
    return this.trackEntry(this.assetCache, key, value, Date.now() + this.ttlMs);
  }

  public override async getAssetsMarketOverview(
    marketType: TypeName,
    assets: AssetPrice[],
  ): Promise<AssetConfiguration[]> {
    const now = Date.now();
    const expiresAt = now + this.ttlMs;
    const promises: Promise<AssetConfiguration>[] = new Array(assets.length);
    const uncachedIndices: number[] = [];
    const uncachedRequests: AssetPrice[] = [];

    for (let i = 0; i < assets.length; i++) {
      const { assetType } = assets[i];
      const key = this.assetKey(marketType, assetType);
      const cached = this.assetCache.get(key);
      if (cached && now < cached.expiresAt) {
        promises[i] = cached.value;
      } else {
        uncachedIndices.push(i);
        uncachedRequests.push(assets[i]);
      }
    }

    if (uncachedRequests.length > 0) {
      // One batched RPC for all uncached assets; per-asset promises derive
      // from the same underlying batch, so the cost is a single roundtrip
      // regardless of how many overlapping callers arrive in this window.
      const batch = super.getAssetsMarketOverview(marketType, uncachedRequests);
      for (let i = 0; i < uncachedRequests.length; i++) {
        const idx = i;
        const perAsset = batch.then((arr) => arr[idx]);
        const key = this.assetKey(marketType, uncachedRequests[i].assetType);
        promises[uncachedIndices[i]] = this.trackEntry(
          this.assetCache,
          key,
          perAsset,
          expiresAt,
        );
      }
    }

    return Promise.all(promises);
  }

  public override async getMarketEmodeGroupOverview(
    marketType: TypeName,
    emodeGroup: number,
    assets: TypeName[],
  ): Promise<EModeParams[]> {
    const now = Date.now();
    const expiresAt = now + this.ttlMs;
    const promises: Promise<EModeParams>[] = new Array(assets.length);
    const uncachedIndices: number[] = [];
    const uncachedAssets: TypeName[] = [];

    for (let i = 0; i < assets.length; i++) {
      const key = this.emodeKey(marketType, emodeGroup, assets[i]);
      const cached = this.emodeCache.get(key);
      if (cached && now < cached.expiresAt) {
        promises[i] = cached.value;
      } else {
        uncachedIndices.push(i);
        uncachedAssets.push(assets[i]);
      }
    }

    if (uncachedAssets.length > 0) {
      const batch = super.getMarketEmodeGroupOverview(marketType, emodeGroup, uncachedAssets);
      for (let i = 0; i < uncachedAssets.length; i++) {
        const idx = i;
        const perAsset = batch.then((arr) => arr[idx]);
        const key = this.emodeKey(marketType, emodeGroup, uncachedAssets[i]);
        promises[uncachedIndices[i]] = this.trackEntry(
          this.emodeCache,
          key,
          perAsset,
          expiresAt,
        );
      }
    }

    return Promise.all(promises);
  }
}
