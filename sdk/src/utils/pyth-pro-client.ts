import { Channel, PythLazerClient } from "@pythnetwork/pyth-lazer-sdk";
import type { WebSocketPoolConfig } from "@pythnetwork/pyth-lazer-sdk/socket/websocket-pool";
import { Transaction, TransactionObjectArgument } from "@mysten/sui/transactions";
import { getNetworkConfig, SOURCE_ID } from "../config/networks";

/** Deployed `pyth_lazer` package id x_oracle was published against (verify target). */
export const PYTH_PRO_PACKAGE_ID =
    "0xefbfd064480777699fd9c557a5804d72ace7bc82661fdc8d1f1a44ea6d92ee10";
/** Shared `pyth_lazer::state::State` object id (holds trusted signers). */
export const PYTH_PRO_STATE_ID =
    "0xd0db9c1e9212a98120384bf78d8b8c985d87b9ee6921dffcf9d1394062911573";

/**
 * Lazer delivery channel id -> channel name (mirrors `pyth_lazer::channel_v2` / `x_oracle`). A feed
 * must be fetched on the channel it was registered with, and not every feed is published on every
 * channel — `refresh_pyth_price_feed` re-asserts the channel, and Lazer 400s if a feed doesn't
 * support the requested one. Feeds on different channels therefore need separate updates.
 */
export const LAZER_CHANNEL_NAME: Record<number, string> = {
    1: "real_time",
    2: "fixed_rate@50ms",
    3: "fixed_rate@200ms",
    4: "fixed_rate@1000ms",
};

// const LAZER_SYMBOLS_URL = "https://pyth.dourolabs.app/v1/symbols";

/** One signed Pyth Pro (Lazer) `leEcdsa` update blob plus the feed ids it carries (and is signed over). */
export interface PythProUpdate {
    /**
     * The signed `leEcdsa` blob as a hex string (no `0x`). Hex — not `Uint8Array` — so the value is
     * JSON-native (an oracle backend can serve it without an encode step) and a streaming cache
     * serializes each blob just once on receipt. Decoded back to bytes only at tx-build time
     * ({@link PythProClient.populateDeriveUpdate}).
     */
    update: string;
    feedIds: number[];
}

/**
 * Source of signed Pyth Pro updates. Implementations own how updates are fetched (live Lazer, a
 * streaming cache, a backend service) and how feeds map to blobs — feeds on different Lazer channels
 * can't share a signed blob, so a request may resolve to several {@link PythProUpdate}s.
 */
export interface PythProUpdateGetter {
    /**
     * Obtain signed updates covering every feed in `feedIDs`. The getter groups the feeds by their
     * configured Lazer channel (feeds on different channels can't share a signed blob), so the result
     * has one blob per channel; each reports the feeds it carries in {@link PythProUpdate.feedIds}.
     */
    obtainPythProUpdates(feedIDs: number[]): Promise<PythProUpdate[]>;
}

/**
 * On-demand getter: pulls the latest signed update per channel straight from the Lazer price service
 * on every call. Simple and always-fresh — best for one-shot scripts. For a long-running service,
 * prefer {@link PythLazerStreamUpdateGetter} to avoid a Lazer round-trip per request.
 *
 * `PythLazerClient` opens a websocket pool even in this on-demand mode, so {@link close} still has to be
 * called when done (e.g. at the end of a script) or the pool keeps the process alive.
 */
export class PythLazerUpdateGetter implements PythProUpdateGetter {
    private lazer: PythLazerClient;
    private feedChannels: Map<number, number>;

    private constructor(lazer: PythLazerClient, feedChannels: Map<number, number>) {
        this.lazer = lazer;
        this.feedChannels = feedChannels;
    }

    /**
     * @param token   Pyth Lazer access token (Lazer is permissioned).
     * @param network Network whose x_oracle config supplies the feed -> channel map. Defaults to
     *                `'mainnet'`.
     */
    public static async create(
        token: string,
        network: string = "mainnet",
    ): Promise<PythLazerUpdateGetter> {
        const lazer = await PythLazerClient.create({ token, webSocketPoolConfig: {} });
        return new PythLazerUpdateGetter(lazer, feedChannelMap(network));
    }

    public async obtainPythProUpdates(feedIDs: number[]): Promise<PythProUpdate[]> {
        const out: PythProUpdate[] = [];
        for (const { channelId, feedIds } of planUpdates(feedIDs, this.feedChannels)) {
            const channel = LAZER_CHANNEL_NAME[channelId];
            if (!channel) {
                throw new Error(`Unknown Lazer channel id ${channelId}`);
            }
            const latestPrice = await this.lazer.getLatestPrice({
                channel: channel as Channel,
                formats: ["leEcdsa"],
                jsonBinaryEncoding: "hex",
                priceFeedIds: feedIds,
                // @ts-ignore - DEFAULT_LAZER_PROPERTIES is a readonly tuple of PriceFeedProperty
                properties: [...DEFAULT_LAZER_PROPERTIES],
            });
            const hex = latestPrice.leEcdsa?.data;
            if (!hex) {
                throw new Error(`Lazer returned no leEcdsa update for feeds ${feedIds.join(",")}`);
            }
            // Already hex (jsonBinaryEncoding: "hex"), which is exactly PythProUpdate.update's form.
            out.push({ update: hex, feedIds });
        }
        return out;
    }

    /** Close the underlying Lazer connections. Required even on-demand — the SDK opens a socket pool. */
    public close(): void {
        this.lazer.shutdown();
    }
}

/**
 * Live health of a stream getter's Lazer websocket pool. The SDK opens several redundant connections
 * and reconnects (and re-sends the subscriptions) on its own, so "disconnected" here means *every*
 * connection is down or reconnecting — the only state in which no update can arrive.
 */
export interface LazerConnectionStatus {
    /** False while every connection in the pool is down or reconnecting. */
    connected: boolean;
    /** How long the current outage has lasted, ms. `null` while connected. */
    downForMs: number | null;
    /** Local time of the last connected <-> disconnected transition; `null` if there's been none. */
    lastChangeAt: number | null;
    /** Full outages since the getter was created. Nonzero with `connected: true` means it recovered. */
    outages: number;
    /**
     * Age of the newest payload this getter has cached, ms — `null` before the first one. A live
     * connection that stops delivering (a dropped subscription, a stalled feed) shows up here and
     * nowhere else, so check it alongside `connected`.
     */
    lastDataAgeMs: number | null;
    /** True once {@link PythLazerStreamUpdateGetter.close} has torn the connections down. */
    closed: boolean;
    /**
     * Message of the most recent websocket / pool error, `null` if there's been none. Lazer reports a
     * rejected subscription this way and nowhere else (the SDK throws on `subscriptionError` frames
     * before any message listener sees them), so this is what distinguishes "the socket is down" from
     * "the socket is fine and Lazer refused what we asked for".
     */
    lastError: string | null;
    /** Websocket / pool errors seen since the getter was created. */
    errors: number;
}

/** Tuning for {@link PythLazerStreamUpdateGetter}. */
export interface PythLazerStreamOptions {
    /**
     * Reject a cached update older than this many ms — guards against a silently stalled subscription
     * serving a stale blob that would fail the on-chain staleness check anyway. Default 5000.
     */
    maxAgeMs?: number;
    /**
     * How long {@link PythLazerStreamUpdateGetter.create} waits for every subscription to receive its
     * first update before failing. Default 15000.
     */
    readyTimeoutMs?: number;
    /**
     * Called on every connected <-> disconnected transition of the underlying websocket pool (see
     * {@link LazerConnectionStatus}). Nothing else is needed to *recover* — the SDK reconnects and
     * replays the subscriptions itself — so this is for logging / alerting / draining traffic away
     * from an unhealthy instance. Poll {@link PythLazerStreamUpdateGetter.connectionStatus} instead
     * when a health endpoint just needs the current state.
     */
    onConnectionChange?: (status: LazerConnectionStatus) => void;
    /**
     * Called for websocket and pool-level errors. These arrive *before* a full outage (one connection
     * failing doesn't stop delivery) and are otherwise swallowed by the SDK's default logger, so wire
     * this up if you want to see a degrading pool ahead of the disconnect it may lead to.
     */
    onError?: (error: Error) => void;
    /**
     * Passed through to `PythLazerClient.create`'s `webSocketPoolConfig` — `urls` (point the pool at a
     * local Lazer stand-in), `numConnections`, `rwsConfig` (reconnect/backoff tuning), etc. Mainly for
     * integration tests that need to drive real reconnects against a controllable server. The pool's
     * error callbacks are always overridden so the connection monitor keeps seeing errors, whatever is
     * passed here.
     */
    webSocketPoolConfig?: WebSocketPoolConfig;
}

/**
 * Tracks whether a Lazer client's websocket pool can currently deliver anything, off the SDK's
 * pool-level listeners: `allConnectionsDown` fires when every redundant connection is down or
 * reconnecting, `connectionRestored` when the first one comes back. Shared by both stream getters —
 * neither owns the notion of connectedness, and a per-class copy would drift.
 *
 * A dropped connection is not by itself a caller's problem: the SDK reconnects and re-sends the
 * subscriptions, and a cached blob stays valid until `maxAgeMs`. What matters is the outage that
 * outlasts the cache, which is why this only annotates the staleness errors rather than throwing on
 * its own.
 */
class LazerConnectionMonitor {
    private connected = true;
    private downSince: number | null = null;
    private lastChangeAt: number | null = null;
    private outages = 0;
    private lastDataAt: number | null = null;
    private closed = false;
    private lastError: string | null = null;
    private errors = 0;
    private readonly onChange?: (status: LazerConnectionStatus) => void;
    private readonly onError?: (error: Error) => void;

    /**
     * Built before the client so pool errors raised during `PythLazerClient.create` (a rejected token,
     * an unreachable endpoint) are already captured; {@link attach} adds the connection listeners once
     * the client exists.
     */
    constructor(onChange?: (status: LazerConnectionStatus) => void, onError?: (error: Error) => void) {
        this.onChange = onChange;
        this.onError = onError;
    }

    /** Record a websocket / pool error and forward it to the caller's handler. */
    public noteError(error: Error): void {
        this.errors += 1;
        this.lastError = error.message;
        this.onError?.(error);
    }

    public attach(lazer: PythLazerClient): void {
        lazer.addAllConnectionsDownListener(() => {
            if (this.closed || !this.connected) {
                return;
            }
            this.connected = false;
            this.downSince = Date.now();
            this.lastChangeAt = this.downSince;
            this.outages += 1;
            this.onChange?.(this.status());
        });
        lazer.addConnectionRestoredListener(() => {
            // The pool starts out marked all-down, so it fires this once on a healthy start-up too;
            // the `connected` guard keeps that from being reported as a recovery.
            if (this.closed || this.connected) {
                return;
            }
            this.connected = true;
            this.downSince = null;
            this.lastChangeAt = Date.now();
            this.onChange?.(this.status());
        });
    }

    /** Record that a usable payload was cached — the liveness signal a connected-but-silent pool lacks. */
    public markData(at: number): void {
        this.lastDataAt = at;
    }

    /** Stop reporting a live pool once the client has been shut down. */
    public markClosed(): void {
        this.closed = true;
        this.connected = false;
    }

    public status(): LazerConnectionStatus {
        const now = Date.now();
        return {
            connected: this.connected,
            downForMs: this.downSince === null ? null : now - this.downSince,
            lastChangeAt: this.lastChangeAt,
            outages: this.outages,
            lastDataAgeMs: this.lastDataAt === null ? null : now - this.lastDataAt,
            closed: this.closed,
            lastError: this.lastError,
            errors: this.errors,
        };
    }

    /** One-line connection state, appended to the stream errors so they name the cause. */
    public describe(): string {
        const s = this.status();
        const age = s.lastDataAgeMs === null ? "no data yet" : `last update ${s.lastDataAgeMs}ms ago`;
        const err = s.lastError === null ? "" : `; last ws error after ${s.errors}: ${s.lastError}`;
        if (s.closed) {
            return `lazer client closed; ${age}${err}`;
        }
        if (!s.connected) {
            return `lazer websockets disconnected for ${s.downForMs}ms; ${age}${err}`;
        }
        return `lazer websockets connected (${s.outages} prior outage(s)); ${age}${err}`;
    }
}

/**
 * Open a Lazer client with a monitor watching it: pool-level error callbacks are wired *before*
 * creation (so a failure during connect is captured too), the connection listeners right after. Both
 * stream getters start this way — connectedness isn't per-getter behaviour, and the error callbacks
 * are the only route by which a rejected subscription is observable at all.
 */
async function createMonitoredLazerClient(
    token: string,
    opts: PythLazerStreamOptions,
): Promise<{ lazer: PythLazerClient; monitor: LazerConnectionMonitor }> {
    const monitor = new LazerConnectionMonitor(opts.onConnectionChange, opts.onError);
    const lazer = await PythLazerClient.create({
        token,
        webSocketPoolConfig: {
            // Caller passthrough (urls / numConnections / rwsConfig) first, then our error callbacks
            // last so the monitor always sees pool errors regardless of what was supplied.
            ...opts.webSocketPoolConfig,
            onWebSocketError: (event) =>
                monitor.noteError(event.error ?? new Error(event.message || "lazer websocket error")),
            onWebSocketPoolError: (error) => monitor.noteError(error),
        },
    });
    monitor.attach(lazer);
    return { lazer, monitor };
}

const DEFAULT_STREAM_MAX_AGE_MS = 15_000;
const DEFAULT_STREAM_READY_TIMEOUT_MS = 15_000;

/**
 * Streaming getter: opens one Lazer subscription per channel up front over a single client (the SDK
 * multiplexes them and dedups across its redundant connections), caches the latest signed `leEcdsa`
 * blob per subscription, and serves refreshes straight from that warm cache — no Lazer round-trip per
 * request. Intended as the update source behind a cache / backend service.
 *
 * A blob is signed over its whole subscription feed set and can't be split per feed, so the per-channel
 * subscription is the cache granularity; requested feeds are mapped back to the subscription that
 * carries them. Blobs still age against the on-chain staleness window — see {@link maxAgeMs}.
 */
export class PythLazerStreamUpdateGetter implements PythProUpdateGetter, PythProHealthSource {
    private readonly lazer: PythLazerClient;
    /** channelId -> the feed ids subscribed on that channel (its signed blob covers all of them). */
    private readonly channelFeeds: Map<number, number[]>;
    /** feedId -> channelId, to route a requested feed to its channel's cached blob. */
    private readonly feedChannels: Map<number, number>;
    /** channelId -> latest signed blob (hex, serialized once on receipt) + local receipt time. */
    private readonly cache = new Map<number, { update: string; receivedAt: number }>();
    /** Staleness window a cached blob is served within; also the freshness bound a health check uses. */
    public readonly maxAgeMs: number;
    private readonly monitor: LazerConnectionMonitor;

    private constructor(
        lazer: PythLazerClient,
        channelFeeds: Map<number, number[]>,
        feedChannels: Map<number, number>,
        maxAgeMs: number,
        monitor: LazerConnectionMonitor,
    ) {
        this.lazer = lazer;
        this.channelFeeds = channelFeeds;
        this.feedChannels = feedChannels;
        this.maxAgeMs = maxAgeMs;
        this.monitor = monitor;
    }

    /**
     * @param token   Pyth Lazer access token (Lazer is permissioned).
     * @param network Network whose x_oracle config supplies the feeds to keep warm and their channels.
     *                Defaults to `'mainnet'`. One subscription is opened per channel.
     * @param opts    Staleness / warm-up tuning; see {@link PythLazerStreamOptions}.
     */
    public static async create(
        token: string,
        network: string = "mainnet",
        opts: PythLazerStreamOptions = {},
    ): Promise<PythLazerStreamUpdateGetter> {
        const feedChannels = feedChannelMap(network);
        const channelFeeds = new Map<number, number[]>();
        for (const { channelId, feedIds } of planUpdates([...feedChannels.keys()], feedChannels)) {
            channelFeeds.set(channelId, feedIds);
        }

        const { lazer, monitor } = await createMonitoredLazerClient(token, opts);
        const getter = new PythLazerStreamUpdateGetter(
            lazer,
            channelFeeds,
            feedChannels,
            opts.maxAgeMs ?? DEFAULT_STREAM_MAX_AGE_MS,
            monitor,
        );
        try {
            await getter.start(opts.readyTimeoutMs ?? DEFAULT_STREAM_READY_TIMEOUT_MS);
        } catch (error) {
            // Warm-up failed (bad token, unreachable endpoint, a feed that never ticks): the Lazer pool
            // is already running its own reconnect loop, so shut it down or a rejected create() leaks it.
            getter.close();
            throw error;
        }
        return getter;
    }

    private async start(readyTimeoutMs: number): Promise<void> {
        for (const [channelId, feedIds] of this.channelFeeds) {
            const channel = LAZER_CHANNEL_NAME[channelId];
            if (!channel) {
                throw new Error(`Unknown Lazer channel id ${channelId}`);
            }
            this.lazer.subscribe({
                type: "subscribe",
                // One subscription per channel, so the channel id doubles as the subscription id.
                subscriptionId: channelId,
                priceFeedIds: feedIds,
                // @ts-ignore - DEFAULT_LAZER_PROPERTIES is a readonly tuple of PriceFeedProperty
                properties: [...DEFAULT_LAZER_PROPERTIES],
                formats: ["leEcdsa"],
                deliveryFormat: "binary",
                parsed: false,
                channel: channel as Channel,
            });
        }

        this.lazer.addMessageListener((event) => {
            // Signed binary frames carry leEcdsa; JSON frames (subscribed / error) are ignored here —
            // a subscription that never delivers surfaces as a warm-up timeout below. Each subscription
            // is keyed by its channel id (see subscribe below), so the frame's subscriptionId is it.
            if (event.type !== "binary" || !event.value.leEcdsa) {
                return;
            }
            // Serialize the blob to hex once, here on receipt, so every later read/HTTP response reuses
            // it without re-encoding (see PythProUpdate.update).
            const receivedAt = Date.now();
            this.cache.set(event.value.subscriptionId, {
                update: Buffer.from(event.value.leEcdsa).toString("hex"),
                receivedAt,
            });
            this.monitor.markData(receivedAt);
        });

        await this.waitUntilWarm(readyTimeoutMs);
    }

    /** Resolve once every channel has cached at least one blob, else throw after `timeoutMs`. */
    private async waitUntilWarm(timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (![...this.channelFeeds.keys()].every((channelId) => this.cache.has(channelId))) {
            if (Date.now() >= deadline) {
                const missing = [...this.channelFeeds]
                    .filter(([channelId]) => !this.cache.has(channelId))
                    .map(([channelId, feedIds]) => `${LAZER_CHANNEL_NAME[channelId]}[${feedIds.join(",")}]`)
                    .join("; ");
                throw new Error(
                    `Lazer stream did not warm up within ${timeoutMs}ms; no data for: ${missing} (${this.monitor.describe()})`,
                );
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    public async obtainPythProUpdates(feedIDs: number[]): Promise<PythProUpdate[]> {
        // Bucket the requested feeds by channel — one cached signed blob covers each channel.
        const requestedByChannel = new Map<number, number[]>();
        for (const feedId of feedIDs) {
            const channelId = this.feedChannels.get(feedId);
            if (channelId === undefined) {
                throw new Error(`Pyth feed ${feedId} is not in the stream subscription set`);
            }
            let ids = requestedByChannel.get(channelId);
            if (!ids) {
                ids = [];
                requestedByChannel.set(channelId, ids);
            }
            ids.push(feedId);
        }

        const now = Date.now();
        const out: PythProUpdate[] = [];
        for (const [channelId, feedIds] of requestedByChannel) {
            const cached = this.cache.get(channelId);
            if (!cached) {
                throw new Error(
                    `No cached Pyth update yet for feeds ${feedIds.join(",")} (${this.monitor.describe()})`,
                );
            }
            const age = now - cached.receivedAt;
            if (age > this.maxAgeMs) {
                // A blob younger than maxAgeMs is served even mid-outage: it's still valid on chain, and
                // the SDK reconnects underneath. The outage only becomes an error once it outlives the
                // cache — which is this branch, so name it here.
                throw new Error(
                    `Cached Pyth update for feeds ${feedIds.join(",")} is stale (${age}ms > ${this.maxAgeMs}ms) (${this.monitor.describe()})`,
                );
            }
            out.push({ update: cached.update, feedIds });
        }
        return out;
    }

    /**
     * Current websocket health — see {@link LazerConnectionStatus}. Cheap and synchronous: a health
     * endpoint or supervisor can poll it, and `connected: false` means no update can arrive until the
     * SDK reconnects (which it does on its own).
     */
    public connectionStatus(): LazerConnectionStatus {
        return this.monitor.status();
    }

    /**
     * True while at least one websocket is up *and* a payload arrived within `maxAgeMs`. The second
     * half matters: a connected pool whose subscription silently stopped delivering still serves
     * nothing useful.
     */
    public isHealthy(): boolean {
        const s = this.monitor.status();
        return s.connected && s.lastDataAgeMs !== null && s.lastDataAgeMs <= this.maxAgeMs;
    }

    /**
     * feedId -> local receipt time (unix ms) of the newest cached blob covering it, `null` if none has
     * arrived yet. Every feed on a channel shares that channel's blob, so they report the same time.
     * The per-feed granularity a whole-getter {@link isHealthy} lacks — used to build a per-token
     * freshness report (see `OracleUpdateServer.health`).
     */
    public feedReceiptTimes(): Map<number, number | null> {
        const out = new Map<number, number | null>();
        for (const [feedId, channelId] of this.feedChannels) {
            const cached = this.cache.get(channelId);
            out.set(feedId, cached ? cached.receivedAt : null);
        }
        return out;
    }

    /** Close the underlying Lazer connections. */
    public close(): void {
        this.monitor.markClosed();
        this.lazer.shutdown();
    }
}

/**
 * Read-side health of a Pyth update getter: its connection state plus per-feed receipt times, enough
 * to build a per-token freshness report. Implemented by {@link PythLazerStreamUpdateGetter}; the
 * on-demand {@link PythLazerUpdateGetter} fetches live per request, so it caches no updates and tracks
 * no connection health, and does not implement this (it still owns a socket pool — see its `close`).
 * Split from {@link PythProUpdateGetter} so a consumer can capability-detect it (see
 * `OracleUpdateServer.health`).
 */
export interface PythProHealthSource {
    /** The staleness window feeds are judged fresh against. */
    readonly maxAgeMs: number;
    /** Current websocket-pool health — see {@link LazerConnectionStatus}. */
    connectionStatus(): LazerConnectionStatus;
    /** feedId -> newest cached-blob receipt time (unix ms), `null` if none yet. */
    feedReceiptTimes(): Map<number, number | null>;
}

/**
 * One feed's readable price, as delivered by a Lazer `parsed` subscription. The value is
 * `price * 10^exponent`; `exponent` is negative (e.g. `-8`).
 *
 * `price` / `emaPrice` stay decimal strings — the exact form Lazer sends and the form that survives
 * JSON without precision loss — so a price backend serves them with no encode step. They're parsed
 * to `bigint` only where a number is actually needed.
 */
export interface PythProPrice {
    feedId: number;
    /** Spot price, unscaled — apply `exponent`. */
    price: string;
    /** EMA price, unscaled — apply `exponent`. `null` if the feed didn't carry one. */
    emaPrice: string | null;
    /** Spot confidence interval, unscaled — apply `exponent` (same scale as `price`). `null` if the
     *  feed didn't carry one. */
    confidence: string | null;
    /** EMA confidence interval, unscaled — apply `exponent` (same scale as `emaPrice`). `null` if the
     *  feed didn't carry one. */
    emaConfidence: string | null;
    /** Base-10 exponent, negative (value = `price * 10^exponent`). */
    exponent: number;
    /** Lazer's payload timestamp, unix microseconds (decimal string). */
    timestampUs: string;
}

/**
 * Lazer feed properties requested in price mode — the readable value plus the spot/ema confidence
 * intervals, so a price consumer can watch how wide Pyth's uncertainty is (the confidence-to-price
 * ratio is what bounds a safe quote). The two properties {@link DEFAULT_LAZER_PROPERTIES} still adds
 * beyond these (`publisherCount`, `feedUpdateTimestamp`) exist only to satisfy
 * `x_oracle::pyth_adaptor::refresh_pyth_price`, which a price consumer never runs.
 */
const PRICE_LAZER_PROPERTIES = ["price", "emaPrice", "exponent", "confidence", "emaConfidence"] as const;

/** Warm-up / staleness tuning for {@link PythLazerStreamPriceGetter}, plus the feed-set narrowing. */
export interface PythLazerPriceStreamOptions extends PythLazerStreamOptions {
    /**
     * Subscribe only to the feeds Pyth is the *primary* source for, skipping the ones configured
     * purely as another source's secondary check. Default `false` (every configured Pyth feed).
     *
     * Set it when the consumer doesn't act on the check — a monitoring or quoting deployment that only
     * ever reads the primary price streams (and warms up on) fewer feeds this way. Leave it off to
     * compare the two sources, which is what the deviation bound (`lowerBoundBps`/`upperBoundBps`)
     * exists for.
     */
    primaryOnly?: boolean;
}

/**
 * Streaming price getter: subscribes per channel with `formats: []` and `parsed: true`, so Lazer sends
 * only the readable price payload — no signed `leEcdsa` blob and none of the adaptor-only properties.
 * That makes it the cheap counterpart to {@link PythLazerStreamUpdateGetter}, not a mode of it: signing
 * a blob you'll never submit (or parsing a payload you'll never read) is wasted bandwidth, so a
 * deployment opens whichever subscription matches what it actually serves.
 *
 * Unlike a signed blob — which is signed over a whole subscription feed set and can't be split — parsed
 * prices are per feed, so the cache is keyed by feed id and a request assembles exactly the feeds it
 * asked for. Cached prices still age; see {@link PythLazerStreamOptions.maxAgeMs}.
 */
export class PythLazerStreamPriceGetter {
    private readonly lazer: PythLazerClient;
    /** channelId -> the feed ids subscribed on that channel. */
    private readonly channelFeeds: Map<number, number[]>;
    /** feedId -> latest parsed price + local receipt time. */
    private readonly cache = new Map<number, { price: PythProPrice; receivedAt: number }>();
    private readonly maxAgeMs: number;
    private readonly monitor: LazerConnectionMonitor;

    private constructor(
        lazer: PythLazerClient,
        channelFeeds: Map<number, number[]>,
        maxAgeMs: number,
        monitor: LazerConnectionMonitor,
    ) {
        this.lazer = lazer;
        this.channelFeeds = channelFeeds;
        this.maxAgeMs = maxAgeMs;
        this.monitor = monitor;
    }

    /**
     * @param token   Pyth Lazer access token (Lazer is permissioned).
     * @param network Network whose x_oracle config supplies the feeds to keep warm and their channels.
     *                Defaults to `'mainnet'`. One subscription is opened per channel.
     * @param opts    Staleness / warm-up tuning and feed-set narrowing; see
     *                {@link PythLazerPriceStreamOptions}.
     */
    public static async create(
        token: string,
        network: string = "mainnet",
        opts: PythLazerPriceStreamOptions = {},
    ): Promise<PythLazerStreamPriceGetter> {
        const feedChannels = feedChannelMap(network, opts.primaryOnly ?? false);
        const channelFeeds = new Map<number, number[]>();
        for (const { channelId, feedIds } of planUpdates([...feedChannels.keys()], feedChannels)) {
            channelFeeds.set(channelId, feedIds);
        }

        const { lazer, monitor } = await createMonitoredLazerClient(token, opts);
        const getter = new PythLazerStreamPriceGetter(
            lazer,
            channelFeeds,
            opts.maxAgeMs ?? DEFAULT_STREAM_MAX_AGE_MS,
            monitor,
        );
        try {
            await getter.start(opts.readyTimeoutMs ?? DEFAULT_STREAM_READY_TIMEOUT_MS);
        } catch (error) {
            // Warm-up failed (bad token, unreachable endpoint, a feed that never ticks): the Lazer pool
            // is already running its own reconnect loop, so shut it down or a rejected create() leaks it.
            getter.close();
            throw error;
        }
        return getter;
    }

    private async start(readyTimeoutMs: number): Promise<void> {
        for (const [channelId, feedIds] of this.channelFeeds) {
            const channel = LAZER_CHANNEL_NAME[channelId];
            if (!channel) {
                throw new Error(`Unknown Lazer channel id ${channelId}`);
            }
            this.lazer.subscribe({
                type: "subscribe",
                subscriptionId: channelId,
                priceFeedIds: feedIds,
                // @ts-ignore - PRICE_LAZER_PROPERTIES is a readonly tuple of PriceFeedProperty
                properties: [...PRICE_LAZER_PROPERTIES],
                // No signature format: we want the readable payload only, so Lazer sends no signed blob.
                formats: [],
                deliveryFormat: "json",
                parsed: true,
                channel: channel as Channel,
            });
        }

        this.lazer.addMessageListener((event) => {
            // Parsed prices arrive as JSON `streamUpdated` frames; acks/errors carry no `parsed` payload
            // and are ignored — a subscription that never delivers surfaces as a warm-up timeout below.
            if (event.type !== "json" || event.value.type !== "streamUpdated" || !event.value.parsed) {
                return;
            }
            const { timestampUs, priceFeeds } = event.value.parsed;
            const receivedAt = Date.now();
            for (const feed of priceFeeds) {
                // A feed missing price or exponent can't be valued; skip it rather than cache a partial
                // entry that would read as fresh.
                if (feed.price === undefined || feed.exponent === undefined) {
                    continue;
                }
                this.cache.set(feed.priceFeedId, {
                    price: {
                        feedId: feed.priceFeedId,
                        price: feed.price,
                        emaPrice: feed.emaPrice ?? null,
                        // Lazer types confidence as a (small, integer) number, unlike the string price;
                        // stringify it so PythProPrice stays uniform and `pythToWad`'s BigInt parse holds.
                        confidence: feed.confidence == null ? null : feed.confidence.toString(),
                        emaConfidence: feed.emaConfidence == null ? null : feed.emaConfidence.toString(),
                        exponent: feed.exponent,
                        timestampUs,
                    },
                    receivedAt,
                });
            }
            this.monitor.markData(receivedAt);
        });

        await this.waitUntilWarm(readyTimeoutMs);
    }

    /** Resolve once every subscribed feed has cached a price, else throw after `timeoutMs`. */
    private async waitUntilWarm(timeoutMs: number): Promise<void> {
        const wanted = [...this.channelFeeds.values()].flat();
        const deadline = Date.now() + timeoutMs;
        while (!wanted.every((feedId) => this.cache.has(feedId))) {
            if (Date.now() >= deadline) {
                const missing = wanted.filter((feedId) => !this.cache.has(feedId)).join(", ");
                // The connection state is what separates the two ways this fails: nothing arriving at
                // all (socket down, or Lazer rejected the subscription — see LazerConnectionStatus.
                // lastError) versus a live stream that just doesn't carry some feed.
                throw new Error(
                    `Lazer price stream did not warm up within ${timeoutMs}ms; no data for feeds: ${missing} (${this.monitor.describe()})`,
                );
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    /** The latest price for every feed in `feedIDs`, served from the warm cache. */
    public async obtainPythProPrices(feedIDs: number[]): Promise<PythProPrice[]> {
        const now = Date.now();
        return feedIDs.map((feedId) => {
            const cached = this.cache.get(feedId);
            if (!cached) {
                throw new Error(`Pyth feed ${feedId} is not in the price subscription set`);
            }
            const age = now - cached.receivedAt;
            if (age > this.maxAgeMs) {
                // Fresh prices are served even mid-outage — the SDK reconnects underneath, and the value
                // is no worse than it was a tick ago. An outage only becomes an error once it outlives
                // the cache, which is this branch, so name the cause here.
                throw new Error(
                    `Cached Pyth price for feed ${feedId} is stale (${age}ms > ${this.maxAgeMs}ms) (${this.monitor.describe()})`,
                );
            }
            return cached.price;
        });
    }

    /**
     * Current websocket health — see {@link LazerConnectionStatus}. Cheap and synchronous: a health
     * endpoint or supervisor can poll it, and `connected: false` means no price can arrive until the
     * SDK reconnects (which it does on its own).
     */
    public connectionStatus(): LazerConnectionStatus {
        return this.monitor.status();
    }

    /**
     * True while at least one websocket is up *and* a payload arrived within `maxAgeMs`. The second
     * half matters: a connected pool whose subscription silently stopped delivering still serves
     * nothing useful.
     */
    public isHealthy(): boolean {
        const s = this.monitor.status();
        return s.connected && s.lastDataAgeMs !== null && s.lastDataAgeMs <= this.maxAgeMs;
    }

    /** Close the underlying Lazer connections. */
    public close(): void {
        this.monitor.markClosed();
        this.lazer.shutdown();
    }
}

/**
 * Turns already-fetched signed Pyth Pro updates into on-chain verified `Update` arguments — a pure tx
 * builder; fetching lives in {@link PythProUpdateGetter} implementations (and `OracleUpdateServer`).
 * `parse_and_verify_le_ecdsa_update_v2` runs on `pythProPackageId` — the same `pyth_lazer` package
 * x_oracle was published against — so the returned `Update` type matches
 * `x_oracle::pyth_update::refresh_pyth_price_feed`'s parameter (see `XOracleClient`).
 */
export class PythProClient {
    private stateObjectId: string;
    private pythProPackageId: string;

    /**
     * @param pythProPackageId  Deployed `pyth_lazer` package id. Defaults to {@link PYTH_PRO_PACKAGE_ID}.
     * @param stateObjectId     Shared `State` object id. Defaults to {@link PYTH_PRO_STATE_ID}.
     */
    constructor(
        pythProPackageId: string = PYTH_PRO_PACKAGE_ID,
        stateObjectId: string = PYTH_PRO_STATE_ID,
    ) {
        this.pythProPackageId = pythProPackageId;
        this.stateObjectId = stateObjectId;
    }

    /**
     * Append the parse+verify move call for an already-fetched update; returns the `Update` arg.
     * `update` is the hex-encoded signed blob ({@link PythProUpdate.update}); it's decoded to bytes
     * here — the one place the wire form is turned back into on-chain bytes.
     */
    public populateDeriveUpdate(tx: Transaction, update: string): TransactionObjectArgument {
        return tx.moveCall({
            arguments: [
                tx.object(this.stateObjectId),
                tx.object.clock(),
                tx.pure.vector("u8", Buffer.from(update, "hex")),
            ],
            target: `${this.pythProPackageId}::pyth_lazer::parse_and_verify_le_ecdsa_update_v2`,
        });
    }

    /**
     * Append one parse+verify per already-fetched signed blob and return a map from feed id to its
     * verified on-chain `Update` argument. Feeds carried by the same blob share one `Update` (it's
     * `copy` on chain), so each is refreshed from the same verified value.
     */
    public populateUpdates(
        tx: Transaction,
        updates: PythProUpdate[],
    ): Map<number, TransactionObjectArgument> {
        const byFeedId = new Map<number, TransactionObjectArgument>();
        for (const { update, feedIds } of updates) {
            const arg = this.populateDeriveUpdate(tx, update);
            for (const feedId of feedIds) {
                byFeedId.set(feedId, arg);
            }
        }
        return byFeedId;
    }
}

/**
 * Lazer feed properties requested from the price service. These are exactly the fields the on-chain
 * adaptor consumes in `x_oracle::pyth_adaptor::refresh_pyth_price` — exponent, publisher count,
 * spot price + confidence, ema price + confidence, and the per-feed update timestamp.
 *
 * The leEcdsa binary only carries the properties that were requested, and the on-chain
 * `feed::parse_from_cursor` reads whichever ids are present; omitting a required one makes the
 * refresh abort (`pyth_pro_missing_item`). `feedUpdateTimestamp` (property id 12 on-chain) is
 * required by the adaptor's staleness check — confirm its request name against your Lazer SDK
 * version if the refresh aborts with a missing-item error.
 */
const DEFAULT_LAZER_PROPERTIES = [
    "price",
    "exponent",
    "publisherCount",
    "confidence",
    "emaPrice",
    "emaConfidence",
    "feedUpdateTimestamp",
] as const;

/**
 * feedId -> Lazer channel id for a network's configured Pyth feeds, read straight from the x_oracle
 * config. This is the feed universe a getter can serve — callers pass a network, not a feed list.
 *
 * `primaryOnly` narrows it to the assets Pyth is the *primary* source for, dropping the feeds that
 * exist only to serve a secondary check (`checkSourceId`). A deployment that doesn't act on the check
 * shouldn't pay to stream those feeds — see {@link PythLazerPriceStreamOptions.primaryOnly}.
 */
function feedChannelMap(network: string, primaryOnly = false): Map<number, number> {
    const map = new Map<number, number>();
    for (const c of Object.values(getNetworkConfig(network).xOracle)) {
        if (c.pyth && (!primaryOnly || c.config.primarySourceId === SOURCE_ID.PYTH)) {
            map.set(c.pyth.feedId, c.pyth.channelId);
        }
    }
    return map;
}

/**
 * Group `feedIDs` by their configured Lazer channel — the unit a single signed Lazer update /
 * subscription covers (feeds on different channels can't share a signed blob).
 */
function planUpdates(
    feedIDs: number[],
    feedChannels: Map<number, number>,
): { channelId: number; feedIds: number[] }[] {
    const byChannel = new Map<number, number[]>();
    for (const feedId of feedIDs) {
        const channelId = feedChannels.get(feedId);
        if (channelId === undefined) {
            throw new Error(`No Lazer channel configured for Pyth feed ${feedId}`);
        }
        let ids = byChannel.get(channelId);
        if (!ids) {
            ids = [];
            byChannel.set(channelId, ids);
        }
        ids.push(feedId);
    }
    return [...byChannel].map(([channelId, feedIds]) => ({ channelId, feedIds }));
}
