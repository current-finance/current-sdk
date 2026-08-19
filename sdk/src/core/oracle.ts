import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { normalizeStructTag } from '@mysten/sui/utils';
import axios from 'axios';
import { LendingError, TypeName } from '../market-types';
import { NETWORK_CONFIGS, NetworkConfig, OracleAssetConfig, SOURCE_ID } from '../config/networks';
import { PythProClient, PythProUpdate} from '../utils/pyth-pro-client';
import { StorkClient, StorkUpdateRow } from '../utils/stork-client';

export interface OracleUpdate {
    pyth: PythProUpdate[] | null,
    stork: StorkUpdateRow[] | null,
}

/** Base token ids of the outer prices table (`x_oracle::x_oracle::BaseToken`). */
export const BASE_TOKEN = { USD: 0, SUI: 1 } as const;

/**
 * Client for a running {@link OracleUpdateServer}: forwards a coin-type list to the backend's
 * `GET /oracleUpdate` and returns the {@link OracleUpdate} it responds with. The payload is JSON-native,
 * so `axios` parses it straight into the shape `XOracleClient` consumes — no decoding step.
 */
export class OracleUpdateClient {
    private oracleUpdateBackendUrl: string;

    /** @param oracleUpdateBackendUrl Base url of the oracle server, e.g. `http://localhost:8080`. */
    constructor(oracleUpdateBackendUrl: string) {
        this.oracleUpdateBackendUrl = oracleUpdateBackendUrl.replace(/\/$/, '');
    }

    public async getPriceFeedUpdates(coinTypes: TypeName[]): Promise<OracleUpdate> {
        const res = await axios.get<OracleUpdate>(`${this.oracleUpdateBackendUrl}/oracleUpdate`, {
            params: { coinTypes: coinTypes.join(',') },
        });
        return res.data;
    }
}

/**
 * The one thing `LendingClient` needs from the oracle stack: putting an x_oracle refresh in front of a
 * transaction. Implemented by {@link XOracleClient} for a client that transacts, and by
 * {@link ReadOnlyXOracleClient} for one that only queries.
 */
export interface OracleRefresher {
    refreshOraclePrices(tx: Transaction, assets: TypeName[]): Promise<void>;
}

/**
 * A stand-in for {@link XOracleClient} for query-only deployments — an API server, a dashboard — that
 * read prices (e.g. from an `OraclePriceSubscriptionServer`) but never submit a transaction. It exists
 * so those don't have to wire the whole signed-update stack (Lazer + Stork update getters, an
 * `OracleUpdateServer`, the API tokens for both) just to satisfy a constructor.
 *
 * {@link refreshOraclePrices} throws rather than no-op'ing: a transaction silently built without its
 * refresh would abort on chain against a stale or missing price, which is far harder to read than this.
 */
export class ReadOnlyXOracleClient implements OracleRefresher {
    public async refreshOraclePrices(_tx: Transaction, _assets: TypeName[]): Promise<void> {
        throw new LendingError(
            'This client is read-only: it was built with ReadOnlyXOracleClient, which cannot refresh ' +
            'oracle prices. Construct it with a real XOracleClient to submit transactions.',
        );
    }
}

export class XOracleClient implements OracleRefresher {
    private oracleClient: OracleUpdateClient;
    private pythClient: PythProClient;
    private storkClient: StorkClient;

    // SUI rpc for simulation can be extremely slow in catching up. Delay for simulation execution.
    private postFetchUpdateDelayMs: number;

    private network: 'mainnet' = 'mainnet'; // hardcode for now.

    constructor(
        oracleClient: OracleUpdateClient,
        pythClient: PythProClient,
        storkClient: StorkClient,
        postFetchUpdateDelayMs: number = 1000
    ) {
        this.oracleClient = oracleClient;
        this.pythClient = pythClient;
        this.storkClient = storkClient;
        this.postFetchUpdateDelayMs = postFetchUpdateDelayMs;
    }

    private isSourceID(config: OracleAssetConfig, sourceID: number): boolean {
        return config.config.checkSourceId === sourceID || config.config.primarySourceId === sourceID;
    }

    private typeArg(asset: TypeName): string {
        return asset.startsWith('0x') ? asset : `0x${asset}`;
    }

    public async refreshOraclePrices(tx: Transaction, assets: TypeName[]): Promise<void> {
        assets = assets.map(asset => this.typeArg(asset));
        const net: NetworkConfig = NETWORK_CONFIGS[this.network];
        const xoracleConfig = net.xOracle;
        const pkg = net.xOraclePackageId;
        const xOracle = tx.object(net.xOracleId);
        const storkState = tx.object(this.storkClient.config.storkStateId);
        const clock = tx.object.clock();

        // A SUI-base asset's USD price is composed with the SUI/USD leg at read time, so SUI must be
        // refreshed alongside it — otherwise the composed read aborts on a stale SUI price. Add SUI to
        // the refresh set (and thus to the fetched updates below) whenever any requested asset is
        // SUI-base, deduping so it isn't refreshed twice when the caller already included it.
        const suiTag = normalizeStructTag('0x2::sui::SUI');
        if (assets.some((a) => xoracleConfig[a]?.config.baseTokenId === BASE_TOKEN.SUI)) {
            const suiKey = Object.keys(xoracleConfig).find((k) => normalizeStructTag(this.typeArg(k)) === suiTag);
            if (!suiKey) {
                throw new LendingError('A SUI-base asset was requested but SUI is not in the oracle config');
            }
            if (!assets.some((a) => normalizeStructTag(this.typeArg(a)) === suiTag)) {
                assets.push(suiKey);
            }
        }

        // Resolve each asset's config once — needed below to route each to its refresh calls (and, for
        // Pyth, to look up its feed's verified `Update`).
        const resolved = assets.map((asset) => {
            const cfg = xoracleConfig[asset];
            if (cfg === undefined) {
                throw new LendingError(`Missing asset config: ${asset}`);
            }
            if (this.isSourceID(cfg, SOURCE_ID.PYTH) && !cfg.pyth) {
                throw new LendingError(`Missing asset pyth config: ${asset}`);
            }
            if (this.isSourceID(cfg, SOURCE_ID.STORK) && !cfg.stork) {
                throw new LendingError(`Missing asset stork config: ${asset}`);
            }
            return { asset, cfg };
        });

        const update: OracleUpdate = await this.oracleClient.getPriceFeedUpdates(assets);

        const pythUpdateByFeedId = update.pyth
            ? this.pythClient.populateUpdates(tx, update.pyth)
            : new Map<number, TransactionObjectArgument>();

        if (update.stork) {
            this.storkClient.populateStorkUpdateFromRows(tx, update.stork);
        }

        if (this.postFetchUpdateDelayMs !== 0) {
            await sleep(this.postFetchUpdateDelayMs);
        }
        
        // Per asset: start -> refresh each configured source -> complete.
        for (const { asset, cfg } of resolved) {
            const typeArguments = [this.typeArg(asset)];

            let potato = tx.moveCall({
                target: `${pkg}::update::start_update`,
                typeArguments,
                arguments: [],
            });

            if (this.isSourceID(cfg, SOURCE_ID.PYTH)) {
                const pythUpdate = pythUpdateByFeedId.get(cfg.pyth!.feedId)!;
                potato = tx.moveCall({
                    target: `${pkg}::pyth_update::refresh_pyth_price_feed`,
                    typeArguments,
                    arguments: [xOracle, pythUpdate, potato, clock],
                });
            }
            if (this.isSourceID(cfg, SOURCE_ID.STORK)) {
                potato = tx.moveCall({
                    target: `${pkg}::stork_oracle::refresh_stork_price_feed`,
                    typeArguments,
                    arguments: [xOracle, storkState, potato, clock],
                });
            }
            if (this.isSourceID(cfg, SOURCE_ID.ADMIN_REF)) {
                potato = tx.moveCall({
                    target: `${pkg}::admin_ref_feed::refresh_admin_ref_price_feed`,
                    typeArguments,
                    arguments: [xOracle, potato],
                });
            }

            tx.moveCall({
                target: `${pkg}::update::complete_update`,
                typeArguments,
                arguments: [potato, xOracle],
            });
        }
    }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
