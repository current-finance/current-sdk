import { LendingClient } from '@current-finance/current-sdk';
import { SuiGrpcClient } from '@mysten/sui/grpc';

function createExampleSuiGrpcClient(_network: 'mainnet' = 'mainnet') {
  const baseUrl = 'https://fullnode.mainnet.sui.io:443';
  return new SuiGrpcClient({ baseUrl, network: 'mainnet' });
}
const ADDRESS_TO_CHECK = ''; // Replace with the address you want to check
const NETWORK = 'mainnet';

async function getLinkedReferralCode(network: 'mainnet', address: string) {
  const client = LendingClient.from({ network }, createExampleSuiGrpcClient(network));

  const referralClient = client.getReferralClient();
  return referralClient.getLinkedReferralCode(address);
}

console.log(`Checking linked referral code for address: ${ADDRESS_TO_CHECK} on ${NETWORK}...`);
getLinkedReferralCode(NETWORK, ADDRESS_TO_CHECK)
  .then((result) => {
    if (result) {
      console.log(` The address is linked to referral code: ${result}`);
    } else {
      console.log(' The address is NOT linked to any referral code.');
    }
  })
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
