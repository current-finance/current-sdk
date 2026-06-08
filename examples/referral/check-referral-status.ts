import {
  LendingClient,
} from '@current-finance/current-sdk';

import { getKeypair } from '../utils';
async function checkReferralStatus(network: 'mainnet' = 'mainnet', userAddress?: string) {
  const net = network;
  const client = LendingClient.fromConfig({ network: net });

  // Get address to check (either provided or from keypair)
  let addressToCheck: string;
  if (userAddress) {
    addressToCheck = userAddress;
  } else {
    const keypair = getKeypair();
    addressToCheck = keypair.getPublicKey().toSuiAddress();
  }

  try {
    console.log('=== CHECKING REFERRAL STATUS ===');
    console.log(`Network: ${network}`);
    console.log(`Address: ${addressToCheck}\n`);

    // Get referral client
    const referralClient = client.getReferralClient();

    // Check if user can generate a referral code
    console.log('1. Checking if user can generate referral code...');
    const canGenerate = await referralClient.canGenerateReferralCode(addressToCheck);
    console.log(`   Can generate referral code: ${canGenerate ? '✅ YES' : '❌ NO'}\n`);

    // Check if user has a referral code
    console.log('2. Checking if user has referral code...');
    const hasCode = await referralClient.hasReferralCode(addressToCheck);
    console.log(`   Has referral code: ${hasCode ? '✅ YES' : '❌ NO'}\n`);

    // Get referral code (if exists)
    if (hasCode) {
      console.log('3. Getting referral code...');
      try {
        const code = await referralClient.getReferralCode(addressToCheck);
        console.log(`   Referral code: ${code}\n`);
      } catch (error) {
        console.log(`   Failed to get referral code: ${error}\n`);
      }
    } else {
      console.log('3. User does not have a referral code yet\n');
    }

    // Get referral rebates
    console.log('4. Getting referral rebates...');
    try {
      const rebates = await referralClient.getReferralRebates(addressToCheck);

      if (rebates.coinTypes.length === 0) {
        console.log('   No rebates available\n');
      } else {
        console.log(`   Total rebate types: ${rebates.coinTypes.length}\n`);
        rebates.coinTypes.forEach((coinType, index) => {
          console.log(`   Rebate ${index + 1}:`);
          console.log(`     Coin Type: ${coinType}`);
          console.log(`     Amount: ${rebates.amounts[index]}\n`);
        });
      }
    } catch (error) {
      console.log(`   Failed to get rebates: ${error}\n`);
    }

    console.log('=== STATUS CHECK COMPLETE ===');
  } catch (error) {
    console.error('❌ Error checking referral status:', error);
    throw error;
  }
}

// Run example
console.log('Checking referral status...\n');
console.log('ℹ️  Important Notes:');
console.log('   - Set PRIVATE_KEY environment variable to check your own address');
console.log('   - Or provide an address as argument to check any address');
console.log('   - You need to complete certain actions to qualify for referral code generation\n');

// You can pass a specific address or it will use the one from PRIVATE_KEY env var
checkReferralStatus('mainnet').catch(console.error);

// Example with specific address:
// checkReferralStatus("mainnet", "0x1234...").catch(console.error);
