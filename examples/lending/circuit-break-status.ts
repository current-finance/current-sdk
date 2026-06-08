import { SuiGrpcClient } from '@mysten/sui/grpc';
import { LendingClient, getMarket } from '@current-finance/current-sdk';

// Query the circuit-break status of markets.
//
// The circuit-break flag is a `bool` stored under a `market::CircuitBreakKey`
// dynamic field on each `Market<T>` object. When `triggered` is true the
// circuit is broken and market actions are halted.
//
// Usage:
//   pnpm --filter @current-finance/examples example:circuit-break-status
async function getCircuitBreakStatusExample(
  network: 'mainnet' = 'mainnet',
  marketName: string = 'MainMarket',
) {
  const suiClient = new SuiGrpcClient({ baseUrl: 'https://fullnode.mainnet.sui.io:443', network: 'mainnet' });

  // Read-only queries need no DEX, so the lightweight `from` constructor is enough.
  const client = LendingClient.from({ network }, suiClient);

  // 1) Single market by object ID.
  const market = getMarket(network, marketName);
  console.log(`Market: ${marketName}`);
  console.log(`Market Object ID: ${market.objectId}`);

  const triggered = await client.query.getCircuitBreakStatus(market.objectId);
  console.log(`Circuit broken: ${triggered ? 'YES (halted)' : 'no'}`);

  // 2) All markets configured on this network.
  console.log('\n--- All markets ---');
  const all = await client.query.getAllCircuitBreakStatus();
  for (const status of all) {
    console.log(`  ${status.name} (${status.marketId}): ${status.triggered ? 'YES (halted)' : 'no'}`);
  }

  return all;
}

getCircuitBreakStatusExample().catch((err) => {
  console.error(err);
  process.exit(1);
});
