import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import { LendingClient } from '../../index.js';

// Test fixtures — distinctive values so failures point straight at the field
// that broke.
const NETWORK = 'mainnet';
const RECIPIENT = '0x' + 'aa'.repeat(32);
const OBLIGATION_CAP = '0x' + 'bb'.repeat(32);
const PRICE_INFO_OBJECT = '0x' + 'cc'.repeat(32);

const SUI =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

// Expected mainnet addresses — hardcoded so the assertions don't degenerate
// into tautologies against `client.config`. If networks.ts is tampered, the
// PTB's package field will diverge from these and the test fails loudly.
const MAINNET = {
  protocolPackageId:
    '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf',
  xOraclePackageId:
    '0x144c57d6014488bc71c0902bddff482af090d13e2c61333ed903fe088220a92c',
  mainMarketObjectId:
    '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
  mainMarketType:
    '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
} as const;

/**
 * Build a LendingClient with the Pyth network calls stubbed out. The shape
 * tests don't care whether the actual VAA fetch is exercised — they care
 * that the PTB's MoveCall targets, packages, and transferObjects address
 * are wired correctly.
 */
function makeClient(): LendingClient {
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

/**
 * Resolve a Move-call command's arguments back to the inputs they reference,
 * making argument-order assertions readable.
 */
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

describe('LendingClient PTB shape', () => {
  it('populateBorrowTransactionWithAllAssets — correct package, module, args, recipient', async () => {
    const client = makeClient();
    const tx = new Transaction();

    await client.populateBorrowTransactionWithAllAssets(
      tx,
      MAINNET.mainMarketObjectId,
      MAINNET.mainMarketType,
      OBLIGATION_CAP,
      SUI,
      [SUI, USDC],
      500_000_000n,
      RECIPIENT,
    );

    const data = tx.getData();

    // The borrow MoveCall must land on the configured protocol package.
    const borrowCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'borrow' &&
        c.MoveCall.function === 'borrow',
    );
    expect(borrowCmd).toBeDefined();
    if (borrowCmd?.$kind !== 'MoveCall') throw new Error('unreachable');

    // Compare against the hardcoded baseline, not client.config — if
    // networks.ts ever points protocolPackageId at an attacker package,
    // this assertion fails. (Comparing to client.config would silently
    // agree with the tampered value.)
    expect(borrowCmd.MoveCall.package).toBe(MAINNET.protocolPackageId);
    // (app, obligation_owner_cap, market, coin_decimals_registry, amount, x_oracle, clock)
    expect(borrowCmd.MoveCall.arguments).toHaveLength(7);
    expect(borrowCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
    ]);

    // Sanity-check the oracle refresh calls — same anti-tautology principle.
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

    // The borrowed coin must be transferred to the caller-supplied recipient.
    expectTransferRecipient(tx, RECIPIENT);

    // Optional belt-and-suspenders structural snapshot — any change to the
    // command graph forces a deliberate snapshot update during review.
    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateWithdrawTransactionWithAssets — correct package, module, args, no transfer', async () => {
    const client = makeClient();
    const tx = new Transaction();

    await client.populateWithdrawTransactionWithAssets(
      tx,
      MAINNET.mainMarketObjectId,
      MAINNET.mainMarketType,
      OBLIGATION_CAP,
      SUI,
      [SUI, USDC],
      1_000_000n,
    );

    const data = tx.getData();

    const withdrawCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'withdraw' &&
        c.MoveCall.function === 'withdraw',
    );
    expect(withdrawCmd).toBeDefined();
    if (withdrawCmd?.$kind !== 'MoveCall') throw new Error('unreachable');

    expect(withdrawCmd.MoveCall.package).toBe(MAINNET.protocolPackageId);
    // (app, market, obligation_owner_cap, coin_decimals_registry, amount, x_oracle, clock)
    expect(withdrawCmd.MoveCall.arguments).toHaveLength(7);
    expect(withdrawCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
    ]);

    // Withdraw's recipient is pinned to ctx.sender() on the Move side; the
    // SDK does NOT emit a TransferObjects command.
    const transferCmd = data.commands.find((c) => c.$kind === 'TransferObjects');
    expect(transferCmd).toBeUndefined();

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populatedDepositTxn — correct package, module, args, no transfer', () => {
    const client = makeClient();
    const tx = new Transaction();
    const COIN_OBJECT = '0x' + 'dd'.repeat(32);

    client.populatedDepositTxn(
      tx,
      MAINNET.mainMarketObjectId,
      MAINNET.mainMarketType,
      OBLIGATION_CAP,
      SUI,
      COIN_OBJECT,
    );

    const data = tx.getData();

    expect(data.commands).toHaveLength(1);
    const depositCmd = data.commands[0];
    expect(depositCmd.$kind).toBe('MoveCall');
    if (depositCmd.$kind !== 'MoveCall') throw new Error('unreachable');

    expect(depositCmd.MoveCall.package).toBe(MAINNET.protocolPackageId);
    expect(depositCmd.MoveCall.module).toBe('deposit');
    expect(depositCmd.MoveCall.function).toBe('deposit');
    // (app, market, obligation_owner_cap, coin, clock)
    expect(depositCmd.MoveCall.arguments).toHaveLength(5);
    expect(depositCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
    ]);

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateRepayTxn — correct package, module, args, no transfer', () => {
    const client = makeClient();
    const tx = new Transaction();
    const COIN_OBJECT = '0x' + 'dd'.repeat(32);

    client.populateRepayTxn(
      tx,
      MAINNET.mainMarketObjectId,
      MAINNET.mainMarketType,
      OBLIGATION_CAP,
      SUI,
      COIN_OBJECT,
    );

    const data = tx.getData();

    expect(data.commands).toHaveLength(1);
    const repayCmd = data.commands[0];
    expect(repayCmd.$kind).toBe('MoveCall');
    if (repayCmd.$kind !== 'MoveCall') throw new Error('unreachable');

    expect(repayCmd.MoveCall.package).toBe(MAINNET.protocolPackageId);
    expect(repayCmd.MoveCall.module).toBe('repay');
    expect(repayCmd.MoveCall.function).toBe('repay');
    // (app, obligation_owner_cap, market, coin, clock) — note: owner_cap
    // before market here, INVERTED relative to deposit. Move signature is
    // intentionally asymmetric; do NOT "normalize" without flipping Move.
    expect(repayCmd.MoveCall.arguments).toHaveLength(5);
    expect(repayCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
    ]);

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateEnterMarketTxn — correct package, module, args', () => {
    const client = makeClient();
    const tx = new Transaction();

    client.populateEnterMarketTxn(tx, MAINNET.mainMarketObjectId, MAINNET.mainMarketType);

    const data = tx.getData();

    expect(data.commands).toHaveLength(1);
    const enterCmd = data.commands[0];
    expect(enterCmd.$kind).toBe('MoveCall');
    if (enterCmd.$kind !== 'MoveCall') throw new Error('unreachable');

    expect(enterCmd.MoveCall.package).toBe(MAINNET.protocolPackageId);
    expect(enterCmd.MoveCall.module).toBe('enter_market');
    expect(enterCmd.MoveCall.function).toBe('enter_market_return');
    expect(enterCmd.MoveCall.arguments).toHaveLength(2); // (app, market)
    expect(enterCmd.MoveCall.typeArguments).toEqual([MAINNET.mainMarketType]);

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateEnterMarketAndDepositTxn — enter + deposit + transferObjects(cap, sender)', () => {
    const client = makeClient();
    const tx = new Transaction();
    const COIN_OBJECT = '0x' + 'dd'.repeat(32);

    client.populateEnterMarketAndDepositTxn(
      tx,
      MAINNET.mainMarketObjectId,
      MAINNET.mainMarketType,
      SUI,
      COIN_OBJECT,
      RECIPIENT,
    );

    const data = tx.getData();

    expect(data.commands).toHaveLength(3); // enter_market + deposit + transferObjects

    const enterCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'enter_market' &&
        c.MoveCall.function === 'enter_market_return',
    );
    expect(enterCmd).toBeDefined();
    if (enterCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(enterCmd.MoveCall.package).toBe(MAINNET.protocolPackageId);

    const depositCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'deposit' &&
        c.MoveCall.function === 'deposit',
    );
    expect(depositCmd).toBeDefined();
    if (depositCmd?.$kind !== 'MoveCall') throw new Error('unreachable');
    expect(depositCmd.MoveCall.package).toBe(MAINNET.protocolPackageId);

    // The obligation owner cap returned by enter_market_return must be
    // transferred to the caller-supplied sender.
    expectTransferRecipient(tx, RECIPIENT);

    expect(commandSummary(tx)).toMatchSnapshot();
  });
});
