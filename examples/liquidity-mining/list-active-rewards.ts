import 'dotenv/config';
import {
  LendingClient,
  RewardType,
  ActiveRewardSchedule,
  getMarket,
  Decimal,
} from '@current-finance/current-sdk';
import { SuiGrpcClient } from '@mysten/sui/grpc';

function createExampleSuiGrpcClient(_network: 'mainnet' = 'mainnet') {
  const baseUrl = 'https://fullnode.mainnet.sui.io:443';
  return new SuiGrpcClient({ baseUrl, network: 'mainnet' });
}

type Network = 'mainnet';

type ActiveRewardScheduleWithApr = ActiveRewardSchedule & { apr?: number };

/**
 * Fields: rewardCoinType, startTimeMs, endTimeMs, totalRewards, allocatedRewards,
 * cumulativeRewardsPerShare, apr. Use --verbose or -v for full JSON.
 */
interface ListActiveRewardsOptions {
  network?: Network;
  marketName?: string;
  priceMap?: Record<string, Decimal>;
  verbose?: boolean;
}

export async function listActiveRewards({
  network = 'mainnet',
  marketName = 'MainMarket',
  priceMap,
  verbose = false,
}: ListActiveRewardsOptions = {}) {
  console.log('\n=== Active Liquidity Mining Rewards ===\n');
  console.log(`Network: ${network}`);
  console.log(`Market: ${marketName}\n`);

  const client = LendingClient.from({ network }, createExampleSuiGrpcClient(network));

  const market = getMarket(network, marketName);

  // Fake priceMap for demonstration
  // Format: coinType -> Decimal price
  // Note: All prices should use the same decimals format for consistency
  const fakePriceMap: Record<string, Decimal> = priceMap || {
    '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': Decimal.fromString('1.47'),
    'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': Decimal.fromString('1.00'),
    'aafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC': Decimal.fromString('86442.00'),
    'd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH': Decimal.fromString('3500.00'),
    '375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT': Decimal.fromString('1.00'),
    '44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI': Decimal.fromString('1.47'),
    'bde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI': Decimal.fromString('1.47'),
    '3a304c7feba2d819ea57c3542d68439ca2c386ba02159c740f7b406e592c62ea::haedal::HAEDAL': Decimal.fromString('1.00'),
  };

  const summaries = await client.getLiquidityMiningClient().getActiveRewardsSummary(
    market.objectId,
    market.type,
    fakePriceMap,
  );

  if (summaries.length === 0) {
    console.log('No active liquidity mining rewards.');
    return;
  }



  console.log('Active liquidity mining rewards:');
  for (const summary of summaries) {
    console.log(`- Pool type: ${RewardType[summary.rewardType]} | Reserve: ${summary.reserveCoinType}`);
    
    for (const reward of summary.rewards as ActiveRewardScheduleWithApr[]) {
      const start = new Date(reward.startTimeMs).toISOString();
      const end = new Date(reward.endTimeMs).toISOString();
      console.log(`  • Reward coin      : ${reward.rewardCoinType}`);
      console.log(`    Start → End      : ${start} → ${end}`);
      console.log(`    Total rewards    : ${reward.totalRewards}`);
      console.log(`    Allocated rewards: ${reward.allocatedRewards}`);
      console.log(`    Cum per share    : ${reward.cumulativeRewardsPerShare}`);
      const aprPercent = reward.apr !== undefined ? (reward.apr * 100).toFixed(4) : 'N/A';
      console.log(`    APR (annualized) : ${aprPercent}%`);
    }
  }

  if (verbose) {
    console.log('\n--- Full JSON output ---\n');
    console.log(
      JSON.stringify(
        summaries,
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      ),
    );
  }
}

const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
listActiveRewards({ verbose }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});