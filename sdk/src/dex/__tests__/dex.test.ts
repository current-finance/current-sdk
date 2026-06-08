import { Transaction } from '@mysten/sui/transactions';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  AfSui,
  EEarn,
  ESui,
  EThird,
  HaSui,
  SpringSui,
  StSui,
  VSui,
} from '../../index.js';

// Test fixtures
const SENDER = '0x' + 'aa'.repeat(32);
const COIN_OBJECT = '0x' + 'dd'.repeat(32);

const SUI =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

// Hardcoded mainnet baseline so the DEX adapter PTBs aren't checked
// against the same config they read from — if lstInfo.ts / emberInfo.ts
// is tampered to point at an attacker package or object ID, the PTB will
// contain the tampered value and these expectations will fail.
//
// Note: addresses are stored without `0x` prefix here to make matching
// against pure-input bytes (which decode to raw hex) straightforward.
const HASUI = {
  packageId:
    '0x19e6ea7f5ced4f090e20da794cc80349a03e638940ddb95155a4e301f5f4967c',
  liquidStakingInfoId:
    '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca',
  hasuiCoin:
    '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
} as const;
const VSUI = {
  packageId:
    '0x68d22cf8bdbcd11ecba1e094922873e4080d4d11133e2443fddda0bfd11dae20',
  liquidStakingInfoId:
    '0x2d914e23d82fedef1b5f56a32d5c64bdcc3087ccfea2b4d6ea51a71f587840e5',
  metadataId:
    '0x680cd26af32b2bde8d3361e804c53ec1d1cfe24c7f039eb7f549e8dfde389a60',
  certCoin:
    '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
} as const;
const STSUI = {
  packageId:
    '0x059f94b85c07eb74d2847f8255d8cc0a67c9a8dcc039eabf9f8b9e23a0de2700',
  liquidStakingInfoId:
    '0x1adb343ab351458e151bc392fbf1558b3332467f23bda45ae67cd355a57fd5f5',
  stsuiCoin:
    '0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI',
} as const;
const SPRING_SUI = {
  packageId:
    '0x47c4b62aed92c5ae308ecd00253b64b3568ad97e6fb11e54b3d1ac5ed7be19ab',
  liquidStakingInfoId:
    '0x15eda7330c8f99c30e430b4d82fd7ab2af3ead4ae17046fcb224aa9bad394f6b',
  springSuiCoin:
    '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI',
} as const;
const AFSUI = {
  packageId:
    '0x1575034d2729907aefca1ac757d6ccfcd3fc7e9e77927523c06007d8353ad836',
  liquidStakingInfoId:
    '0x2f8f6d5da7f13ea37daa397724280483ed062769813b6f31e9788e59cc88994d',
  vaultState: '0x55486449e41d89cfbdb20e005c1c5c1007858ad5b4d5d7c047d2b3b592fe8791',
  safe: '0xeb685899830dd5837b47007809c76d91a098d52aabbf61e8ac467c59e5cc4610',
  referralVault: '0x4ce9a19b594599536c53edb25d22532f82f18038dc8ef618afd00fbbfb9845ef',
  treasury: '0xd2b95022244757b0ab9f74e2ee2fb2c3bf29dce5590fa6993a85d64bd219d7e8',
  afsuiCoin:
    '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
} as const;
const EMBER = {
  packageId:
    '0x4269cb19a1a7938c8263d21c08d98b9324e5985522072ae3d76928650aed809f',
  protocolConfigId:
    '0x3a515233ab817af082ef31454cee5eb8122b8b7cd586bf6b26ae9b879ee1e565',
  vaults: {
    eSui: {
      id: '0xfaf4d0ec9b76147c926c0c8b2aba39ea21ec991500c1e3e53b60d447b0e5f655',
      fullCoinType:
        '66629328922d609cf15af779719e248ae0e63fe0b9d9739623f763b33a9c97da::esui::ESUI',
    },
    eEarn: {
      id: '0x0779d2a4e1a6d3412982404cfe5567aac8cea229f17622c7b72d198b22a22e37',
      fullCoinType:
        '34469c8accdd673df02600265cbbad3688577f0e716866e257f88d448d463492::eearn::EEARN',
    },
    eThird: {
      id: '0xeadfc1a6ea4915501506945aba6c2acc37c04136a784bafd6ff823a93ef3434a',
      fullCoinType:
        '89b0d4407f17cc1b1294464f28e176e29816a40612f7a553313ea0a797a5f803::ethird::ETHIRD',
    },
  },
} as const;

/**
 * Adapter constructors require a SuiClient but populateSwapIn only uses it
 * for read methods (estimate / quote). A bare GrpcClient pointed at an
 * invalid URL is enough — the network isn't touched.
 */
function stubClient(): SuiGrpcClient {
  return new SuiGrpcClient({ baseUrl: 'http://stub.invalid', network: 'mainnet' });
}

/**
 * Resolve every `tx.object(...)` argument referenced by a moveCall back to
 * the underlying ObjectInput's objectId. Lets us assert that the staking
 * pool / vault / config object IDs the adapter passes match the configured
 * baseline.
 */
function moveCallObjectIds(tx: Transaction, cmdIndex: number): string[] {
  const data = tx.getData();
  const cmd = data.commands[cmdIndex];
  if (cmd.$kind !== 'MoveCall') throw new Error('expected MoveCall');
  const out: string[] = [];
  for (const arg of cmd.MoveCall.arguments) {
    if (arg.$kind !== 'Input') continue;
    const input = data.inputs[arg.Input];
    if (!input) continue;
    // v2 SDK: `tx.object(id)` produces `UnresolvedObject` (just the objectId
    // string) until the tx is built. Already-resolved object refs come back
    // as `Object` with a nested $kind discriminator.
    if (input.$kind === 'UnresolvedObject') {
      out.push((input as { UnresolvedObject: { objectId: string } }).UnresolvedObject.objectId);
      continue;
    }
    if (input.$kind === 'Object') {
      const obj = (input as { Object: { $kind: string; ImmOrOwnedObject?: { objectId: string }; SharedObject?: { objectId: string }; Receiving?: { objectId: string } } }).Object;
      if (obj.$kind === 'ImmOrOwnedObject' && obj.ImmOrOwnedObject) out.push(obj.ImmOrOwnedObject.objectId);
      else if (obj.$kind === 'SharedObject' && obj.SharedObject) out.push(obj.SharedObject.objectId);
      else if (obj.$kind === 'Receiving' && obj.Receiving) out.push(obj.Receiving.objectId);
    }
  }
  return out;
}

function findMoveCall(
  tx: Transaction,
  predicate: (cmd: { package: string; module: string; function: string }) => boolean,
): { index: number; cmd: ReturnType<Transaction['getData']>['commands'][number] } | undefined {
  const data = tx.getData();
  for (let i = 0; i < data.commands.length; i++) {
    const c = data.commands[i];
    if (
      c.$kind === 'MoveCall' &&
      predicate({
        package: c.MoveCall.package,
        module: c.MoveCall.module,
        function: c.MoveCall.function,
      })
    ) {
      return { index: i, cmd: c };
    }
  }
  return undefined;
}

function makeSwapIn(inCoinType: string, outCoinType: string) {
  return {
    inCoinType,
    outCoinType,
    amountIn: 1_000_000n,
    coinId: COIN_OBJECT,
    slippage: 0.01,
    sender: SENDER,
    minOutAmount: 990_000n,
  };
}

describe('DEX adapter PTB shape', () => {
  describe('haSui', () => {
    it('mint (SUI -> haSUI) — staking::request_stake_coin with correct pool ID', async () => {
      const adapter = HaSui.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(tx, makeSwapIn(SUI, HASUI.hasuiCoin));

      const found = findMoveCall(
        tx,
        (c) => c.module === 'staking' && c.function === 'request_stake_coin',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(HASUI.packageId);

      const objectIds = moveCallObjectIds(tx, found.index);
      // request_stake_coin args: (sui_system_state, liquidStakingInfo, suiCoin) → 3 object refs
      expect(objectIds).toContain(HASUI.liquidStakingInfoId);
      // 0x5 is the Sui system state (well-known stdlib singleton)
      expect(objectIds).toContain(
        '0x0000000000000000000000000000000000000000000000000000000000000005',
      );
    });

    it('redeem (haSUI -> SUI) — staking::request_unstake_instant_coin with correct pool ID', async () => {
      const adapter = HaSui.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(tx, makeSwapIn(HASUI.hasuiCoin, SUI));

      const found = findMoveCall(
        tx,
        (c) =>
          c.module === 'staking' && c.function === 'request_unstake_instant_coin',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(HASUI.packageId);
      expect(moveCallObjectIds(tx, found.index)).toContain(HASUI.liquidStakingInfoId);
    });
  });

  describe('vSui', () => {
    it('mint (SUI -> CERT) — stake_pool::stake with correct pool + metadata IDs', async () => {
      const adapter = VSui.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(tx, makeSwapIn(SUI, VSUI.certCoin));

      const found = findMoveCall(
        tx,
        (c) => c.module === 'stake_pool' && c.function === 'stake',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(VSUI.packageId);

      const objectIds = moveCallObjectIds(tx, found.index);
      expect(objectIds).toContain(VSUI.liquidStakingInfoId);
      expect(objectIds).toContain(VSUI.metadataId);
    });

    it('redeem (CERT -> SUI) — stake_pool::unstake', async () => {
      const adapter = VSui.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(tx, makeSwapIn(VSUI.certCoin, SUI));

      const found = findMoveCall(
        tx,
        (c) => c.module === 'stake_pool' && c.function === 'unstake',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(VSUI.packageId);
      expect(moveCallObjectIds(tx, found.index)).toContain(VSUI.liquidStakingInfoId);
    });
  });

  describe('stSui', () => {
    it('mint (SUI -> stSUI) — liquid_staking::mint with correct info ID', async () => {
      const adapter = StSui.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(tx, makeSwapIn(SUI, STSUI.stsuiCoin));

      const found = findMoveCall(
        tx,
        (c) => c.module === 'liquid_staking' && c.function === 'mint',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(STSUI.packageId);
      expect(moveCallObjectIds(tx, found.index)).toContain(STSUI.liquidStakingInfoId);
    });

    it('redeem (stSUI -> SUI) — liquid_staking::redeem with correct info ID', async () => {
      const adapter = StSui.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(tx, makeSwapIn(STSUI.stsuiCoin, SUI));

      const found = findMoveCall(
        tx,
        (c) => c.module === 'liquid_staking' && c.function === 'redeem',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(STSUI.packageId);
      expect(moveCallObjectIds(tx, found.index)).toContain(STSUI.liquidStakingInfoId);
    });
  });

  describe('springSui', () => {
    it('mint (SUI -> SPRING_SUI) — liquid_staking::mint with correct info ID', async () => {
      const adapter = SpringSui.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(tx, makeSwapIn(SUI, SPRING_SUI.springSuiCoin));

      const found = findMoveCall(
        tx,
        (c) => c.module === 'liquid_staking' && c.function === 'mint',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(SPRING_SUI.packageId);
      expect(moveCallObjectIds(tx, found.index)).toContain(SPRING_SUI.liquidStakingInfoId);
    });

    it('redeem (SPRING_SUI -> SUI) — liquid_staking::redeem with correct info ID', async () => {
      const adapter = SpringSui.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(tx, makeSwapIn(SPRING_SUI.springSuiCoin, SUI));

      const found = findMoveCall(
        tx,
        (c) => c.module === 'liquid_staking' && c.function === 'redeem',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(SPRING_SUI.packageId);
      expect(moveCallObjectIds(tx, found.index)).toContain(SPRING_SUI.liquidStakingInfoId);
    });
  });

  describe('afSui', () => {
    it('mint (SUI -> afSUI) — staked_sui_vault::request_stake with correct vault + safe + referral IDs', async () => {
      const adapter = AfSui.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(tx, makeSwapIn(SUI, AFSUI.afsuiCoin));

      const found = findMoveCall(
        tx,
        (c) => c.module === 'staked_sui_vault' && c.function === 'request_stake',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(AFSUI.packageId);

      const objectIds = moveCallObjectIds(tx, found.index);
      // request_stake args: (liquidStakingInfo, safe, sui_system_state,
      // referralVault, suiCoin, pure defaultStakeValidator)
      expect(objectIds).toContain(AFSUI.liquidStakingInfoId);
      expect(objectIds).toContain(AFSUI.safe);
      expect(objectIds).toContain(AFSUI.referralVault);
    });

    it('redeem (afSUI -> SUI) — staked_sui_vault::request_unstake_atomic with correct vault IDs', async () => {
      const adapter = AfSui.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(tx, makeSwapIn(AFSUI.afsuiCoin, SUI));

      const found = findMoveCall(
        tx,
        (c) =>
          c.module === 'staked_sui_vault' &&
          c.function === 'request_unstake_atomic',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(AFSUI.packageId);

      const objectIds = moveCallObjectIds(tx, found.index);
      expect(objectIds).toContain(AFSUI.liquidStakingInfoId);
      expect(objectIds).toContain(AFSUI.safe);
      expect(objectIds).toContain(AFSUI.referralVault);
      expect(objectIds).toContain(AFSUI.treasury);
    });
  });

  describe('ember vaults', () => {
    it('eSui mint (SUI -> eSUI) — vault::deposit_asset_v2 with correct vault + protocol config IDs', async () => {
      const adapter = ESui.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(
        tx,
        makeSwapIn(SUI, EMBER.vaults.eSui.fullCoinType),
      );

      const found = findMoveCall(
        tx,
        (c) => c.module === 'vault' && c.function === 'deposit_asset_v2',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(EMBER.packageId);

      const objectIds = moveCallObjectIds(tx, found.index);
      expect(objectIds).toContain(EMBER.vaults.eSui.id);
      expect(objectIds).toContain(EMBER.protocolConfigId);
    });

    it('eEarn mint (USDC -> eEarn) — vault::deposit_asset_v2 with eEarn vault ID', async () => {
      const adapter = EEarn.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(
        tx,
        makeSwapIn(USDC, EMBER.vaults.eEarn.fullCoinType),
      );

      const found = findMoveCall(
        tx,
        (c) => c.module === 'vault' && c.function === 'deposit_asset_v2',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(EMBER.packageId);

      const objectIds = moveCallObjectIds(tx, found.index);
      expect(objectIds).toContain(EMBER.vaults.eEarn.id);
      // The OTHER ember vault IDs must NOT be referenced — catches vault
      // swap regressions (e.g. eEarn config pointing at eSui vault).
      expect(objectIds).not.toContain(EMBER.vaults.eSui.id);
      expect(objectIds).not.toContain(EMBER.vaults.eThird.id);
    });

    it('eThird mint (USDC -> eThird) — vault::deposit_asset_v2 with eThird vault ID', async () => {
      const adapter = EThird.newInstance(stubClient());
      const tx = new Transaction();
      await adapter.populateSwapIn(
        tx,
        makeSwapIn(USDC, EMBER.vaults.eThird.fullCoinType),
      );

      const found = findMoveCall(
        tx,
        (c) => c.module === 'vault' && c.function === 'deposit_asset_v2',
      );
      expect(found).toBeDefined();
      if (found?.cmd.$kind !== 'MoveCall') throw new Error('unreachable');
      expect(found.cmd.MoveCall.package).toBe(EMBER.packageId);

      const objectIds = moveCallObjectIds(tx, found.index);
      expect(objectIds).toContain(EMBER.vaults.eThird.id);
      expect(objectIds).not.toContain(EMBER.vaults.eSui.id);
      expect(objectIds).not.toContain(EMBER.vaults.eEarn.id);
    });

    it('ember adapters refuse redeem (mint-only protocol)', async () => {
      const adapter = ESui.newInstance(stubClient());
      const tx = new Transaction();
      await expect(
        adapter.populateSwapIn(tx, makeSwapIn(EMBER.vaults.eSui.fullCoinType, SUI)),
      ).rejects.toThrow();
    });
  });
});
