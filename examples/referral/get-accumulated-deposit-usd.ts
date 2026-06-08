import { LendingClient } from '@current-finance/current-sdk';
import { SuiGrpcClient } from '@mysten/sui/grpc';

function createExampleSuiGrpcClient(_network: 'mainnet' = 'mainnet') {
  const baseUrl = 'https://fullnode.mainnet.sui.io:443';
  return new SuiGrpcClient({ baseUrl, network: 'mainnet' });
}
// Replace with the address you want to check
const ADDRESS_TO_CHECK = ''; // Your address here

async function main() {
  const network = 'mainnet';
  const client = LendingClient.from({ network }, createExampleSuiGrpcClient(network));

  try {
    console.log('=== GETTING ACCUMULATED DEPOSIT USD ===');
    console.log(`Network: ${network}`);
    console.log(`Address: ${ADDRESS_TO_CHECK}\n`);

    // Get referral client
    const referralClient = client.getReferralClient();

    console.log('Fetching accumulated deposit USD...');
    const accumulatedUsd = await referralClient.getAccumulatedDepositUsd(ADDRESS_TO_CHECK);
    
    // The accumulated_deposit_only_usd has 0 decimals
    const formattedUsd = Number(accumulatedUsd);
    
    console.log(`Accumulated Deposit: $${formattedUsd.toLocaleString()} USD (Raw: ${accumulatedUsd})\n`);

    console.log('=== COMPLETE ===');
  } catch (error) {
    console.error('Error getting accumulated deposit USD:', error);
  }
}

main();
