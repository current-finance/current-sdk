import {
  coinMetadatas,
  getMarket,
  Market,
  Obligation,
  LendingClient,
} from '@current-protocol/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';

import { getKeypair } from '../utils';
import { Transaction } from '@mysten/sui/transactions';
import { createOracleClient } from './oracle';

const MARKET_NAME = 'MainMarket';
const COIN_USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const AMOUNT_WITHDRAW_USDC = 15_000_000n;
const OBLIGATION_OWNER_CAP_ID = process.env.OBLIGATION_OWNER_CAP!;

async function withdraw() {
  if (!OBLIGATION_OWNER_CAP_ID.trim()) {
    throw new Error('Set OBLIGATION_OWNER_CAP_ID in this file');
  }

  const oracleClient = createOracleClient();
  const client = LendingClient.fromConfig({ network: 'mainnet' }, oracleClient);

  const keypair = getKeypair();
  const sender = keypair.getPublicKey().toSuiAddress();

  console.log('=== WITHDRAW ASSET ===');
  console.log(`Sender: ${sender}`);
  console.log(`Coin Type: ${COIN_USDC}`);
  console.log(`Withdraw amount (underlying min units): ${AMOUNT_WITHDRAW_USDC}`);

  const obligationId = await client.query.getObligationIdFromOwnerCapId(OBLIGATION_OWNER_CAP_ID);

  const marketInfo = getMarket('mainnet', MARKET_NAME);
  const emode = 0;

  const market = await client.getEmodeGroupMarketSnapshot(
    marketInfo.type,
    emode,
    [
      // price not important
      { assetType: "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI", price: 0 },
      { assetType: "dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC", price: 0 },
    ]
  );
  const details = await client.getObligationDetail(obligationId, new Market(marketInfo.type, marketInfo.objectId, market.assets, market.emodeGroups, coinMetadatas));
  const obligation = new Obligation(details);

  const deposit = obligation.getDeposit(COIN_USDC);

  let ctokenAmount;
  if (AMOUNT_WITHDRAW_USDC >= deposit.amount()) {
    ctokenAmount = deposit.ctokenAmount();
  } else {
    ctokenAmount = (deposit.ctokenAmount() * AMOUNT_WITHDRAW_USDC) / deposit.amount();
  }

  const assets = new Set([...obligation.depositAssets(), ...obligation.borrowedAssets()]);

  const tx = new Transaction();
  await client.populateWithdrawTransactionWithAssets(
    tx,
    marketInfo.objectId,
    marketInfo.type,
    OBLIGATION_OWNER_CAP_ID,
    COIN_USDC,
    [...assets],
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

if (import.meta.url.startsWith('file:')) {
  withdraw().catch(console.error);
}
