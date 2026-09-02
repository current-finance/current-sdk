import { LendingClient, getMarket, getSender } from '@current-protocol/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';
import { getKeypair } from '../utils';
import { Transaction } from '@mysten/sui/transactions';
import { createOracleClient } from './oracle';

const MARKET_NAME = 'MainMarket';
const COIN_SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const AMOUNT_BORROW_SUI = 8_000_000_000n;
const OBLIGATION_OWNER_CAP_ID = process.env.OBLIGATION_OWNER_CAP!;

async function borrow() {
  if (!OBLIGATION_OWNER_CAP_ID.trim()) {
    throw new Error('Set OBLIGATION_OWNER_CAP_ID in this file');
  }

  const oracleClient = createOracleClient();
  const client = LendingClient.fromConfig({ network: 'mainnet' }, oracleClient);

  const keypair = getKeypair();
  const sender = keypair.getPublicKey().toSuiAddress();

  const market = getMarket('mainnet', MARKET_NAME);
  const marketId = market.objectId;
  const marketType = market.type;

  console.log('=== BORROW ASSET ===');
  console.log(`Sender: ${sender}`);
  console.log(`Coin Type: ${COIN_SUI}`);
  console.log(`Borrow Amount (min units): ${AMOUNT_BORROW_SUI}`);

  const tx = new Transaction();

  await client.populateBorrowTransactionWithAllAssets(
    tx,
    marketId,
    marketType,
    OBLIGATION_OWNER_CAP_ID,
    COIN_SUI,
    ["0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI", "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"],
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

if (import.meta.url.startsWith('file:')) {
  borrow().catch(console.error);
}
