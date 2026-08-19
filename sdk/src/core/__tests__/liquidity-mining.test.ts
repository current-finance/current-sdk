import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import {
  LendingClient,
  LiquidityMiningClient,
  ReadOnlyXOracleClient,
  RewardType,
} from '../../index.js';
import type {
  ClaimRewardAutoRequest,
  ClaimRewardRequest,
  RewardIndicesResult,
} from '../../liquidity-mining-types/index.js';

// Test fixtures
const NETWORK = 'mainnet';
const RECIPIENT = '0x' + 'aa'.repeat(32);
const OBLIGATION_CAP = '0x' + 'bb'.repeat(32);

const SUI =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const DEEP =
  '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP';

// Hardcoded mainnet baseline so the assertion isn't a tautology against config.
const MAINNET = {
  protocolPackageId:
    '0x45bae0425e9098ce5cba3d3fa2836220ad24c9f88aa0dffffb5a52b49319fc70',
  protocolAppId:
    '0xd4395f77a48f6d64af2008280c8dc06ee0fe69953a141e683935f6086d849177',
  mainMarketObjectId:
    '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
  mainMarketType:
    '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
} as const;

function makeClient(): LiquidityMiningClient {
  // Instantiate via the LendingClient so we get the configured + verified
  // protocolPackageId/protocolAppId, but also assert here that those config
  // values still match the hardcoded baseline. If networks.ts is tampered,
  // this check is the canary before the PTB check.
  //
  // Reward claims never refresh the oracle, so a read-only refresher (which throws if asked to refresh)
  // is enough here — and documents that the claim path emits no refresh calls.
  const lending = LendingClient.fromConfig({ network: NETWORK }, new ReadOnlyXOracleClient());
  expect(lending.config.protocolPackageId).toBe(MAINNET.protocolPackageId);
  expect(lending.config.protocolAppId).toBe(MAINNET.protocolAppId);
  return lending.getLiquidityMiningClient();
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

/**
 * Assert that every transferObjects command points at the same recipient,
 * AND that there are exactly `expectedTransferCount` of them. Each claim
 * reward produces its own transferObjects, so this is the helper that
 * catches "one reward redirected to attacker" regressions even in the
 * multi-reward auto-claim path.
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

describe('LiquidityMiningClient PTB shape', () => {
  it('populateClaimRewardTransaction — claim_reward_as_coin + transfer to recipient', () => {
    const lm = makeClient();
    const tx = new Transaction();

    const request: ClaimRewardRequest = {
      marketObjectId: MAINNET.mainMarketObjectId,
      marketType: MAINNET.mainMarketType,
      obligationOwnerCapId: OBLIGATION_CAP,
      coinType: SUI,
      rewardType: RewardType.Deposit,
      rewardIndex: 0,
      rewardCoinType: USDC,
      recipient: RECIPIENT,
    };

    lm.populateClaimRewardTransaction(tx, request);

    const data = tx.getData();
    expect(data.commands).toHaveLength(2); // claim_reward_as_coin + transferObjects

    const claimCmd = data.commands.find(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'liquidity_mining' &&
        c.MoveCall.function === 'claim_reward_as_coin',
    );
    expect(claimCmd).toBeDefined();
    if (claimCmd?.$kind !== 'MoveCall') throw new Error('unreachable');

    // Package must match the hardcoded baseline (NOT just config).
    expect(claimCmd.MoveCall.package).toBe(MAINNET.protocolPackageId);
    // (app, market, obligation_owner_cap, u8 rewardType, u64 rewardIndex, clock)
    expect(claimCmd.MoveCall.arguments).toHaveLength(6);
    expect(claimCmd.MoveCall.typeArguments).toEqual([
      MAINNET.mainMarketType,
      SUI,
      USDC,
    ]);

    // The claimed coin must transfer to the caller-supplied recipient.
    expectAllTransfersToRecipient(tx, RECIPIENT, 1);
    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateClaimRewardAutoTransaction (deposit + borrow, multi-coin) — one claim+transfer per reward', () => {
    const lm = makeClient();
    const tx = new Transaction();

    // Two deposit rewards (USDC, DEEP) + one borrow reward (USDC) = 3 claims.
    const rewardIndices: RewardIndicesResult = {
      depositPool: [
        { index: 0, coinType: USDC, startTimeMs: 0, endTimeMs: 0, totalRewards: 1n },
        { index: 1, coinType: DEEP, startTimeMs: 0, endTimeMs: 0, totalRewards: 1n },
      ],
      borrowPool: [
        { index: 2, coinType: USDC, startTimeMs: 0, endTimeMs: 0, totalRewards: 1n },
      ],
    };
    const request: ClaimRewardAutoRequest = {
      marketObjectId: MAINNET.mainMarketObjectId,
      marketType: MAINNET.mainMarketType,
      obligationOwnerCapId: OBLIGATION_CAP,
      coinType: SUI,
      recipient: RECIPIENT,
    };

    lm.populateClaimRewardAutoTransaction(tx, request, rewardIndices);

    const data = tx.getData();
    const claimCmds = data.commands.filter(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'liquidity_mining' &&
        c.MoveCall.function === 'claim_reward_as_coin',
    );
    expect(claimCmds).toHaveLength(3);
    for (const cmd of claimCmds) {
      if (cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      // Every single claim moveCall must land on the configured protocol
      // package — no smuggled package switch in the middle of the loop.
      expect(cmd.MoveCall.package).toBe(MAINNET.protocolPackageId);
      expect(cmd.MoveCall.typeArguments[0]).toBe(MAINNET.mainMarketType);
      expect(cmd.MoveCall.typeArguments[1]).toBe(SUI);
    }

    // Every claimed coin must transfer to the caller-supplied recipient.
    // (Critical: one regression here would land a single reward at an
    // attacker address while the others go to the user.)
    expectAllTransfersToRecipient(tx, RECIPIENT, 3);

    expect(commandSummary(tx)).toMatchSnapshot();
  });

  it('populateClaimRewardAutoTransaction (rewardType=Deposit filter) — skips borrow rewards', () => {
    const lm = makeClient();
    const tx = new Transaction();

    const rewardIndices: RewardIndicesResult = {
      depositPool: [{ index: 0, coinType: USDC, startTimeMs: 0, endTimeMs: 0, totalRewards: 1n }],
      borrowPool: [{ index: 1, coinType: USDC, startTimeMs: 0, endTimeMs: 0, totalRewards: 1n }],
    };
    const request: ClaimRewardAutoRequest = {
      marketObjectId: MAINNET.mainMarketObjectId,
      marketType: MAINNET.mainMarketType,
      obligationOwnerCapId: OBLIGATION_CAP,
      coinType: SUI,
      rewardType: RewardType.Deposit, // explicit filter
      recipient: RECIPIENT,
    };

    lm.populateClaimRewardAutoTransaction(tx, request, rewardIndices);

    const data = tx.getData();
    const claimCmds = data.commands.filter(
      (c) =>
        c.$kind === 'MoveCall' &&
        c.MoveCall.module === 'liquidity_mining' &&
        c.MoveCall.function === 'claim_reward_as_coin',
    );
    expect(claimCmds).toHaveLength(1);
    // No borrow-pool claims smuggled in.

    expectAllTransfersToRecipient(tx, RECIPIENT, 1);
  });

  it('populateClaimRewardAutoTransaction (no rewards) — emits no commands', () => {
    const lm = makeClient();
    const tx = new Transaction();

    const rewardIndices: RewardIndicesResult = { depositPool: [], borrowPool: [] };
    const request: ClaimRewardAutoRequest = {
      marketObjectId: MAINNET.mainMarketObjectId,
      marketType: MAINNET.mainMarketType,
      obligationOwnerCapId: OBLIGATION_CAP,
      coinType: SUI,
      recipient: RECIPIENT,
    };

    lm.populateClaimRewardAutoTransaction(tx, request, rewardIndices);

    expect(tx.getData().commands).toHaveLength(0);
  });
});

