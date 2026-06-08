import 'dotenv/config';
import { Transaction } from '@mysten/sui/transactions';
import {
  LendingClient,
  RewardType,
  getMarket,
  getSender,
} from '@current-finance/current-sdk';
import type { SuiClientTypes } from '@mysten/sui/client';

import { getKeypair } from '../utils';
type Network = 'mainnet';

interface LiquidityMiningOptions {
  network?: Network;
  marketName?: string;
  coinType?: string;
  depositAmount?: bigint;
  quoteBaseUrl?: string;
  skipClaim?: boolean;
  rewardType?: RewardType;
  rewardCoinType?: string;
}

export async function runLiquidityMiningExample({
  network = 'mainnet',
  marketName = 'MainMarket',
  coinType = '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  skipClaim = false,
  rewardType: rewardTypeFilter,
  rewardCoinType: rewardCoinFilter,
}: LiquidityMiningOptions = {}) {
  const client = LendingClient.fromConfig({ network });

  const keypair = getKeypair();
  const sender = getSender(keypair);

  console.log(`Network: ${network}`);
  console.log(`Market: ${marketName}`);
  console.log(`Coin type (reserve): ${coinType}`);
  if (rewardTypeFilter !== undefined) {
    console.log(`Reward type filter: ${RewardType[rewardTypeFilter]}`);
  }
  if (rewardCoinFilter) {
    console.log(`Reward coin filter: ${rewardCoinFilter}`);
  }
  if (skipClaim) {
    console.log('LM_SKIP_CLAIM=true → skip claiming, query only.');
  }

  const market = getMarket(network, marketName);
  console.log(`Market object ID: ${market.objectId}`);
  const obligationOwnerCapId = process.env.OBLIGATION_OWNER_CAP_ID;
  if (!obligationOwnerCapId) {
    throw new Error('OBLIGATION_OWNER_CAP_ID environment variable is required');
  }
  const obligationId = await client.query.getObligationIdFromOwnerCapId(obligationOwnerCapId);
  console.log(`obligation id: ${obligationId}`);

  const liquidityMiningClient = client.getLiquidityMiningClient();

  const batchResult = await liquidityMiningClient.getClaimableRewardsBatch({
    marketObjectId: market.objectId,
    obligationId,
    coinTypes: [coinType],
  });
  const claimable = batchResult[coinType];
  console.log('batch claimable result:', batchResult);

  if (skipClaim) {
    return;
  }

  const rewardIndices = liquidityMiningClient.convertClaimableRewardsToRewardIndices(claimable);

  const tx = new Transaction();
  liquidityMiningClient.populateClaimRewardAutoTransaction(
    tx,
    {
      marketObjectId: market.objectId,
      marketType: market.type,
      obligationOwnerCapId,
      coinType,
      recipient: sender,
      rewardType: rewardTypeFilter,
      rewardCoinType: rewardCoinFilter,
    },
    rewardIndices,
  );

  if (tx.getData().commands.length === 0) {
    console.log('No claimable liquidity mining rewards at the moment.');
    return;
  }

  const claimResult = (await client.provider.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
  })) as SuiClientTypes.TransactionResult;

  const digest =
    claimResult.$kind === 'Transaction'
      ? claimResult.Transaction.digest
      : claimResult.FailedTransaction.digest;
  console.log(`Claim tx digest: ${digest}`);
}

runLiquidityMiningExample().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
