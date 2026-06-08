import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { TokenExchange } from '.';
import { EmberVault } from './ember';

export class EEarn extends EmberVault {
  constructor(client: SuiClient) {
    super(client, 'eEarn', TokenExchange.EEarn, 'eEarn');
  }

  public static newInstance(client: SuiClient): EEarn {
    return new EEarn(client);
  }
}
