import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { TypeName } from '../market-types/assets';
import { Decimal } from '../market-types';
import mainnetCoinsMetadata from '../config/mainnet_coins_metadata.json';

export interface CoinMetadata {
  id: string;
  decimals: number;
  name: string;
  symbol: string;
  description: string;
  iconUrl?: string;
}

/**
 * Get coin metadata for a given coin type
 * @param client - SuiClient instance
 * @param coinType - The type name of the coin (e.g., "0x2::sui::SUI")
 * @returns Promise<CoinMetadata | null> - Coin metadata or null if not found
 */
export async function getCoinMetadata(
  client: SuiClient,
  coinType: TypeName,
): Promise<CoinMetadata> {
  if (!coinType.startsWith('0x')) {
    coinType = `0x${coinType}`;
  }

  // gRPC returns `{ coinMetadata: CoinMetadata | null }` — unwrap it.
  const { coinMetadata } = await client.getCoinMetadata({ coinType });

  if (!coinMetadata) {
    throw new Error(`Coin ${coinType} not found`);
  }

  return {
    id: coinMetadata.id ?? '',
    decimals: coinMetadata.decimals,
    name: coinMetadata.name || '',
    symbol: coinMetadata.symbol || '',
    description: coinMetadata.description || '',
    iconUrl: coinMetadata.iconUrl || undefined,
  };
}

export function parseCoinDecimals(decimals: number): Decimal {
  const numstr = '1' + '0'.repeat(decimals);
  return Decimal.fromString(numstr);
}

/**
 * Load coin metadata from configuration 
 */
export function loadCoinMetadataByNetwork(network: 'mainnet'): Map<TypeName, CoinMetadata> {
  const metadataMap = new Map<TypeName, CoinMetadata>();

  if (network !== 'mainnet') {
    throw new Error(`Unsupported network: ${network} (only mainnet is supported)`);
  }

  const metadataConfig = mainnetCoinsMetadata;
  if (metadataConfig.network === 'mainnet' && metadataConfig.coins) {
    for (const [coinType, metadata] of Object.entries(metadataConfig.coins)) {
      metadataMap.set(coinType, metadata as CoinMetadata);
    }
  }

  return metadataMap;
}