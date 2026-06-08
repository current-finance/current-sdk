import {
  Decimal,
  Obligation,
  LendingClient,
  Market,
  coinMetadatas,
  getMarket,
  type ObligationData,
} from '@current-finance/current-sdk';

export async function getObligationDetail(marketName: string, network: 'mainnet'): Promise<void> {
  const client = LendingClient.fromConfig({ network, pythEndpoint: 'https://hermes.pyth.network' });

  const obligationId = ''; // add obligation id

  const marketInfo = getMarket(network, marketName);
  const emode = 0;
  const snapshot = await client.getEmodeGroupMarketSnapshot(marketInfo.type, emode);
  const market = new Market(marketInfo.type, marketInfo.objectId, snapshot.assets, snapshot.emodeGroups, coinMetadatas);
  const details: ObligationData = await client.getObligationDetail(obligationId, market);

  console.log('\n=== FINAL RESULTS ===');
  console.log('Obligation Details:');
  console.log('  Emode group id:', details.emodeGroupId);
  console.log('  Borrows length:', details.borrows.length);
  console.log('  Deposits length:', details.deposits.length);

  if (details.borrows.length > 0) {
    console.log('\n  Borrows:');
    details.borrows.forEach((borrow, index) => {
      console.log(`    ${index}: ${borrow.coinType} - ${borrow.amount()} (USD: ${borrow.usdValue.toString()}) - apy ${borrow.apy(Decimal.one(), 1754386522)}`);
    });
  }

  if (details.deposits.length > 0) {
    console.log('\n  Deposits:');
    details.deposits.forEach((deposit, index) => {
      console.log(`    ${index}: ${deposit.coinType} - ${deposit.ctokenAmount()} ${deposit.amount()} (USD: ${deposit.usdValue.toString()})`);
    });
  }

  const position = new Obligation(details);
  console.log('current ltv', position.currentLTV(market).asNumber());
  console.log('max ltv', position.maxLTV(market).asNumber());
  console.log('liquidation ltv', position.liquidationLTV(market).asNumber());
}

// Run examples
getObligationDetail('MainMarket', 'mainnet').catch(console.error);
