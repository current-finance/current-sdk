import type { SuiPriceServiceConnection } from '@pythnetwork/pyth-sui-js';
import { TypeName } from '../market-types/assets';
import { Decimal } from '../market-types';

// Pyth price feed configuration interface
export interface PythFeedConfig {
  priceFeedId: string;
}

// Pyth network configuration interface
export interface PythConfig {
  pythStateId: string;
  wormholeStateId: string;
  hermesEndpoint: string;
  priceFeeds: Record<string, PythFeedConfig>;
}

// Get Pyth configuration.
export function getPythConfig(network: string): PythConfig {
  if (network !== 'mainnet') {
    throw new Error(`Unsupported network: ${network} (only mainnet is supported)`);
  }
  return {
    pythStateId: '0x1f9310238ee9298fb703c3419030b35b22bb1cc37113e3bb5007c99aec79e5b8',
    wormholeStateId: '0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c', 
    hermesEndpoint: 'https://hermes.pyth.network',
    priceFeeds: {
      'SUI': { priceFeedId: '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744' },
      'USDC': { priceFeedId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a' },
      'USDT': { priceFeedId: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b' },
      'USDY': { priceFeedId: '0xe393449f6aff8a4b6d3e1165a7c9ebec103685f3b41e60db4277b5b6d10e7326' },
      'USDB': { priceFeedId: '0xf85d863ce3b640bf85307be333dedc563aa3a27961c9042f89ed8300ebd3c855' },
      'FDUSD': { priceFeedId: '0xccdc1a08923e2e4f4b1e6ea89de6acbc5fe1948e9706f5604b8cb50bc1ed3979' },
      'USDSUI': { priceFeedId: '0xd510fcdb3a63f35d3bb118d5db3afc5815a3f13bc55d48abb893b63f0315902a' },
      'SUI_USDE': { priceFeedId: '0x8cead549d0e770dea8fdf5e018a85d59585265cf8bff16ba83962fc7996dbb7f' },
      'HASUI': { priceFeedId: '0x6120ffcf96395c70aa77e72dcb900bf9d40dccab228efca59a17b90ce423d5e8' },
      'STSUI': { priceFeedId: '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744' },
      'AFSUI': { priceFeedId: '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744' },
      'CERT': { priceFeedId: '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744' },
      'SPRING_SUI': { priceFeedId: '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744' },
      'XBTC': { priceFeedId: '0xae8f269ed9c4bed616c99a98cf6dfe562bd3202e7f91821a471ff854713851b4' },
      'BTC': { priceFeedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' },
      'LBTC': { priceFeedId: '0x8f257aab6e7698bb92b15511915e593d6f8eae914452f781874754b03d0c612b' },
      'ETH': { priceFeedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' },
      'DEEP': { priceFeedId: '0x29bdd5248234e33bd93d3b81100b5fa32eaa5997843847e2c2cb16d7c6d9f7ff' },
      'WAL': { priceFeedId: '0xeba0732395fae9dec4bae12e52760b35fc1c5671e2da8b449c9af4efe5d54341' },
      'XAUM': { priceFeedId: '0xd7db067954e28f51a96fd50c6d51775094025ced2d60af61ec9803e553471c88' },
      'ESUI': { priceFeedId: '0xbda725d49cd46896bfb3c2d6ebd778467274db6073ec1e871a8e14f9711d9563' },
      'ETHIRD': { priceFeedId: '0x5554bb6524edc42e933a6f67542baefe2ebe5cb2a6238f55b9471ca9e258439e' },
      'EEARN': { priceFeedId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a' },
    },
  };
}

function extractCoinSymbol(coinType: TypeName): string {
  const parts = coinType.split('::');
  if (parts.length >= 3) {
    return parts[parts.length - 1].toUpperCase();
  }
  if (parts.length >= 2) {
    return parts[parts.length - 2].toUpperCase();
  }
  throw new Error(`Cannot extract coin symbol from type: ${coinType}`);
}

/**
 * Fetch latest prices from Pyth Hermes for the given assets.
 * Returns a Map from asset TypeName to Decimal price (18-digit precision).
 */
export async function fetchPythPrices(
  connection: SuiPriceServiceConnection,
  network: string,
  assets: TypeName[],
): Promise<Map<TypeName, Decimal>> {
  const pythConfig = getPythConfig(network);

  const feedEntries = assets.map(assetType => {
    const coinSymbol = extractCoinSymbol(assetType);
    const feedConfig = pythConfig.priceFeeds[coinSymbol];
    if (!feedConfig) {
      throw new Error(`No Pyth price feed found for coin: ${coinSymbol}`);
    }
    return { assetType, priceFeedId: feedConfig.priceFeedId };
  });

  const priceFeedIds = feedEntries.map(e => e.priceFeedId);
  const priceUpdates = await connection.getLatestPriceUpdates(priceFeedIds, { parsed: true });

  if (!priceUpdates.parsed) {
    throw new Error('Failed to fetch parsed price updates from Pyth');
  }

  const prices = new Map<TypeName, Decimal>();

  for (const parsed of priceUpdates.parsed) {
    const matchingEntries = feedEntries.filter(e => e.priceFeedId === `0x${parsed.id}`);
    if (matchingEntries.length === 0) continue;

    // Pyth price: price * 10^expo. Convert to Decimal (18-digit precision).
    // Decimal raw = priceValue * 10^(18 + expo)
    const priceValue = BigInt(parsed.price.price);
    const expo = parsed.price.expo;
    const shift = 18 + expo;
    let raw: bigint;
    if (shift >= 0) {
      raw = priceValue * (10n ** BigInt(shift));
    } else {
      raw = priceValue / (10n ** BigInt(-shift));
    }
    for (const entry of matchingEntries) {
      prices.set(entry.assetType, new Decimal(raw));
    }
  }

  return prices;
}