import {
  LendingClient,
  getMarket,
  getSender,
} from '@current-protocol/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { getKeypair } from '../utils';
import { createOracleClient } from './oracle';

const MARKET_NAME = 'MainMarket';
const COIN_USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const AMOUNT_ENTER_AND_DEPOSIT_USDC = 1_000_000n;

async function enterAndDeposit() {
  const oracleClient = createOracleClient();
  const client = LendingClient.fromConfig({ network: 'mainnet' }, oracleClient);

  const keypair = getKeypair();
  const sender = keypair.getPublicKey().toSuiAddress();

  const market = getMarket('mainnet', MARKET_NAME);
  const marketId = market.objectId;
  const marketType = market.type;

  console.log(`Sender: ${sender}`);
  console.log(`Enter market + deposit ${AMOUNT_ENTER_AND_DEPOSIT_USDC} (min units) of ${COIN_USDC}`);

  const tx = new Transaction();

  const coinObjectId = tx.coin( { type: COIN_USDC, balance: AMOUNT_ENTER_AND_DEPOSIT_USDC });
  client.populateEnterMarketAndDepositTxn(tx, marketId, marketType, COIN_USDC, coinObjectId, getSender(keypair));

  const result = (await client.provider.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
  })) as SuiClientTypes.TransactionResult;
  const digest =
    result.$kind === 'Transaction'
      ? result.Transaction.digest
      : result.FailedTransaction.digest;

  console.log(result);
  console.log(`\nEnter + deposit tx: ${digest}`);
  console.log('\nNext: set OBLIGATION_OWNER_CAP_ID in deposit.ts, borrow.ts, repay.ts, withdraw.ts.');
}

if (import.meta.url.startsWith('file:')) {
  enterAndDeposit().catch(console.error);
}
