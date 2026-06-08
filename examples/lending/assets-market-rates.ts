import {
  LendingClient,
} from '@current-finance/current-sdk';

async function getAssetsMarketRates(marketName: string, network: 'mainnet') {
  const client = LendingClient.fromConfig({ network, pythEndpoint: 'https://hermes.pyth.network' });

  const market = client.listMarkets().find(m => m.name === marketName);
  if (!market) {
    throw new Error(`Market '${marketName}' not found`);
  }

  const assetTypes = client.query.getAllAssetsInMarket(market.type);
  const rates = await client.query.getAssetsMarketRates(market.type, assetTypes);

  console.log(`\n=== All Asset Market Rates for ${marketName} ===`);
  console.log(`Total assets: ${rates.length}\n`);

  for (const rate of rates) {
    const symbol = rate.assetType.split('::').pop();
    console.log(`${symbol}:`);
    console.log(`  Exchange Rate: ${rate.exchangeRate.toString()}`);
    console.log(`  Borrow Index:  ${rate.borrowIndex.toString()}`);
  }

  return rates;
}

// Run example
getAssetsMarketRates('MainMarket', 'mainnet').catch(console.error);
