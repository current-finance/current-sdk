import {
  getMarket,
  LendingClient,
} from '@current-protocol/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';

import { getKeypair } from '../utils';
import { Transaction } from '@mysten/sui/transactions';
import { createOracleClient } from './oracle';

const MARKET_NAME = 'MainMarket';
const COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const AMOUNT = 5_000_000n;
const OBLIGATION_OWNER_CAP_ID = process.env.OBLIGATION_OWNER_CAP!;

async function deposit() {
  if (!OBLIGATION_OWNER_CAP_ID.trim()) {
    throw new Error('Set OBLIGATION_OWNER_CAP_ID in this file after enter-and-deposit.');
  }

  const oracleClient = createOracleClient();
  const client = LendingClient.fromConfig({ network: 'mainnet' }, oracleClient);

  const keypair = getKeypair();
  const sender = keypair.getPublicKey().toSuiAddress();

  const market = getMarket('mainnet', MARKET_NAME);
  const marketId = market.objectId;
  const marketType = market.type;

  console.log(`Sender: ${sender}`);
  console.log(`Using obligation owner cap: ${OBLIGATION_OWNER_CAP_ID}`);

  const tx = new Transaction();

  const coinObjectId = tx.coin({ type: COIN_TYPE, balance: AMOUNT});
  await client.populatedDepositTxn(tx, marketId, marketType, OBLIGATION_OWNER_CAP_ID, COIN_TYPE, coinObjectId);

  const result = (await client.provider.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
  })) as SuiClientTypes.TransactionResult;
  const digest =
    result.$kind === 'Transaction'
      ? result.Transaction.digest
      : result.FailedTransaction.digest;

  console.log(result);
  console.log(`\nDeposit transaction: ${digest}`);
}

if (import.meta.url.startsWith('file:')) {
  deposit().catch(console.error);
}