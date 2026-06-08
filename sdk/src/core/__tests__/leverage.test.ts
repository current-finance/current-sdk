import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import {
  Decimal,
  IncreaseOperationType,
  LendingClient,
  LeverageMarketClient,
  LeverageObligation,
  QuoteClient,
  RewardType,
  TokenExchange,
} from '../../index.js';
import type { LeverageIncreaseParams, ReduceOperationParams } from '../quote';
import type { Market } from '../../market-types';

// Test fixtures
const NETWORK = 'mainnet';
const RECIPIENT = '0x' + 'aa'.repeat(32);
const OWNER_CAP = '0x' + 'bb'.repeat(32);
const PRICE_INFO_OBJECT = '0x' + 'cc'.repeat(32);
const COIN_OBJECT = '0x' + 'dd'.repeat(32);

const SUI =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

// Expected mainnet addresses — hardcoded so assertions don't degenerate
// into tautologies against `client.config`. Tampering on `networks.ts`
// makes the PTB's package field diverge and the test fails loudly.
//
// LEVERAGE_MARKET_INDEX = 0 references the first entry in
// `leverageMarkets[]`, which on mainnet is MainMarket / emodeId=1.
const LEVERAGE_MARKET_INDEX = 0;
const MAINNET = {
  protocolPackageId:
    '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf',
  xOraclePackageId:
    '0x144c57d6014488bc71c0902bddff482af090d13e2c61333ed903fe088220a92c',
  leveragePackageId:
    '0x042a1a418bf977d5306aa783288eebbc2e3ca9200b533fba7feda521e60d199e',
  mainMarketObjectId:
    '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
  mainMarketType:
    '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
  leverageMarketObjectId_index0:
    '0x24e0c2e1ede9d285f0e2ea9124fb47b14a04f3b14eb29d7c51bdbbb6c321a980',
} as const;

/**
 * Build a LendingClient with the Pyth network calls stubbed out. Leverage's
 * `refreshLeveragePrice` delegates to `lendingClient.refreshPythOracle`,
 * so mocking the LendingClient's pyth surface covers leverage too.
 */
function makeLendingClient(): LendingClient {
  const client = LendingClient.fromConfig({ network: NETWORK });

  type Mut = {
    pythClient: {
      getPriceFeedObjectId: (id: string) => Promise<string>;
      updatePriceFeeds: (tx: unknown, data: unknown, ids: string[]) => Promise<string[]>;
    };
    pythConnnection: {
      getPriceFeedsUpdateData: (ids: string[]) => Promise<Uint8Array[]>;
    };
  };
  const mut = client as unknown as Mut;
  mut.pythClient = {
    getPriceFeedObjectId: async () => PRICE_INFO_OBJECT,
    updatePriceFeeds: async (_tx, _data, ids) => ids.map(() => PRICE_INFO_OBJECT),
  };
  mut.pythConnnection = {
    getPriceFeedsUpdateData: async (ids) => ids.map(() => new Uint8Array()),
  };

  return client;
}

function makeLeverageClient(): LeverageMarketClient {
  const lendingClient = makeLendingClient();
  // QuoteClient + exchange are only exercised by swap paths we're not
  // covering in this suite — stub them out to keep the tests pure.
  const quoteClient = new QuoteClient({ baseUrl: 'http://stub.invalid' });
  const exchange = {} as unknown as ConstructorParameters<typeof LeverageMarketClient>[1];
  return new LeverageMarketClient(quoteClient, exchange, lendingClient, 'MainMarket');
}

/**
 * Minimal LeverageObligation duck-type covering every accessor any of the
 * tested public populate* methods touch. Returns canned values so tests can
 * focus on the PTB shape, not obligation state math.
 */
function fakeLeverageObligation(
  collateral: string,
  borrow: string,
  overrides: { principleType?: string; debtAmount?: bigint } = {},
): LeverageObligation {
  return {
    collateralType: () => collateral,
    borrowType: () => borrow,
    principleType: () => overrides.principleType ?? collateral,
    debtAmount: () => overrides.debtAmount ?? 1_000_000n,
    leverage: () => Decimal.fromNumber(1),
    leveragePosition: {
      info: {
        deposit: collateral,
        borrow,
      },
    },
  } as unknown as LeverageObligation;
}

/**
 * Stub the LeverageMarketClient.exchange (BestMultiTokenExchange) so swap
 * paths can be exercised without quote backends or Cetus aggregator. The
 * stub adds a `coin::zero<outCoinType>()` to the tx and returns that as
 * the swap output — enough to satisfy downstream consumers without an
 * actual swap moveCall.
 */
function stubExchange(leverage: LeverageMarketClient): void {
  type Mut = {
    exchange: {
      populateSwapIn: (
        ex: unknown,
        tx: Transaction,
        params: { outCoinType: string },
      ) => Promise<{ coin: ReturnType<Transaction['moveCall']> }>;
    };
  };
  const mut = leverage as unknown as Mut;
  mut.exchange = {
    populateSwapIn: async (_ex, tx, params) => {
      const coin = tx.moveCall({
        target: '0x2::coin::zero',
        typeArguments: [params.outCoinType],
        arguments: [],
      });
      return { coin };
    },
  };
}

function commandSummary(tx: Transaction) {
  const data = tx.getData();
  return data.commands.map((cmd) => {
    if (cmd.$kind === 'MoveCall') {
      return {
        kind: 'MoveCall',
        package: cmd.MoveCall.package,
        module: cmd.MoveCall.module,
        function: cmd.MoveCall.function,
        typeArguments: cmd.MoveCall.typeArguments,
        argumentCount: cmd.MoveCall.arguments.length,
      };
    }
    if (cmd.$kind === 'TransferObjects') {
      return { kind: 'TransferObjects', objectCount: cmd.TransferObjects.objects.length };
    }
    return { kind: cmd.$kind };
  });
}

function pureInputAsHex(tx: Transaction, index: number): string {
  const data = tx.getData();
  const input = data.inputs[index];
  expect(input?.$kind).toBe('Pure');
  if (input?.$kind !== 'Pure') throw new Error('expected pure input');

  const raw = (input.Pure as { bytes: string }).bytes;
  const decoded = fromBase64(raw);
  return (
    '0x' +
    Array.from(decoded)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

function expectTransferRecipient(tx: Transaction, recipient: string, objectCount = 1): void {
  const data = tx.getData();
  const transferCmds = data.commands.filter((c) => c.$kind === 'TransferObjects');
  expect(transferCmds).toHaveLength(1);

  const transferCmd = transferCmds[0];
  if (transferCmd?.$kind !== 'TransferObjects') throw new Error('expected transferObjects');

  expect(transferCmd.TransferObjects.objects).toHaveLength(objectCount);
  const address = transferCmd.TransferObjects.address;
  expect(address.$kind).toBe('Input');
  if (address.$kind !== 'Input') throw new Error('expected transfer recipient input');

  expect(address.type).toBe('pure');
  expect(pureInputAsHex(tx, address.Input).toLowerCase()).toBe(recipient.toLowerCase());
}

/**
 * For methods that emit MULTIPLE transferObjects commands (e.g. the
 * open-and-increase flow transfers the refund coin AND the owner cap in
 * separate calls), assert that every transferObjects' address resolves to
 * the same caller-supplied recipient. `expectedTransferCount` pins the
 * count so a future refactor that adds/removes a transfer fails loudly.
 */
function expectAllTransfersToRecipient(
  tx: Transaction,
  recipient: string,
  expectedTransferCount: number,
): void {
  const data = tx.getData();
  const transferCmds = data.commands.filter((c) => c.$kind === 'TransferObjects');
  expect(transferCmds).toHaveLength(expectedTransferCount);

  for (const cmd of transferCmds) {
    if (cmd.$kind !== 'TransferObjects') throw new Error('expected transferObjects');
    const address = cmd.TransferObjects.address;
    expect(address.$kind).toBe('Input');
    if (address.$kind !== 'Input') throw new Error('expected transfer recipient input');
    expect(address.type).toBe('pure');
    expect(pureInputAsHex(tx, address.Input).toLowerCase()).toBe(recipient.toLowerCase());
  }
}

describe('LeverageMarketClient PTB shape', () => {
  it('populateClaimLiquidityMiningReward — correct package, module, args', () => {
    const leverage = makeLeverageClient();
    const tx = new Transaction();

    leverage.populateClaimLiquidityMiningReward(
      tx,
      LEVERAGE_MARKET_INDEX,
      tx.object(OWNER_CAP),
      SUI,
      RewardType.Deposit,
      0,
      USDC,
    );

    const data = tx.getData();
    expect(data.commands).toHaveLength(1);
    const cmd = data.commands[0];
    expect(cmd.$kind).toBe('MoveCall');
    if (cmd.$kind !== 'MoveCall') throw new Error('unreachable');

    expect(cmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    expect(cmd.MoveCall.module).toBe('leverage_delegate');
    // Yes, this typo is intentional and matches the on-chain Move function.
    expect(cmd.MoveCall.function).toBe('claim_liquidity_minging_rewards');
    // (leverage_app, app, market, owner_cap, u8 rewardType, u64 rewardIndex, clock)
    expect(cmd.MoveCall.arguments).toHaveLength(7);
    expect(cmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
      USDC,
    ]);

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateDepositTransaction — refresh + deposit, no transfer', async () => {
    const leverage = makeLeverageClient();
    const tx = new Transaction();
    const obligation = fakeLeverageObligation(SUI, USDC);

    await leverage.populateDepositTransaction(
      tx,
      LEVERAGE_MARKET_INDEX,
      OWNER_CAP,
      obligation,
      COIN_OBJECT,
    );

    const data = tx.getData();

    const depositCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_delegate' &&
        c.MoveCall.function === 'deposit',
    );
    expect(depositCmd).toBeDefined();
    if (depositCmd?.$kind !== 'MoveCall') throw new Error('unreachable');

    expect(depositCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    // (app, leverage_app, market, owner_cap, coin, x_oracle, clock)
    expect(depositCmd.MoveCall.arguments).toHaveLength(7);
    expect(depositCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
      USDC,
    ]);

    // refresh_usd_price for both collateral and borrow types.
    const refreshCmds = data.commands.filter(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'user_oracle' &&
        c.MoveCall.function === 'refresh_usd_price',
    );
    expect(refreshCmds).toHaveLength(2);
    for (const cmd of refreshCmds) {
      if (cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(cmd.MoveCall.package).toBe(MAINNET.xOraclePackageId);
    }

    // Leverage deposit has no transferObjects — the obligation cap stays
    // with the caller via the on-chain handler.
    const transferCmd = data.commands.find((c) => c.$kind === 'TransferObjects');
    expect(transferCmd).toBeUndefined();

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateRepayTransaction — refresh + repay + transferObjects(refund, sender)', async () => {
    const leverage = makeLeverageClient();
    const tx = new Transaction();
    const obligation = fakeLeverageObligation(SUI, USDC);

    await leverage.populateRepayTransaction(
      tx,
      LEVERAGE_MARKET_INDEX,
      OWNER_CAP,
      obligation,
      COIN_OBJECT,
      RECIPIENT,
    );

    const data = tx.getData();

    const repayCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_delegate' &&
        c.MoveCall.function === 'repay',
    );
    expect(repayCmd).toBeDefined();
    if (repayCmd?.$kind !== 'MoveCall') throw new Error('unreachable');

    expect(repayCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    // (leverage_app, app, market, owner_cap, coin, x_oracle, clock)
    // NOTE: leverage_app leads, INVERTED relative to deposit. This is an
    // intentional asymmetry in the Move module; do NOT "normalize" the SDK
    // side without flipping Move too.
    expect(repayCmd.MoveCall.arguments).toHaveLength(7);
    expect(repayCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
      USDC,
    ]);

    // The refund coin returned by leverage_delegate::repay must transfer
    // to the caller-supplied sender (recipient-tampering catch).
    expectTransferRecipient(tx, RECIPIENT);

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateIncreaseSizeOperation (BorrowSwap) — request_leverage + swap + complete_leverage + refund', async () => {
    const leverage = makeLeverageClient();
    stubExchange(leverage);
    const tx = new Transaction();

    const operation: LeverageIncreaseParams = {
      totalCollateral: 2_000_000n,
      totalDebt: 1_000_000n,
      totalLeveragedDebt: 1_000_000n,
      optType: IncreaseOperationType.BorrowSwap,
      collateralCoin: SUI,
      borrowCoin: USDC,
    };
    const oraclePrices = new Map<string, number>([
      [SUI, 1],
      [USDC, 1],
    ]);
    const decimalPlaces = new Map<string, number>([
      [SUI, 9],
      [USDC, 6],
    ]);

    await leverage.populateIncreaseSizeOperation(
      tx,
      LEVERAGE_MARKET_INDEX,
      tx.object(OWNER_CAP),
      COIN_OBJECT,
      operation,
      TokenExchange.Cetus,
      0.01,
      RECIPIENT,
      oraclePrices,
      decimalPlaces,
    );

    const data = tx.getData();

    // request_leverage — opens flash loan + emits borrowed coins for swap.
    const requestCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_borrow_swap' &&
        c.MoveCall.function === 'request_leverage',
    );
    expect(requestCmd).toBeDefined();
    if (requestCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(requestCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    // (app, leverage_app, market, leverage_market, owner_cap,
    //  initial_collateral_coin, total_leveraged_amount, total_debt_amount,
    //  coin_decimals_registry, clock, x_oracle)
    expect(requestCmd.MoveCall.arguments).toHaveLength(11);
    expect(requestCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
      USDC,
    ]);

    // complete_leverage — closes the flash loan with the swap output.
    const completeCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_repay' &&
        c.MoveCall.function === 'complete_leverage',
    );
    expect(completeCmd).toBeDefined();
    if (completeCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(completeCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    // (app, market, leverage_market, owner_cap, hot_potato, maybe_referral,
    //  repay_coins, oracle, clock, coin_decimals_registry)
    expect(completeCmd.MoveCall.arguments).toHaveLength(10);
    expect(completeCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
    ]);

    // Refund coin must land at the caller-supplied sender.
    expectTransferRecipient(tx, RECIPIENT);

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateReduceSize (output=borrow) — request_reduce_size + swap + complete_reduce + refund', async () => {
    const leverage = makeLeverageClient();
    stubExchange(leverage);
    const tx = new Transaction();
    const obligation = fakeLeverageObligation(SUI, USDC);

    const quote: ReduceOperationParams = {
      collateralWithdraw: 500_000n,
      borrowRepay: 500_000n,
      borrowSwapOut: 500_000n,
      swapInAmount: 500_000n,
    };
    const oraclePrices = new Map<string, number>([
      [SUI, 1],
      [USDC, 1],
    ]);
    const decimalPlaces = new Map<string, number>([
      [SUI, 9],
      [USDC, 6],
    ]);

    // outputCoin = USDC = borrow type → takes the reduce-to-borrow branch.
    await leverage.populateReduceSize(
      tx,
      USDC,
      LEVERAGE_MARKET_INDEX,
      tx.object(OWNER_CAP),
      obligation,
      TokenExchange.Cetus,
      quote,
      Decimal.fromQuotient(50, 100),
      0.01,
      RECIPIENT,
      oraclePrices,
      decimalPlaces,
    );

    const data = tx.getData();

    // request_reduce_size — flash loan + collateral coins out.
    const requestCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_borrow_coin' &&
        c.MoveCall.function === 'request_reduce_size',
    );
    expect(requestCmd).toBeDefined();
    if (requestCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(requestCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    // (app, leverage_app, market, owner_cap, leverage_market,
    //  collateral_withdraw_pct u8, debt_repay u64,
    //  x_oracle, clock, coin_decimals_registry)
    expect(requestCmd.MoveCall.arguments).toHaveLength(10);
    expect(requestCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
      USDC,
    ]);

    // complete_reduce — closes flash loan with swapped output.
    const completeCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_borrow_coin' &&
        c.MoveCall.function === 'complete_reduce',
    );
    expect(completeCmd).toBeDefined();
    if (completeCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(completeCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);

    // Refund coin must land at the caller-supplied sender.
    expectTransferRecipient(tx, RECIPIENT);

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateIncreaseLeverage — borrow_swap::request_leverage + swap + repay::complete_leverage + refund', async () => {
    const leverage = makeLeverageClient();
    stubExchange(leverage);
    const tx = new Transaction();
    const obligation = fakeLeverageObligation(SUI, USDC);
    const market = {} as unknown as Market; // unused by the fake .leverage()

    const operation: LeverageIncreaseParams = {
      totalCollateral: 2_000_000n,
      totalDebt: 1_000_000n,
      totalLeveragedDebt: 1_000_000n,
      optType: IncreaseOperationType.BorrowSwap,
      collateralCoin: SUI,
      borrowCoin: USDC,
    };
    const oraclePrices = new Map<string, number>([
      [SUI, 1],
      [USDC, 1],
    ]);
    const decimalPlaces = new Map<string, number>([
      [SUI, 9],
      [USDC, 6],
    ]);

    await leverage.populateIncreaseLeverage(
      tx,
      market,
      LEVERAGE_MARKET_INDEX,
      tx.object(OWNER_CAP),
      obligation,
      TokenExchange.Cetus,
      operation,
      Decimal.fromNumber(2), // newLeverage > current (1) → passes guard
      0.01,
      RECIPIENT,
      oraclePrices,
      decimalPlaces,
    );

    const data = tx.getData();

    // request_leverage on the borrow_swap module.
    const requestCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_borrow_swap' &&
        c.MoveCall.function === 'request_leverage',
    );
    expect(requestCmd).toBeDefined();
    if (requestCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(requestCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    expect(requestCmd.MoveCall.arguments).toHaveLength(11);
    expect(requestCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
      USDC,
    ]);

    // complete_leverage closes the flash loan.
    const completeCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_repay' &&
        c.MoveCall.function === 'complete_leverage',
    );
    expect(completeCmd).toBeDefined();
    if (completeCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(completeCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    expect(completeCmd.MoveCall.arguments).toHaveLength(10);

    // Initial collateral coin is a `coin::zero<collateralCoin>()` here.
    const zeroCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.package === '0x0000000000000000000000000000000000000000000000000000000000000002' &&
        c.MoveCall.module === 'coin' &&
        c.MoveCall.function === 'zero',
    );
    expect(zeroCmd).toBeDefined();

    // Refund coin must land at the caller-supplied sender.
    expectTransferRecipient(tx, RECIPIENT);

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateReduceLeverage (collateral-side) — request_reduce_leverage + split + swap + complete_reduce + refund', async () => {
    const leverage = makeLeverageClient();
    stubExchange(leverage);
    const tx = new Transaction();
    const obligation = fakeLeverageObligation(SUI, USDC);

    const quote: ReduceOperationParams = {
      collateralWithdraw: 500_000n,
      borrowRepay: 500_000n,
      borrowSwapOut: 500_000n,
      swapInAmount: 500_000n,
    };
    const oraclePrices = new Map<string, number>([
      [SUI, 1],
      [USDC, 1],
    ]);
    const decimalPlaces = new Map<string, number>([
      [SUI, 9],
      [USDC, 6],
    ]);

    // Fake principleType() returns collateral type → reduce-as-collateral branch.
    await leverage.populateReduceLeverage(
      tx,
      LEVERAGE_MARKET_INDEX,
      tx.object(OWNER_CAP),
      obligation,
      quote,
      TokenExchange.Cetus,
      0.01,
      RECIPIENT,
      oraclePrices,
      decimalPlaces,
    );

    const data = tx.getData();

    // request_reduce_leverage on leverage_reduce_to_borrow_coin.
    const requestCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_borrow_coin' &&
        c.MoveCall.function === 'request_reduce_leverage',
    );
    expect(requestCmd).toBeDefined();
    if (requestCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(requestCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    // (app, leverage_app, market, owner_cap, leverage_market,
    //  debt_repay u64, collateral_withdraw u64,
    //  x_oracle, clock, coin_decimals_registry)
    expect(requestCmd.MoveCall.arguments).toHaveLength(10);
    expect(requestCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
      USDC,
    ]);

    // split_with_event — only the collateral-side branch splits.
    const splitCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_repay' &&
        c.MoveCall.function === 'split_with_event',
    );
    expect(splitCmd).toBeDefined();
    if (splitCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(splitCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);

    // complete_reduce closes the flash loan.
    const completeCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_borrow_coin' &&
        c.MoveCall.function === 'complete_reduce',
    );
    expect(completeCmd).toBeDefined();
    if (completeCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(completeCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);

    // Refund (+ leftover collateral coins) must land at the caller-supplied sender.
    expectTransferRecipient(tx, RECIPIENT, 2);

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('openAndApplyOperation — open_obligation + borrowThenSwap + cap transfer (2 transferObjects, both to sender)', async () => {
    const leverage = makeLeverageClient();
    stubExchange(leverage);
    const tx = new Transaction();

    const operation: LeverageIncreaseParams = {
      totalCollateral: 2_000_000n,
      totalDebt: 1_000_000n,
      totalLeveragedDebt: 1_000_000n,
      optType: IncreaseOperationType.BorrowSwap,
      collateralCoin: SUI,
      borrowCoin: USDC,
    };
    const oraclePrices = new Map<string, number>([
      [SUI, 1],
      [USDC, 1],
    ]);
    const decimalPlaces = new Map<string, number>([
      [SUI, 9],
      [USDC, 6],
    ]);

    await leverage.openAndApplyOperation(
      tx,
      LEVERAGE_MARKET_INDEX,
      COIN_OBJECT,
      operation,
      TokenExchange.Cetus,
      0.01,
      RECIPIENT,
      oraclePrices,
      decimalPlaces,
    );

    const data = tx.getData();

    // open_obligation creates the leverage owner cap.
    const openCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_obligation' &&
        c.MoveCall.function === 'open_obligation',
    );
    expect(openCmd).toBeDefined();
    if (openCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(openCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    // (app, leverage_app, leverage_market, market)
    expect(openCmd.MoveCall.arguments).toHaveLength(4);
    expect(openCmd.MoveCall.typeArguments).toEqual([MAINNET.mainMarketType]);

    // Delegates to borrowThenSwap → request_leverage + complete_leverage.
    const requestCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_borrow_swap' &&
        c.MoveCall.function === 'request_leverage',
    );
    expect(requestCmd).toBeDefined();
    const completeCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_repay' &&
        c.MoveCall.function === 'complete_leverage',
    );
    expect(completeCmd).toBeDefined();

    // Two transferObjects in this flow: borrowThenSwap's refund + the cap.
    // BOTH must land at the caller-supplied sender.
    expectAllTransfersToRecipient(tx, RECIPIENT, 2);

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateIncreaseSizeOperation (SwapBorrow) — swap_borrow::request_leverage + swap + complete_leverage + refund', async () => {
    const leverage = makeLeverageClient();
    stubExchange(leverage);
    const tx = new Transaction();

    const operation: LeverageIncreaseParams = {
      totalCollateral: 2_000_000n,
      totalDebt: 1_000_000n,
      totalLeveragedDebt: 1_000_000n,
      optType: IncreaseOperationType.SwapBorrow,
      collateralCoin: SUI,
      borrowCoin: USDC,
    };
    const oraclePrices = new Map<string, number>([
      [SUI, 1],
      [USDC, 1],
    ]);
    const decimalPlaces = new Map<string, number>([
      [SUI, 9],
      [USDC, 6],
    ]);

    await leverage.populateIncreaseSizeOperation(
      tx,
      LEVERAGE_MARKET_INDEX,
      tx.object(OWNER_CAP),
      COIN_OBJECT,
      operation,
      TokenExchange.Cetus,
      0.01,
      RECIPIENT,
      oraclePrices,
      decimalPlaces,
    );

    const data = tx.getData();

    // SwapBorrow path: leverage_swap_borrow::request_leverage, not borrow_swap.
    const requestCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_swap_borrow' &&
        c.MoveCall.function === 'request_leverage',
    );
    expect(requestCmd).toBeDefined();
    if (requestCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(requestCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    // (app, leverage_app, market, leverage_market, owner_cap,
    //  initial_debt_coin, total_leveraged_debt, x_oracle, clock)
    expect(requestCmd.MoveCall.arguments).toHaveLength(9);
    expect(requestCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
      USDC,
    ]);

    // complete_leverage lives on the swap_borrow module here (NOT
    // leverage_repay — that's the borrow_swap path).
    const completeCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_swap_borrow' &&
        c.MoveCall.function === 'complete_leverage',
    );
    expect(completeCmd).toBeDefined();
    if (completeCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(completeCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    expect(completeCmd.MoveCall.arguments).toHaveLength(10);
    expect(completeCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
      USDC,
    ]);

    expectTransferRecipient(tx, RECIPIENT);
    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateReduceLeverage (borrow-side) — request_reduce_leverage + swap + complete_reduce + refund (no split)', async () => {
    const leverage = makeLeverageClient();
    stubExchange(leverage);
    const tx = new Transaction();
    // principleType returns the BORROW type, so isReduceAsCollateral === false
    // and we take the as-borrow branch.
    const obligation = fakeLeverageObligation(SUI, USDC, { principleType: USDC });

    const quote: ReduceOperationParams = {
      collateralWithdraw: 500_000n,
      borrowRepay: 500_000n,
      borrowSwapOut: 500_000n,
      swapInAmount: 500_000n,
    };
    const oraclePrices = new Map<string, number>([
      [SUI, 1],
      [USDC, 1],
    ]);
    const decimalPlaces = new Map<string, number>([
      [SUI, 9],
      [USDC, 6],
    ]);

    await leverage.populateReduceLeverage(
      tx,
      LEVERAGE_MARKET_INDEX,
      tx.object(OWNER_CAP),
      obligation,
      quote,
      TokenExchange.Cetus,
      0.01,
      RECIPIENT,
      oraclePrices,
      decimalPlaces,
    );

    const data = tx.getData();

    const requestCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_borrow_coin' &&
        c.MoveCall.function === 'request_reduce_leverage',
    );
    expect(requestCmd).toBeDefined();
    if (requestCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(requestCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);
    expect(requestCmd.MoveCall.arguments).toHaveLength(10);
    expect(requestCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
      USDC,
    ]);

    // The as-borrow branch does NOT split — distinguishes from as-collateral.
    const splitCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_repay' &&
        c.MoveCall.function === 'split_with_event',
    );
    expect(splitCmd).toBeUndefined();

    const completeCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_borrow_coin' &&
        c.MoveCall.function === 'complete_reduce',
    );
    expect(completeCmd).toBeDefined();

    // Single transfer with one object (just the refund), unlike as-collateral
    // which packs [refund, collateralCoins].
    expectTransferRecipient(tx, RECIPIENT, 1);
    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateReduceSize (output=collateral) — toCollateral branch: request_reduce_size + split + swap + complete_reduce', async () => {
    const leverage = makeLeverageClient();
    stubExchange(leverage);
    const tx = new Transaction();
    const obligation = fakeLeverageObligation(SUI, USDC);

    const quote: ReduceOperationParams = {
      collateralWithdraw: 500_000n,
      borrowRepay: 500_000n,
      borrowSwapOut: 500_000n,
      swapInAmount: 500_000n,
    };
    const oraclePrices = new Map<string, number>([
      [SUI, 1],
      [USDC, 1],
    ]);
    const decimalPlaces = new Map<string, number>([
      [SUI, 9],
      [USDC, 6],
    ]);

    // outputCoin = SUI = collateralType → reduce-to-collateral branch.
    await leverage.populateReduceSize(
      tx,
      SUI,
      LEVERAGE_MARKET_INDEX,
      tx.object(OWNER_CAP),
      obligation,
      TokenExchange.Cetus,
      quote,
      Decimal.fromQuotient(50, 100),
      0.01,
      RECIPIENT,
      oraclePrices,
      decimalPlaces,
    );

    const data = tx.getData();

    const requestCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_borrow_coin' &&
        c.MoveCall.function === 'request_reduce_size',
    );
    expect(requestCmd).toBeDefined();

    // toCollateral path DOES split (distinguishes from toBorrow).
    const splitCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_repay' &&
        c.MoveCall.function === 'split_with_event',
    );
    expect(splitCmd).toBeDefined();

    const completeCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_borrow_coin' &&
        c.MoveCall.function === 'complete_reduce',
    );
    expect(completeCmd).toBeDefined();

    // toCollateral path transfers [refundCoin, collateralCoins] in one call.
    expectTransferRecipient(tx, RECIPIENT, 2);
    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateReduceSize (debt=0 early exit) — withdraw_size + refund, NO flash loan or swap', async () => {
    const leverage = makeLeverageClient();
    stubExchange(leverage);
    const tx = new Transaction();
    // debtAmount = 0 hits the early-exit in populateReduceSizeToBorrow /
    // populateReduceSizeToCollateral, which just calls populateWithdrawSize
    // and transfers the withdrawn coins. No flash loan, no swap.
    const obligation = fakeLeverageObligation(SUI, USDC, { debtAmount: 0n });

    const quote: ReduceOperationParams = {
      collateralWithdraw: 500_000n,
      borrowRepay: 0n,
      borrowSwapOut: 0n,
      swapInAmount: 0n,
    };
    const oraclePrices = new Map<string, number>([
      [SUI, 1],
      [USDC, 1],
    ]);
    const decimalPlaces = new Map<string, number>([
      [SUI, 9],
      [USDC, 6],
    ]);

    await leverage.populateReduceSize(
      tx,
      USDC, // output=borrow → populateReduceSizeToBorrow early-exit
      LEVERAGE_MARKET_INDEX,
      tx.object(OWNER_CAP),
      obligation,
      TokenExchange.Cetus,
      quote,
      Decimal.fromQuotient(50, 100),
      0.01,
      RECIPIENT,
      oraclePrices,
      decimalPlaces,
    );

    const data = tx.getData();

    // withdraw_size is the only protocol moveCall on this early-exit path.
    const withdrawCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_collateral_coin' &&
        c.MoveCall.function === 'withdraw_size',
    );
    expect(withdrawCmd).toBeDefined();
    if (withdrawCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(withdrawCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);

    // Flash loan path MUST NOT be taken.
    const requestCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_borrow_coin' &&
        c.MoveCall.function === 'request_reduce_size',
    );
    expect(requestCmd).toBeUndefined();
    const completeCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_borrow_coin' &&
        c.MoveCall.function === 'complete_reduce',
    );
    expect(completeCmd).toBeUndefined();

    // Single transfer of the withdrawn coin to sender.
    expectTransferRecipient(tx, RECIPIENT, 1);
    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateReduceSize (debt=0 collateral output) — withdraw_size + refund to sender', async () => {
    const leverage = makeLeverageClient();
    stubExchange(leverage);
    const tx = new Transaction();
    const obligation = fakeLeverageObligation(SUI, USDC, { debtAmount: 0n });

    const quote: ReduceOperationParams = {
      collateralWithdraw: 500_000n,
      borrowRepay: 0n,
      borrowSwapOut: 0n,
      swapInAmount: 0n,
    };
    const oraclePrices = new Map<string, number>([
      [SUI, 1],
      [USDC, 1],
    ]);
    const decimalPlaces = new Map<string, number>([
      [SUI, 9],
      [USDC, 6],
    ]);

    await leverage.populateReduceSize(
      tx,
      SUI, // output=collateral -> populateReduceSizeToCollateral early-exit
      LEVERAGE_MARKET_INDEX,
      tx.object(OWNER_CAP),
      obligation,
      TokenExchange.Cetus,
      quote,
      Decimal.fromQuotient(50, 100),
      0.01,
      RECIPIENT,
      oraclePrices,
      decimalPlaces,
    );

    const data = tx.getData();

    const withdrawCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_collateral_coin' &&
        c.MoveCall.function === 'withdraw_size',
    );
    expect(withdrawCmd).toBeDefined();
    if (withdrawCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(withdrawCmd.MoveCall.package).toBe(MAINNET.leveragePackageId);

    const requestCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'leverage_reduce_to_borrow_coin' &&
        c.MoveCall.function === 'request_reduce_size',
    );
    expect(requestCmd).toBeUndefined();

    expectTransferRecipient(tx, RECIPIENT, 1);
  });
});
