import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { TokenExchange } from '.';
import { EmberVault } from './ember';

export class EThird extends EmberVault {
  constructor(client: SuiClient) {
    super(client, 'eThird', TokenExchange.EThird, 'eThird');
  }

  public static newInstance(client: SuiClient): EThird {
    return new EThird(client);
  }
}
