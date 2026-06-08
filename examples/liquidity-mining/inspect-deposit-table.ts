import 'dotenv/config';
import { bcs } from '@mysten/sui/bcs';
import { getMarket, normalizeCoinType } from '@current-finance/current-sdk';
import { SuiGrpcClient } from '@mysten/sui/grpc';

function createExampleSuiGrpcClient(_network: 'mainnet' = 'mainnet') {
  const baseUrl = 'https://fullnode.mainnet.sui.io:443';
  return new SuiGrpcClient({ baseUrl, network: 'mainnet' });
}

async function inspectDepositTable(network: 'mainnet' = 'mainnet', marketName = 'MainMarket') {
  const client = createExampleSuiGrpcClient(network);
  const market = getMarket(network, marketName);
  console.log(`Inspecting deposit table for ${marketName} on ${network}`);

  const marketResp = await client.getObject({
    objectId: market.objectId,
    include: { json: true, type: true },
  });
  const j = marketResp.object?.json as Record<string, unknown> | undefined;
  if (!j) {
    throw new Error('Failed to load market json');
  }

  const liquidityMiner = j.liquidity_miner as { deposit?: { id?: string } } | undefined;
  const depositTableId = liquidityMiner?.deposit?.id;
  if (!depositTableId) {
    throw new Error('Deposit table id not found in liquidity_miner (expected deposit.id)');
  }

  console.log(`Deposit table id: ${depositTableId}`);

  const entries: Array<{ fieldId: string; reserveCoinType: string }> = [];
  let cursor: string | undefined;
  let hasNextPage = true;
  while (hasNextPage) {
    const resp = await client.core.listDynamicFields({
      parentId: depositTableId,
      cursor: cursor === null || cursor === undefined ? undefined : cursor,
      limit: 50,
    });
    for (const entry of resp.dynamicFields) {
      const e = entry as { fieldId: string; name?: { bcs?: Uint8Array } };
      let typeNameValue: string | undefined;
      if (e.name?.bcs) {
        typeNameValue = bcs.struct('TypeName', { name: bcs.string() }).parse(e.name.bcs).name;
      }
      const reserveCoinType = typeNameValue ? normalizeCoinType(typeNameValue) : undefined;
      if (reserveCoinType) {
        entries.push({ fieldId: e.fieldId, reserveCoinType });
      }
    }
    cursor = resp.cursor ?? undefined;
    hasNextPage = resp.hasNextPage;
  }

  if (entries.length === 0) {
    console.log('No entries found in deposit table.');
    return;
  }

  const batch = await client.getObjects({
    objectIds: entries.map((e) => e.fieldId),
    include: { json: true },
  });
  const objects = batch.objects as unknown[];

  console.log('Deposit table entries:');
  for (let i = 0; i < entries.length; i++) {
    const { reserveCoinType } = entries[i];
    const managerObject = objects[i];
    if (managerObject instanceof Error) {
      console.log(`- ${reserveCoinType}: (skip fetch error)`);
      continue;
    }
    const content = (managerObject as { json?: { value?: Record<string, unknown> } }).json;
    const poolFields = content?.value as Record<string, unknown> | undefined;
    if (!poolFields) {
      console.log(`- ${reserveCoinType}: (no value)`);
      continue;
    }

    console.log(`- Coin type: ${reserveCoinType}`);
    console.log(`  Pool manager id: ${poolFields.id}`);
    console.log(`  Total shares: ${poolFields.total_shares}`);

    const poolRewards = (poolFields.pool_rewards as unknown[]) ?? [];
    if (poolRewards.length > 0) {
      console.log('  Pool rewards:');
      for (const reward of poolRewards) {
        const r = reward as Record<string, unknown>;
        const coinTypeRaw = r.coin_type;
        const rewardCoin =
          typeof coinTypeRaw === 'string' ? coinTypeRaw : String(coinTypeRaw ?? '');
        console.log(`    - Reward coin: ${rewardCoin}`);
        console.log(`      Start: ${r.start_time_ms}`);
        console.log(`      End: ${r.end_time_ms}`);
        console.log(`      Total rewards: ${r.total_rewards}`);
        console.log(`      Cumulative per share: ${JSON.stringify(r.cumulative_rewards_per_share)}`);
      }
    } else {
      console.log('  Pool rewards: (none)');
    }

    const obligationManagersTableId = (poolFields.obligation_reward_managers as { id?: string } | undefined)
      ?.id;
    if (!obligationManagersTableId) {
      console.log('  No obligation reward managers table found.');
      continue;
    }

    const obligationEntries: Array<{ fieldId: string; obligationIdBytes: Uint8Array }> = [];
    let oc: string | undefined;
    let on = true;
    while (on) {
      const oresp = await client.core.listDynamicFields({
        parentId: obligationManagersTableId,
        cursor: oc === null || oc === undefined ? undefined : oc,
        limit: 50,
      });
      for (const oe of oresp.dynamicFields) {
        const o = oe as { fieldId: string; name?: { bcs?: Uint8Array } };
        if (o.name?.bcs) {
          obligationEntries.push({
            fieldId: o.fieldId,
            obligationIdBytes: new Uint8Array(o.name.bcs),
          });
        }
      }
      oc = oresp.cursor ?? undefined;
      on = oresp.hasNextPage;
    }

    if (obligationEntries.length === 0) {
      console.log('  No obligation reward manager entries.');
      continue;
    }

    const obBatch = await client.getObjects({
      objectIds: obligationEntries.map((e) => e.fieldId),
      include: { json: true },
    });
    const obObjects = obBatch.objects as unknown[];

    console.log('  Obligation reward managers:');
    for (let k = 0; k < obligationEntries.length; k++) {
      const obligationIdHex = '0x' + Buffer.from(obligationEntries[k].obligationIdBytes).toString('hex');
      const obObj = obObjects[k];
      if (obObj instanceof Error) {
        console.log(`    - Obligation id (raw name bytes): ${obligationIdHex}`);
        continue;
      }
      const obContent = (obObj as { json?: { value?: Record<string, unknown> } }).json;
      const obligationValue = obContent?.value as Record<string, unknown> | undefined;
      console.log(`    - Obligation id (name bytes): ${obligationIdHex}`);
      console.log(`      Share: ${obligationValue?.share}`);
      console.log(`      Last update (ms): ${obligationValue?.last_update_time_ms}`);
      const rewards = obligationValue?.rewards as unknown[] | undefined;
      console.log(`      Rewards length: ${rewards?.length ?? 0}`);
      if (rewards && rewards.length > 0) {
        console.log(`      Rewards detail: ${JSON.stringify(rewards)}`);
      }
    }
  }
}

export { inspectDepositTable };
