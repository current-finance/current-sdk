import { EModeParams, LendingClient } from '@current-finance/current-sdk';

async function getMarketDetail(network: 'mainnet', marketName: string = 'MainMarket') {
  const client = LendingClient.fromConfig({
    network,
    pythEndpoint: 'https://hermes.pyth.network',
  });

  console.log('=== GET MARKET DETAIL ===');

  const market = client.listMarkets().find((m) => m.name === marketName);
  if (!market) {
    throw new Error(`Market '${marketName}' not found`);
  }

  console.log(`Market: ${market.name}`);
  console.log(`Emode groups in market: ${market.emodeGroups.length}`);
  console.log(`Groups: ${market.emodeGroups.map((g) => `${g.emodeId}/${g.name}`).join(', ')}\n`);

  const targetEmodes = [0, 1, 2, 4, 5, 6, 7, 8];

  // Prefetch Pyth prices once for the union of assets across the emode groups
  // we're going to query, so each snapshot call below skips its own pyth fetch
  // and we measure only the asset/emode RPC paths the cache is meant to dedupe.
  const allAssets = Array.from(new Set(
    targetEmodes.flatMap((id) => market.emodeGroups.find((g) => g.emodeId === id)?.assets ?? []),
  ));
  const tPyth = Date.now();
  const priceMap = await client.fetchPythPrices(allAssets);
  console.log(`Prefetched ${priceMap.size} Pyth prices in ${Date.now() - tPyth}ms`);

  // Fire one snapshot per emode group concurrently. The CachedQueryClient
  // dedupes the underlying asset fetches via shared promises, so overlapping
  // assets across groups should resolve from one batched asset RPC.
  const t0 = Date.now();
  const snapshots = await Promise.all(
    targetEmodes.map((groupId) => {
      const groupConfig = market.emodeGroups.find((g) => g.emodeId === groupId)!;
      const assetPrices = groupConfig.assets.map((assetType) => ({
        assetType,
        price: priceMap.get(assetType)!,
      }));
      return client.getEmodeGroupMarketSnapshot(market.type, groupId, assetPrices);
    }),
  );
  console.log(`Fetched ${snapshots.length} snapshots in ${Date.now() - t0}ms\n`);

  // Asset-level state (utilization, paused flags, interest model, deposits,
  // borrows) is the same regardless of emode group, so take it from the first
  // snapshot. Per-group emode params come from each snapshot's emodeGroups Map.
  const baseSnapshot = snapshots[0];

  // Index: assetCoinType -> emodeId -> EModeParams
  const emodeIndex = new Map<string, Map<number, EModeParams>>();
  for (let i = 0; i < snapshots.length; i++) {
    const groupId = market.emodeGroups[i].emodeId;
    const params = snapshots[i].emodeGroups.get(groupId) ?? [];
    for (const p of params) {
      if (!emodeIndex.has(p.asset)) {
        emodeIndex.set(p.asset, new Map());
      }
      emodeIndex.get(p.asset)!.set(groupId, p);
    }
  }

  console.log('=== ASSET DETAILS ===');
  baseSnapshot.assets.forEach((asset, index) => {
    const symbol = getCoinSymbol(asset.coinType);
    console.log(`\n${index + 1}. ${symbol}`);
    console.log(`   Full Type: ${asset.coinType}`);
    console.log(`   Utilization Rate: ${asset.utilizationRate.toString()}`);
    console.log(`   Total Deposits: ${asset.depositUsage.amount()} (${asset.depositUsage.usdValue.toString()} USD)`);
    console.log(`   Total Borrows:  ${asset.borrowUsage.amount()} (${asset.borrowUsage.usdValue.toString()} USD)`);
    console.log(`   Exchange Rate: ${asset.depositUsage.exchangeRate().toString()}`);
    console.log(`   Borrow Index:  ${asset.borrowUsage.borrowIndex().toString()}`);
    console.log(`   Price (USD):   ${asset.depositUsage.price().toString()}`);
    console.log(`   Paused: borrow=${asset.borrowPaused} deposit=${asset.depositPaused} withdraw=${asset.withdrawPaused} liquidation=${asset.liquidationPaused} flashLoan=${asset.flashLoanPaused}`);
    console.log(`   Reserve: ${asset.reserve.toString()}`);
    console.log(`   Interest Model: ${asset.interestModel.type}`);
    console.log(`     Base Rate:      ${asset.interestModel.params.baseBorrowRatePerSec.toString()}`);
    console.log(`     Mid Kink:       ${asset.interestModel.params.midKink.toString()}`);
    console.log(`     High Kink:      ${asset.interestModel.params.highKink.toString()}`);
    console.log(`     Max Borrow Rate: ${asset.interestModel.params.maxBorrowRate.toString()}`);
    console.log(`   Min Borrow Amount: ${asset.assetSetting.minBorrowAmount}`);
    console.log(`   Max Borrow Amount: ${asset.assetSetting.maxBorrowAmount}`);
    console.log(`   Max Deposit Amount: ${asset.assetSetting.maxDepositAmount}`);

    const perEmode = emodeIndex.get(asset.coinType);
    if (!perEmode || perEmode.size === 0) {
      console.log('   (no emode groups include this asset)');
      return;
    }

    console.log('   Emode params:');
    for (const group of market.emodeGroups) {
      const params = perEmode.get(group.emodeId);
      if (!params) continue;
      console.log(`     [${group.emodeId} ${group.name}]`);
      console.log(`       collateralFactor:     ${params.collateralFactor.asNumber()}`);
      console.log(`       liquidationFactor:    ${params.liquidationFactor.asNumber()}`);
      console.log(`       liquidationIncentive: ${params.liquidationIncentive.asNumber()}`);
      console.log(`       borrowWeight:         ${params.borrowWeight.asNumber()}`);
      console.log(`       maxBorrowAmount:      ${params.maxBorrowAmount}`);
      console.log(`       currentBorrowAmount:  ${params.currentBorrowAmount}`);
      console.log(`       flashLoanFeeRate:     ${params.flashLoanFeeRate.asNumber()}`);
      console.log(`       depositLimiter: limit=${params.depositLimiter.limit} usage=${params.depositLimiter.usage}`);
      console.log(`       borrowLimiter:  limit=${params.borrowLimiter.limit} usage=${params.borrowLimiter.usage}`);
    }
  });
}

function getCoinSymbol(coinType: string): string {
  const parts = coinType.split('::');
  return parts[parts.length - 1];
}

getMarketDetail('mainnet').catch((err) => {
  console.error('Error fetching market detail:', err);
  process.exit(1);
});
