import { StorkClient } from '@current-protocol/current-sdk';
import { XOracleClient, OracleUpdateClient } from '@current-protocol/current-sdk';
import { PythProClient } from '@current-protocol/current-sdk';

export function createOracleClient(): XOracleClient {
  // Client side: XOracleClient only talks to the backend over HTTP (axios) and builds the tx. The
  // PythProClient/StorkClient are pure tx builders — StorkClient just supplies Stork config/state.
  const oracleClient = new XOracleClient(
    new OracleUpdateClient(`https://oracle.current.finance`),
    new PythProClient(),
    new StorkClient(),
  );

  return oracleClient;
}
