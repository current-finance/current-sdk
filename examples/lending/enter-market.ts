import {
  LendingClient,
  getMarket,
  getSender,
} from '@current-finance/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';

import { getKeypair } from '../utils';
const NETWORK = 'mainnet';
const MARKET_NAME = 'MainMarket';

async function enterMarket() {
  const client = LendingClient.fromConfig({ network: NETWORK });

  const keypair = getKeypair();
  const sender = keypair.getPublicKey().toSuiAddress();

  const market = getMarket(NETWORK, MARKET_NAME);
  const marketId = market.objectId;
  const marketType = market.type;

  console.log('Entering market...');
  console.log(`Market: ${market.name}`);
  console.log(`Market ID: ${marketId}`);
  console.log(`Market Type: ${marketType}`);
  console.log(`Sender: ${sender}`);

  const tx = new Transaction();
  const obligationOwnerCap = client.populateEnterMarketTxn(tx, marketId, marketType);
  tx.transferObjects([obligationOwnerCap as any], getSender(keypair));

  const result = (await client.provider.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
  })) as SuiClientTypes.TransactionResult;
  const digest =
    result.$kind === 'Transaction'
      ? result.Transaction.digest
      : result.FailedTransaction.digest;

  console.log(`\nEnter market transaction: ${digest}`);
  return digest;
}

enterMarket().catch(console.error);
