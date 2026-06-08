import {
  Decimal,
  LendingClient,
  Market,
  Obligation,
  coinMetadatas,
  getMarket,
  parseCoinDecimals,
  type TypeName,
} from '@current-finance/current-sdk';

const NETWORK = 'mainnet';
const MARKET_NAME = 'MainMarket';
const EMODE_GROUP_ID = 0;

// TODO: Replace with the obligation id you want to inspect.
const OBLIGATION_ID = '';


function liquidationWeightedCollateral(
  obligation: Obligation,
  market: Market,
  excludeType?: TypeName,
): Decimal {
  let total = Decimal.zero();
  for (const asset of obligation.depositAssets()) {
    if (excludeType !== undefined && asset === excludeType) continue;
    const emode = market.findAssetEmodeParams(obligation.getEmodeGroupId(), asset);
    if (!emode || emode.collateralFactor.equals(Decimal.zero())) continue;
    total = total.add(obligation.getDeposit(asset).usdValue.mul(emode.liquidationFactor));
  }
  return total;
}

/** USD price of `collateralType` at which the obligation becomes liquidatable (price falling). */
export function collateralLiquidationPrice(
  obligation: Obligation,
  market: Market,
  collateralType: TypeName,
): Decimal {
  // At liquidation: weightedDebt == otherCollateral + liquidationFactor * price * amount / decimals
  const totalBorrow = obligation.totalBorrowUsdWeighted(market);
  const otherCollateral = liquidationWeightedCollateral(obligation, market, collateralType);
  const liquidationFactor = market.assetEmodeParams(obligation.getEmodeGroupId(), collateralType).liquidationFactor;
  const amount = Decimal.fromBigInt(obligation.getDeposit(collateralType).amount());
  const decimals = parseCoinDecimals(market.coinDecimal(collateralType));
  const mul = amount.divDecimal(decimals).mul(liquidationFactor);
  return mul.isZero() ? Decimal.zero() : totalBorrow.sub(otherCollateral).divDecimal(mul);
}

/** USD price of `debtType` at which the obligation becomes liquidatable (price rising). */
export function debtLiquidationPrice(
  obligation: Obligation,
  market: Market,
  debtType: TypeName,
): Decimal {
  // At liquidation: maxBorrowValue == otherDebt + borrowWeight * price * amount / decimals
  const maxBorrowValue = liquidationWeightedCollateral(obligation, market);
  const otherDebt = obligation.totalBorrowUsdWeighted(market, new Set([debtType]));
  const borrowWeight = market.assetEmodeParams(obligation.getEmodeGroupId(), debtType).borrowWeight;
  const amount = Decimal.fromBigInt(obligation.getBorrow(debtType, market).amount());
  const decimals = parseCoinDecimals(market.coinDecimal(debtType));
  if (amount.isZero()) return Decimal.zero();
  return maxBorrowValue.sub(otherDebt).mul(decimals).divDecimal(amount).divDecimal(borrowWeight);
}

async function main() {
  if (!OBLIGATION_ID) {
    throw new Error('Set OBLIGATION_ID to the obligation you want to inspect');
  }

  const client = LendingClient.fromConfig({
    network: NETWORK,
    pythEndpoint: 'https://hermes.pyth.network',
  });

  // Build a Market instance for the e-mode group, then load the obligation via lendingClient.
  const marketInfo = getMarket(NETWORK, MARKET_NAME);
  const snapshot = await client.getEmodeGroupMarketSnapshot(marketInfo.type, EMODE_GROUP_ID);
  const market = new Market(marketInfo.type, marketInfo.objectId, snapshot.assets, snapshot.emodeGroups, coinMetadatas);
  const obligation = new Obligation(await client.getObligationDetail(OBLIGATION_ID, market));

  let prices = await client.fetchPythPrices([...obligation.depositAssets(), ...obligation.borrowedAssets()]);

  console.log('=== LIQUIDATION PRICES (USD) ===');

  console.log('\nCollateral — liquidated if price falls to:');
  for (const asset of obligation.depositAssets()) {
    const cur = prices.get(asset);
    console.log(`  ${asset}`);
    console.log(`    current:     ${cur ? cur.asNumber() : 'n/a'}`);
    console.log(`    liquidation: ${collateralLiquidationPrice(obligation, market, asset).asNumber()}`);
  }

  console.log('\nDebt — liquidated if price rises to:');
  for (const asset of obligation.borrowedAssets()) {
    const cur = prices.get(asset);
    console.log(`  ${asset}`);
    console.log(`    current:     ${cur ? cur.asNumber() : 'n/a'}`);
    console.log(`    liquidation: ${debtLiquidationPrice(obligation, market, asset).asNumber()}`);
  }

}

main().catch(console.error);
