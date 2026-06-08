import {
  getMarket,
  LendingClient,
} from '@current-finance/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';

import { getKeypair } from '../utils';
import { Transaction } from '@mysten/sui/transactions';
const NETWORK = 'mainnet';
const MARKET_NAME = 'MainMarket';
/** Repay the SUI debt from `borrow.ts` (same min units). */
const COIN_SUI =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const AMOUNT_REPAY_SUI = 5_100_000_000n;
const OBLIGATION_OWNER_CAP_ID = ''; // TODO: Replace with your ObligationOwnerCap ID

async function repay() {
  if (!OBLIGATION_OWNER_CAP_ID.trim()) {
    throw new Error('Set OBLIGATION_OWNER_CAP_ID in this file');
  }

  const client = LendingClient.fromConfig({ network: NETWORK });

  const keypair = getKeypair();
  const sender = keypair.getPublicKey().toSuiAddress();

  const market = getMarket(NETWORK, MARKET_NAME);
  const marketId = market.objectId;
  const marketType = market.type;

  console.log(`Sender: ${sender}`);
  console.log(`Using obligation owner cap: ${OBLIGATION_OWNER_CAP_ID}`);

  const tx = new Transaction();

  const coinObjectId = tx.coin({ type: COIN_SUI, balance: AMOUNT_REPAY_SUI });
  client.populateRepayTxn(tx, marketId, marketType, OBLIGATION_OWNER_CAP_ID, COIN_SUI, coinObjectId);

  const result = (await client.provider.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
  })) as SuiClientTypes.TransactionResult;
  const digest =
    result.$kind === 'Transaction'
      ? result.Transaction.digest
      : result.FailedTransaction.digest;

  console.log(result);
  console.log(`\nRepay transaction: ${digest}`);
}

repay().catch(console.error);
