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
