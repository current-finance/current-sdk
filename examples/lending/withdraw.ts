import {
  coinMetadatas,
  getMarket,
  Market,
  Obligation,
  LendingClient,
} from '@current-finance/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';

import { getKeypair } from '../utils';
import { Transaction } from '@mysten/sui/transactions';
const NETWORK = 'mainnet';
const MARKET_NAME = 'MainMarket';
const COIN_USDC =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const AMOUNT_WITHDRAW_USDC = 5_000_000n;
const OBLIGATION_OWNER_CAP_ID = ''; // TODO: Replace with your ObligationOwnerCap ID

async function withdraw() {
  if (!OBLIGATION_OWNER_CAP_ID.trim()) {
    throw new Error('Set OBLIGATION_OWNER_CAP_ID in this file');
  }

  const client = LendingClient.fromConfig(
    { network: NETWORK, pythEndpoint: 'https://hermes.pyth.network' },
  );

  const keypair = getKeypair();
  const sender = keypair.getPublicKey().toSuiAddress();

  console.log('=== WITHDRAW ASSET ===');
  console.log(`Sender: ${sender}`);
  console.log(`Coin Type: ${COIN_USDC}`);
  console.log(`Withdraw amount (underlying min units): ${AMOUNT_WITHDRAW_USDC}`);

  const obligationId = await client.query.getObligationIdFromOwnerCapId(OBLIGATION_OWNER_CAP_ID);

  const marketInfo = getMarket(NETWORK, MARKET_NAME);
  const emode = 0;

  const market = await client.getEmodeGroupMarketSnapshot(marketInfo.type, emode);
  const details = await client.getObligationDetail(obligationId, new Market(marketInfo.type, marketInfo.objectId, market.assets, market.emodeGroups, coinMetadatas));
  const obligation = new Obligation(details);

  const deposit = obligation.getDeposit(COIN_USDC);

  let ctokenAmount;
  if (AMOUNT_WITHDRAW_USDC >= deposit.amount()) {
    ctokenAmount = deposit.ctokenAmount();
  } else {
    ctokenAmount = (deposit.ctokenAmount() * AMOUNT_WITHDRAW_USDC) / deposit.amount();
  }

  const tx = new Transaction();
  const allAssets = client.query.getAllAssetsInMarket(marketInfo.type);
  await client.populateWithdrawTransactionWithAssets(
    tx,
    marketInfo.objectId,
    marketInfo.type,
    OBLIGATION_OWNER_CAP_ID,
    COIN_USDC,
    allAssets,
    ctokenAmount,
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
  console.log(`\nWithdraw transaction: ${digest}`);
}

withdraw().catch(console.error);
