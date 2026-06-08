import { Transaction } from '@mysten/sui/transactions';
import {
  LendingClient,
} from '@current-finance/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';

import { getKeypair } from '../utils';
async function generateReferralCode(network: 'mainnet' = 'mainnet') {
  const net = network;
  const client = LendingClient.fromConfig({ network: net });

  // Get keypair from environment variable
  const keypair = getKeypair();
  const sender = keypair.getPublicKey().toSuiAddress();

  try {
    console.log('=== GENERATING REFERRAL CODE ===');
    console.log(`Network: ${network}`);
    console.log(`Sender: ${sender}\n`);

    // Get referral client
    const referralClient = client.getReferralClient();

    // First check if user can generate a referral code
    console.log('1. Checking eligibility...');
    const canGenerate = await referralClient.canGenerateReferralCode(sender);

    if (!canGenerate) {
      console.log('   ❌ You are not eligible to generate a referral code yet');
      console.log('   Complete required actions in the protocol to become eligible\n');
      return;
    }
    console.log('   ✅ Eligible to generate referral code\n');

    // Check if user already has a referral code
    console.log('2. Checking existing code...');
    const hasCode = await referralClient.hasReferralCode(sender);

    if (hasCode) {
      const existingCode = await referralClient.getReferralCode(sender);
      console.log(`   ⚠️  You already have a referral code: ${existingCode}\n`);
      return;
    }
    console.log('   ✅ No existing code found\n');

    // Generate referral code
    console.log('3. Generating referral code...');
    const tx = new Transaction();

    // Populate transaction to generate referral code
    referralClient.populateGenerateReferralCode(tx);

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
    console.log(`   Transaction digest: ${digest}\n`);

    // Wait a moment for the transaction to be processed
    console.log('4. Fetching generated code...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const newCode = await referralClient.getReferralCode(sender);
    console.log(`   🎉 Your referral code: ${newCode}\n`);

    console.log('=== REFERRAL CODE GENERATED SUCCESSFULLY ===');

  } catch (error) {
    console.error('❌ Error generating referral code:', error);
    throw error;
  }
}

// Run example
console.log('Generating referral code...\n');
console.log('ℹ️  Important Notes:');
console.log('   - Set PRIVATE_KEY environment variable');
console.log('   - You must be eligible (completed required protocol actions)');
console.log('   - Each address can only generate one referral code');
console.log('   - The code is randomly generated and unique\n');

generateReferralCode('mainnet').catch(console.error);
