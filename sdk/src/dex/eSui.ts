import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { TokenExchange } from '.';
import { EmberVault } from './ember';

export class ESui extends EmberVault {
  constructor(client: SuiClient) {
    super(client, 'eSui', TokenExchange.ESui, 'eSui');
  }

  public static newInstance(client: SuiClient): ESui {
    return new ESui(client);
  }
}
