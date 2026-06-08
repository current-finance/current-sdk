import {
  getMarket,
  LendingClient,
} from '@current-finance/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { getKeypair } from '../utils';

const NETWORK = 'mainnet';
const MARKET_NAME = 'MainMarket';
const COIN_USDC =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const AMOUNT_DEPOSIT_USDC = 10_000_000n;
const OBLIGATION_OWNER_CAP_ID = ''; // TODO: Replace with your ObligationOwnerCap ID

async function deposit() {
  const client = LendingClient.fromConfig({ network: NETWORK });

  const keypair = getKeypair();

  const sender = "0x6985ce87bf8c236e34afb5c793251b8371b06d34c12028bcb05604ae859d4149";
  const market = getMarket(NETWORK, MARKET_NAME);
  const marketId = market.objectId;
  const marketType = market.type;

  console.log(`Sender: ${sender}`);
  console.log(`Using obligation owner cap: ${OBLIGATION_OWNER_CAP_ID}`);

  const tx = new Transaction();

  const coinObjectId = tx.coin({ type: COIN_USDC, balance: AMOUNT_DEPOSIT_USDC });


  if (!OBLIGATION_OWNER_CAP_ID.trim()) {
    throw new Error('Set OBLIGATION_OWNER_CAP_ID in this file after enter-and-deposit.');
  }

  await client.populatedDepositTxn(tx, marketId, marketType, OBLIGATION_OWNER_CAP_ID, COIN_USDC, coinObjectId);

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

deposit().catch(console.error);
