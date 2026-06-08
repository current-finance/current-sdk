import { Transaction } from '@mysten/sui/transactions';
import {
  LendingClient,
} from '@current-finance/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';

import { getKeypair } from '../utils';
async function claimRebates(coinType: string, network: 'mainnet' = 'mainnet') {
  const net = network;
  const client = LendingClient.fromConfig({ network: net });

  // Get keypair from environment variable
  const keypair = getKeypair();
  const sender = keypair.getPublicKey().toSuiAddress();

  try {
    console.log('=== CLAIMING REFERRAL REBATES ===');
    console.log(`Network: ${network}`);
    console.log(`Sender: ${sender}`);
    console.log(`Coin Type: ${coinType}\n`);

    // Get referral client
    const referralClient = client.getReferralClient();

    // Check available rebates
    console.log('1. Checking available rebates...');
    const rebates = await referralClient.getReferralRebates(sender);

    if (rebates.coinTypes.length === 0) {
      console.log('   ❌ No rebates available to claim\n');
      return;
    }

    // Find the rebate for the specified coin type
    const rebateIndex = rebates.coinTypes.findIndex(ct => ct === coinType);

    if (rebateIndex === -1) {
      console.log(`   ❌ No rebates available for coin type: ${coinType}`);
      console.log('   Available rebates:');
      rebates.coinTypes.forEach((ct, idx) => {
        console.log(`     - ${ct}: ${rebates.amounts[idx]}`);
      });
      console.log();
      return;
    }

    const rebateAmount = rebates.amounts[rebateIndex];
    console.log(`   ✅ Found rebate: ${rebateAmount}`);
    console.log(`   Coin Type: ${coinType}\n`);

    if (rebateAmount === 0n) {
      console.log('   ⚠️  Rebate amount is 0, nothing to claim\n');
      return;
    }

    // Claim rebates
    console.log('2. Claiming rebates...');
    const tx = new Transaction();

    // Populate transaction to claim rebates for the specific coin type
    referralClient.populateClaimReferralRebates(tx, coinType);

    // Execute transaction
    const result = (await client.provider.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
    })) as SuiClientTypes.TransactionResult;
    const digest =
      result.$kind === 'Transaction'
        ? result.Transaction.digest
        : result.FailedTransaction.digest;

    console.log('   ✅ Transaction successful!');
    console.log(`   Transaction digest: ${digest}`);
    console.log(`   Claimed amount: ${rebateAmount}\n`);

    // Check remaining rebates
    console.log('3. Checking remaining rebates...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const remainingRebates = await referralClient.getReferralRebates(sender);

    if (remainingRebates.coinTypes.length === 0) {
      console.log('   ✅ All rebates claimed!\n');
    } else {
      console.log(`   Remaining rebates: ${remainingRebates.coinTypes.length}`);
      remainingRebates.coinTypes.forEach((ct, idx) => {
        console.log(`     - ${ct}: ${remainingRebates.amounts[idx]}`);
      });
      console.log();
    }

    console.log('=== REBATES CLAIMED SUCCESSFULLY ===');

  } catch (error) {
    console.error('❌ Error claiming rebates:', error);
    throw error;
  }
}

// Run example
console.log('Claiming referral rebates...\n');
console.log('ℹ️  Important Notes:');
console.log('   - Set PRIVATE_KEY environment variable');
console.log('   - Rebates are earned when people use your referral code');
console.log('   - You must specify which coin type to claim');
console.log('   - Claimed coins are automatically transferred to your address\n');

// Example: Claim SUI rebates on mainnet
const coinType = '0x2::sui::SUI';
claimRebates(coinType, 'mainnet').catch(console.error);

// Example: Claim USDC rebates
// const usdcType = '0x...::usdc::USDC';
// claimRebates(usdcType, "mainnet").catch(console.error);
