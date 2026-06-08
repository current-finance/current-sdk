import {
  LendingClient,
  getMarket,
  getSender,
} from '@current-finance/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';
import { getKeypair } from '../utils';
import { Transaction } from '@mysten/sui/transactions';
const NETWORK = 'mainnet';
const MARKET_NAME = 'MainMarket';
/** Borrow SUI against USDC collateral (deposit scripts use USDC). */
const COIN_SUI =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
/** 0.5 SUI (9 decimals) — keep headroom for gas + protocol limits. */
const AMOUNT_BORROW_SUI = 5_000_000_000n;
const OBLIGATION_OWNER_CAP_ID = ''; // TODO: Replace with your ObligationOwnerCap ID

async function borrow() {
  if (!OBLIGATION_OWNER_CAP_ID.trim()) {
    throw new Error('Set OBLIGATION_OWNER_CAP_ID in this file');
  }

  const client = LendingClient.fromConfig({ network: NETWORK });

  const keypair = getKeypair();
  const sender = keypair.getPublicKey().toSuiAddress();

  const market = getMarket(NETWORK, MARKET_NAME);
  const marketId = market.objectId;
  const marketType = market.type;

  console.log('=== BORROW ASSET ===');
  console.log(`Sender: ${sender}`);
  console.log(`Coin Type: ${COIN_SUI}`);
  console.log(`Borrow Amount (min units): ${AMOUNT_BORROW_SUI}`);

  const tx = new Transaction();

  const allAssets = client.query.getAllAssetsInMarket(marketType);

  await client.populateBorrowTransactionWithAllAssets(
    tx,
    marketId,
    marketType,
    OBLIGATION_OWNER_CAP_ID,
    COIN_SUI,
    allAssets,
    AMOUNT_BORROW_SUI,
    getSender(keypair),
  );

  const result = (await client.provider.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
  })) as SuiClientTypes.TransactionResult;
  const digest =
    result.$kind === 'Transaction'
      ? result.Transaction.digest
      : result.FailedTransaction.digest;

  console.log(result);
  console.log(`\nBorrow transaction: ${digest}`);
}

borrow().catch(console.error);
