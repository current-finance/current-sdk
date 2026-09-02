import { LendingClient } from '@current-protocol/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';
import { getKeypair } from '../utils';
import { Transaction } from '@mysten/sui/transactions';
import { createOracleClient } from './oracle';

const ASSETS_TO_REFRESH = ["0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI", "0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI"];

async function run() {
  const oracleClient = createOracleClient();
  const client = LendingClient.fromConfig({ network: 'mainnet' }, oracleClient);

  const keypair = getKeypair();
  const sender = keypair.getPublicKey().toSuiAddress();
  console.log("sending transaction from", sender);

  const tx = new Transaction();

  await client.refreshOraclePrices(tx, ASSETS_TO_REFRESH);

  const result = (await client.provider.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
  })) as SuiClientTypes.TransactionResult;
  const digest =
    result.$kind === 'Transaction'
      ? result.Transaction.digest
      : result.FailedTransaction.digest;

  console.log(`\Transaction: ${digest}`);
}

if (import.meta.url.startsWith('file:')) {
  run().catch(console.error);
}
