import { LendingClient } from '@current-finance/current-sdk';
import { SuiGrpcClient } from '@mysten/sui/grpc';

function createExampleSuiGrpcClient(_network: 'mainnet' = 'mainnet') {
  const baseUrl = 'https://fullnode.mainnet.sui.io:443';
  return new SuiGrpcClient({ baseUrl, network: 'mainnet' });
}
/** Edit these to try the lookup locally. */
const NETWORK = 'mainnet';
const REFERRAL_CODE = ''; // TODO: Replace with your referral code

async function lookupReferrerByCode(network: 'mainnet', referralCode: string) {
  const client = LendingClient.from({ network }, createExampleSuiGrpcClient(network));

  return client.getReferralClient().getReferrerAddressForReferralCode(referralCode);
}

lookupReferrerByCode(NETWORK, REFERRAL_CODE)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
