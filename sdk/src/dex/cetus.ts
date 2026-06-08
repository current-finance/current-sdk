import BN from 'bn.js';
import { AggregatorClient, RouterDataV3 } from '@cetusprotocol/aggregator-sdk';
import { Transaction } from '@mysten/sui/transactions';
import { LeverageError, TypeName } from '..';
import { DexPoolInfo, SwapIn, SwapInOutput } from '.';
import { normalizeCoinType } from '../utils/transaction-utils';

/**
 * Hardcoded Cetus pool configurations for liquidation.
 * Key format: "coinTypeA-coinTypeB" (sorted, normalized without 0x prefix)
 */
export const CETUS_POOLS: Record<string, DexPoolInfo> = {
  'aafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC-dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': {
    poolId: '0xa72776082624b0f5da55e385107fc0176114bfea5b281b880acae505a9bd1f1a',
    leftType: 'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    rightType: 'aafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC',
  },
  '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI-dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': {
    poolId: '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105',
    leftType: 'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    rightType: '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  'd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH-dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': {
    poolId: '0x9e59de50d9e5979fc03ac5bcacdb581c823dbd27d63a036131e17b391f2fac88',
    leftType: 'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    rightType: 'd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH',
  },
  'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC-deeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP': {
    poolId: '0xa2f4e24dc234cf024bae1bd5b1275ab5bdc7c28dd1ec84dd98c2d012bbd315f0',
    leftType: 'deeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    rightType: 'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  },
  '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI-aafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC': {
    poolId: '0xe9053840c6b58ac21e045d1bb266ce892f96c9aec6c3761840c9704bd5c51764',
    leftType: 'aafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC',
    rightType: '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI-356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL': {
    poolId: '0x72f5c6eef73d77de271886219a2543e7c29a33de19a6c69c5cf1899f729c3f17',
    leftType: '356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
    rightType: '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  '356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL-dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': {
    poolId: '0x4f665396e49a6a9f233580eed6dfdeff9b5e1054094f27dbb2bd568bdc4e75d5',
    leftType: 'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    rightType: '356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
  },
  '356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL-deeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP': {
    poolId: '0xba201202145373c9da4a9f1c8c10eff1e8f7aebeb9d668500726c462c49d6c0b',
    leftType: 'deeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    rightType: '356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
  },
  '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI-bde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI': {
    poolId: '0x871d8a227114f375170f149f7e9d45be822dd003eba225e83c05ac80828596bc',
    leftType: 'bde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    rightType: '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
};

export function createPoolKey(coinTypeA: TypeName, coinTypeB: TypeName): string {
  const a = normalizeCoinType(coinTypeA);
  const b = normalizeCoinType(coinTypeB);
  const sorted = [a, b].sort();
  return `${sorted[0]}-${sorted[1]}`;
}

/**
 * Gets the Cetus pool info for a coin pair.
 */
export function getCetusPoolInfo(coinTypeA: TypeName, coinTypeB: TypeName): DexPoolInfo | null {
  const key = createPoolKey(coinTypeA, coinTypeB);
  return CETUS_POOLS[key] || null;
}

export class CetusAggregator {
  private aggregator: AggregatorClient;

  constructor(aggregator: AggregatorClient) {
    this.aggregator = aggregator;
  }

  public static newInstance(): CetusAggregator {
    return new CetusAggregator(new AggregatorClient({}));
  }

  public async populateSwapIn(tx: Transaction, params: SwapIn): Promise<SwapInOutput> {
    const router = await this.findSwapInRouter(params.inCoinType, params.outCoinType, params.amountIn);

    const routerAmountOut = BigInt(router.amountOut.toString());
    if (routerAmountOut < params.minOutAmount) {
      throw new Error(`Cetus router slippage exceeded, min receive amount ${params.minOutAmount}, actual quote ${routerAmountOut}`);
    }

    this.aggregator.signer = params.sender;
        
    const targetCoin = await this.aggregator.routerSwap({
      router,
      txb: tx,
      inputCoin: (typeof params.coinId === 'string' ? tx.object(params.coinId) : params.coinId) as any,
      slippage: params.slippage,
    });
        
    this.aggregator.signer = '';
        
    return { coin: targetCoin };
  }

  private async findSwapInRouter(inCoinType: TypeName, outCoinType: TypeName, amountIn: bigint): Promise<RouterDataV3> {
    const router = await this.aggregator.findRouters({
      from: inCoinType,
      target: outCoinType,
      amount: new BN(amountIn.toString()),
      byAmountIn: true, // true means fix input amount, false means fix output amount
      depth: 3,
    });

    if (router === null) {
      throw new LeverageError('Cetus does not have router');
    }

    return router;
  }
}