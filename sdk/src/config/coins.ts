import { TypeName } from '../market-types';
import { CoinMetadata } from '../utils/coin-metadata';

import mainnetCoinsMetadata from './mainnet_coins_metadata.json';

export { mainnetCoinsMetadata };

export const coinMetadatas: Map<TypeName, CoinMetadata> = new Map(
  Object.entries(mainnetCoinsMetadata.coins).map(
    ([coinType, metadata]) => [coinType as TypeName, metadata as CoinMetadata],
  ),
);
