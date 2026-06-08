import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag } from '@mysten/sui/utils';
import {
  ClaimableReward,
  ClaimableRewardsRequest,
  ClaimableRewardsResult,
  ClaimableRewardsBatchRequest,
  ClaimableRewardsBatchResult,
  ClaimRewardRequest,
  ClaimRewardAutoRequest,
  RewardType,
  RewardIndex,
  RewardIndicesResult,
  ActiveRewardSummary,
  ActiveRewardSchedule,
  RewardSummary,
  RewardSchedule,
} from '../liquidity-mining-types';
import { Decimal } from '../market-types/decimal';
import { getCoinMetadata } from '../utils/coin-metadata';
import { normalizeCoinType } from '../utils/transaction-utils';
import {
  GET_OBJECT_INCLUDE_JSON,
  GET_OBJECT_INCLUDE_JSON_TYPE,
  getObjectOrThrow,
  getObjectsJsonOrNull,
  getDynamicFieldJsonOrNull,
} from '../utils/object-utils';

export class LiquidityMiningClient {
  private client: SuiClient;
  private protocolPackageId: string;
  private protocolAppId: string;

  constructor(client: SuiClient, protocolPackageId: string, protocolAppId: string) {
    this.client = client;
    this.protocolPackageId = protocolPackageId;
    this.protocolAppId = protocolAppId;
  }

  async getClaimableRewards(request: ClaimableRewardsRequest): Promise<ClaimableRewardsResult> {
    const { depositTable, borrowTable } = await this.getMarketTables(request.marketObjectId);
    return this.getClaimableRewardsForCoinType(depositTable, borrowTable, request.coinType, request.obligationId);
  }


  async getClaimableRewardsBatch(request: ClaimableRewardsBatchRequest): Promise<ClaimableRewardsBatchResult> {
    const { depositTable, borrowTable } = await this.getMarketTables(request.marketObjectId);
    
    const results: ClaimableRewardsBatchResult = {};
    
    const promises = request.coinTypes.map(async (coinType) => {
      const result = await this.getClaimableRewardsForCoinType(
        depositTable,
        borrowTable,
        coinType,
        request.obligationId,
      );
      return { coinType, result };
    });

    const resolved = await Promise.all(promises);
    for (const { coinType, result } of resolved) {
      results[coinType] = result;
    }

    return results;
  }


  async getRewardIndices(request: ClaimableRewardsRequest): Promise<RewardIndicesResult> {
    const { depositTable, borrowTable } = await this.getMarketTables(request.marketObjectId);

    // Get PoolRewardManager from tables (parallel)
    const [depositPoolRewardManager, borrowPoolRewardManager] = await Promise.all([
      this.getPoolRewardManagerFromTable(depositTable, request.coinType),
      this.getPoolRewardManagerFromTable(borrowTable, request.coinType),
    ]);

    return {
      depositPool: depositPoolRewardManager
        ? this.getAvailableRewardIndices(depositPoolRewardManager)
        : [],
      borrowPool: borrowPoolRewardManager
        ? this.getAvailableRewardIndices(borrowPoolRewardManager)
        : [],
    };
  }

  async getActiveRewardsSummary(
    marketObjectId: string,
    _marketType: string,
    priceMap?: Record<string, Decimal>,
  ): Promise<ActiveRewardSummary[]> {
    const { depositTable, borrowTable } = await this.getMarketTables(marketObjectId);

    const summaries: ActiveRewardSummary[] = [];

    const now = Date.now();

    const processTable = async (table: any, rewardType: RewardType) => {
      const managers = await this.listPoolRewardManagers(table);
      for (const { reserveCoinType, manager } of managers) {
        const rewards = await this.extractActiveRewards(manager, now, reserveCoinType, priceMap);
        if (rewards.length > 0) {
          summaries.push({
            rewardType,
            reserveCoinType,
            rewards,
          });
        }
      }
    };

    await Promise.all([
      processTable(depositTable, RewardType.Deposit),
      processTable(borrowTable, RewardType.Borrow),
    ]);

    return summaries;
  }

  async getAllRewardsSummary(
    marketObjectId: string,
    _marketType: string,
    priceMap?: Record<string, Decimal>,
  ): Promise<RewardSummary[]> {
    const { depositTable, borrowTable } = await this.getMarketTables(marketObjectId);

    const summaries: RewardSummary[] = [];

    const now = Date.now();

    const processTable = async (table: any, rewardType: RewardType) => {
      const managers = await this.listPoolRewardManagers(table);
      for (const { reserveCoinType, manager } of managers) {
        const rewards = await this.extractAllRewards(manager, now, reserveCoinType, priceMap);
        if (rewards.length > 0) {
          summaries.push({
            rewardType,
            reserveCoinType,
            rewards,
          });
        }
      }
    };

    await Promise.all([
      processTable(depositTable, RewardType.Deposit),
      processTable(borrowTable, RewardType.Borrow),
    ]);

    return summaries;
  }

  populateClaimRewardTransaction(
    tx: Transaction,
    request: ClaimRewardRequest,
  ): void {
    const coinTypeForChain = request.coinType;
    const rewardCoinTypeForChain = request.rewardCoinType;

    const coin = tx.moveCall({
      target: `${this.protocolPackageId}::liquidity_mining::claim_reward_as_coin`,
      arguments: [
        tx.object(this.protocolAppId),
        tx.object(request.marketObjectId),
        tx.object(request.obligationOwnerCapId),
        tx.pure.u8(request.rewardType),
        tx.pure.u64(request.rewardIndex),
        tx.object('0x6'), // Clock
      ],
      typeArguments: [
        normalizeStructTag(request.marketType),
        normalizeStructTag(coinTypeForChain),
        normalizeStructTag(rewardCoinTypeForChain),
      ],
    });

    tx.transferObjects([coin], tx.pure.address(request.recipient));
  }

  populateClaimRewardAutoTransaction(
    tx: Transaction,
    request: ClaimRewardAutoRequest,
    rewardIndices: RewardIndicesResult,
  ): void {
    type RewardDescriptor = {
      index: number;
      coinType: string;
      rewardType: RewardType;
    };

    const fromIndices = (rewards: RewardIndex[], rewardType: RewardType): RewardDescriptor[] =>
      rewards.map((reward) => ({
        index: reward.index,
        coinType: reward.coinType,
        rewardType,
      }));

    const rewardTypeFilter = request.rewardType;
    const rewardCoinTypeFilter = request.rewardCoinType;

    let rewardsWithType: RewardDescriptor[] = [];

    if (rewardTypeFilter === undefined || rewardTypeFilter === RewardType.Deposit) {
      rewardsWithType = rewardsWithType.concat(
        fromIndices(rewardIndices.depositPool, RewardType.Deposit),
      );
    }

    if (rewardTypeFilter === undefined || rewardTypeFilter === RewardType.Borrow) {
      rewardsWithType = rewardsWithType.concat(
        fromIndices(rewardIndices.borrowPool, RewardType.Borrow),
      );
    }

    if (rewardsWithType.length === 0) {
      return; // No rewards to claim, do nothing
    }

    // Filter by coinType if specified
    const rewardsToClaim = rewardCoinTypeFilter
      ? rewardsWithType.filter((reward) => reward.coinType === rewardCoinTypeFilter)
      : rewardsWithType;

    if (rewardsToClaim.length === 0) {
      return; // No rewards to claim after filtering, do nothing
    }

    const coinTypeForChain = request.coinType;

    // Add all claim operations to the transaction
    for (const reward of rewardsToClaim) {
      const rewardCoinTypeForChain = reward.coinType;

      const coin = tx.moveCall({
        target: `${this.protocolPackageId}::liquidity_mining::claim_reward_as_coin`,
        arguments: [
          tx.object(this.protocolAppId),
          tx.object(request.marketObjectId),
          tx.object(request.obligationOwnerCapId),
          tx.pure.u8(reward.rewardType),
          tx.pure.u64(reward.index),
          tx.object('0x6'), // Clock
        ],
        typeArguments: [
          normalizeStructTag(request.marketType),
          normalizeStructTag(coinTypeForChain),
          normalizeStructTag(rewardCoinTypeForChain),
        ],
      });

      tx.transferObjects([coin], tx.pure.address(request.recipient));
    }
  }

  convertClaimableRewardsToRewardIndices(
    claimable: ClaimableRewardsResult,
  ): RewardIndicesResult {
    const toRewardIndices = (rewards: ClaimableReward[]): RewardIndex[] =>
      rewards.map((reward) => ({
        index: reward.rewardIndex,
        coinType: reward.coinType,
        startTimeMs: 0,
        endTimeMs: 0,
        totalRewards: reward.amount,
      }));

    return {
      depositPool: toRewardIndices(claimable.depositPool),
      borrowPool: toRewardIndices(claimable.borrowPool),
    };
  }

  // ==================== Private Helper Methods ====================
  private async getMarketTables(marketObjectId: string): Promise<{ depositTable: any; borrowTable: any }> {
    const json = await getObjectOrThrow(this.client, marketObjectId, GET_OBJECT_INCLUDE_JSON_TYPE);
    const liquidityMiner = json.liquidity_miner;
    if (!liquidityMiner) {
      throw new Error(`Invalid marketObjectId: ${marketObjectId}. Market object has no liquidity_miner field.`);
    }

    const depositTable = liquidityMiner.deposit;
    const borrowTable = liquidityMiner.borrow;

    if (!depositTable || !borrowTable) {
      throw new Error('Invalid liquidity_miner structure. Missing deposit or borrow table.');
    }

    return { depositTable, borrowTable };
  }

  private async getClaimableRewardsForCoinType(
    depositTable: any,
    borrowTable: any,
    coinType: string,
    obligationId: string,
  ): Promise<ClaimableRewardsResult> {
    // Get PoolRewardManager from tables (parallel)
    const [depositPoolRewardManager, borrowPoolRewardManager] = await Promise.all([
      this.getPoolRewardManagerFromTable(depositTable, coinType),
      this.getPoolRewardManagerFromTable(borrowTable, coinType),
    ]);

    // Get ObligationRewardManager from PoolRewardManager (parallel)
    const [depositObligationRewardManager, borrowObligationRewardManager] = await Promise.all([
      depositPoolRewardManager
        ? this.getObligationRewardManager(depositPoolRewardManager, obligationId)
        : Promise.resolve(null),
      borrowPoolRewardManager
        ? this.getObligationRewardManager(borrowPoolRewardManager, obligationId)
        : Promise.resolve(null),
    ]);

    // Calculate claimable rewards (parallel)
    let depositRewards: ClaimableReward[] = [];
    if (depositObligationRewardManager && depositPoolRewardManager) {
      depositRewards = this.calculateClaimableRewards(depositObligationRewardManager, depositPoolRewardManager);
    }
    let borrowRewards: ClaimableReward[] = [];
    if (borrowObligationRewardManager && borrowPoolRewardManager) {
      borrowRewards = this.calculateClaimableRewards(borrowObligationRewardManager, borrowPoolRewardManager);
    }

    return {
      depositPool: depositRewards,
      borrowPool: borrowRewards,
    };
  }

  private async getPoolRewardManagerFromTable(
    table: any,
    coinType: string,
  ): Promise<any | null> {
    const tableId = table?.id;
    if (!tableId) {
      return null;
    }

    const normalizeTypeName = (s: string) => {
      const parts = s.split('::');
      if (parts.length < 3) {
        return s.replace(/^0x/, '');
      }

      const [address, ...rest] = parts;
      const normalizedAddress = address.replace(/^0x/, '').padStart(64, '0').toLowerCase();
      return `${normalizedAddress}::${rest.join('::')}`;
    };

    const keyName = normalizeTypeName(coinType);

    const content = await getDynamicFieldJsonOrNull(
      this.client,
      tableId,
      '0x1::type_name::TypeName',
      bcs.struct('TypeName', { name: bcs.string() }).serialize({ name: keyName }).toBytes(),
    );
    if (content == null) {
      return null;
    }
    return content.value;
  }

  private async listPoolRewardManagers(
    table: any,
  ): Promise<Array<{ reserveCoinType: string; manager: any }>> {
    const parentId = table?.id;
    if (!parentId) {
      return [];
    }

    const results: Array<{ reserveCoinType: string; manager: any }> = [];
    const entries: Array<{ objectId: string; reserveCoinType: string }> = [];

    let hasNextPage = true;
    let cursor: string | null | undefined = null;

    // Step 1: Collect all dynamic field entries
    while (hasNextPage) {
      const resp = await this.client.core.listDynamicFields({
        parentId,
        cursor: cursor === null || cursor === undefined ? undefined : cursor,
        limit: 50,
      });

      for (const entry of resp.dynamicFields) {
        const named = entry as { name?: { bcs?: Uint8Array } };
        let typeNameValue: string | undefined;
        if (named.name?.bcs) {
          typeNameValue = bcs.struct('TypeName', { name: bcs.string() }).parse(named.name.bcs).name;
        }
        
        const reserveCoinType = typeNameValue ? normalizeCoinType(typeNameValue) : undefined;
        if (reserveCoinType) {
          entries.push({ objectId: entry.fieldId, reserveCoinType });
        }
      }

      cursor = resp.cursor;
      hasNextPage = resp.hasNextPage;
    }

    if (entries.length === 0) {
      return results;
    }

    // Step 2: Batch fetch (Sui gRPC: objectIds + { objects } response; json on each object)
    const objectIds = entries.map((e) => e.objectId);
    const managerJsonList = await getObjectsJsonOrNull(this.client, objectIds, GET_OBJECT_INCLUDE_JSON);

    // Step 3: Process results
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const content = managerJsonList[i];
      if (!content) {
        continue;
      }

      const manager = content.value;
      if (manager) {
        results.push({ reserveCoinType: entry.reserveCoinType, manager });
      }
    }

    return results;
  }

  private async getObligationRewardManager(
    poolRewardManager: any,
    obligationId: string,
  ): Promise<any | null> {
    const obligationRmTableId = poolRewardManager?.obligation_reward_managers?.id;
    if (!obligationRmTableId) {
      return null;
    }

    const json = await getDynamicFieldJsonOrNull(
      this.client,
      obligationRmTableId,
      '0x2::object::ID',
      bcs.Address.serialize(obligationId).toBytes(),
    );
    if (!json) {
      return null;
    }
    return json.value;
  }

  private calculateClaimableRewards(
    obligationRewardManager: any,
    poolRewardManager: any,
  ): ClaimableReward[] {
    const claimableRewards: ClaimableReward[] = [];

    if (!obligationRewardManager) {
      return claimableRewards;
    }
    const obligationRewardsRaw = obligationRewardManager.rewards;

    const poolRewards = poolRewardManager.pool_rewards || [];
    const obligationShareRaw = obligationRewardManager.share || 0;
    const totalShares = poolRewardManager.total_shares || 0;
    const poolManagerLastUpdate = BigInt(poolRewardManager.last_update_time_ms || 0);
    const obligationLastUpdate = BigInt(obligationRewardManager.last_update_time_ms || 0);

    if (totalShares === 0 || obligationShareRaw === 0) {
      return claimableRewards;
    }

    const obligationShare = BigInt(obligationShareRaw);
    const totalSharesDecimal = Decimal.fromBigInt(BigInt(totalShares));
    const currentTime = BigInt(Date.now());

    for (let i = 0; i < poolRewards.length; i++) {
      const poolReward = poolRewards[i];

      if (!poolReward) {
        continue;
      }

      const optionalObligationReward = obligationRewardsRaw[i];
      const coinType = normalizeCoinType(poolReward.coin_type);

      const poolCumPerShare = this.parseDecimal(poolReward.cumulative_rewards_per_share);
      let updatedPoolCumPerShare = poolCumPerShare;

      const poolStart = BigInt(poolReward.start_time_ms || 0);
      const poolEnd = BigInt(poolReward.end_time_ms || 0);
      const poolDuration = poolEnd > poolStart ? poolEnd - poolStart : 0n;

      if (
        currentTime > poolManagerLastUpdate &&
        poolDuration > 0n &&
        BigInt(totalShares) > 0n
      ) {
        const maxStart = poolStart > poolManagerLastUpdate ? poolStart : poolManagerLastUpdate;
        const minEnd = poolEnd < currentTime ? poolEnd : currentTime;

        if (minEnd > maxStart) {
          const timePassed = minEnd - maxStart;

          if (timePassed > 0n) {
            const totalRewardsDecimal = Decimal.fromBigInt(BigInt(poolReward.total_rewards || 0));
            const durationDecimal = Decimal.fromBigInt(poolDuration);
            const timePassedDecimal = Decimal.fromBigInt(timePassed);

            const unlockedRewards = totalRewardsDecimal
              .mul(timePassedDecimal)
              .divDecimal(durationDecimal);

            const increment = unlockedRewards.divDecimal(totalSharesDecimal);
            updatedPoolCumPerShare = updatedPoolCumPerShare.add(increment);
          }
        }
      }

      let prevCumPerShare = Decimal.zero();
      let earnedRewards = Decimal.zero();

      
      if (
        optionalObligationReward != null &&
        optionalObligationReward != null &&
        optionalObligationReward.cumulative_rewards_per_share != null &&
        optionalObligationReward.earned_rewards != null
      ) {
        prevCumPerShare = this.parseDecimal(optionalObligationReward.cumulative_rewards_per_share);
        earnedRewards = this.parseDecimal(optionalObligationReward.earned_rewards);
      } else {
        // Mimic on-chain lazy initialization for missing entries
        if (obligationLastUpdate <= poolEnd) {
          if (obligationLastUpdate <= poolStart) {
            earnedRewards = updatedPoolCumPerShare.mulBigInt(obligationShare);
          } else {
            earnedRewards = Decimal.zero();
          }
          prevCumPerShare = updatedPoolCumPerShare;
        } else {
          // Obligation last update after reward ended; nothing to claim
          prevCumPerShare = updatedPoolCumPerShare;
        }
      }

      const newRewards = updatedPoolCumPerShare.sub(prevCumPerShare).mulBigInt(obligationShare);
      const totalEarnedRewards = earnedRewards.add(newRewards);

      const claimableAmount = totalEarnedRewards.floor();

      if (claimableAmount > 0n) {
        claimableRewards.push({
          coinType,
          amount: BigInt(claimableAmount),
          rewardIndex: i,
        });
      }
    }

    return claimableRewards;
  }

  private getAvailableRewardIndices(poolRewardManager: any): RewardIndex[] {
    if (!poolRewardManager.pool_rewards) {
      return [];
    }

    const poolRewards = poolRewardManager.pool_rewards;
    const availableRewards: RewardIndex[] = [];
    const currentTime = Date.now();

    for (let i = 0; i < poolRewards.length; i++) {
      const poolReward = poolRewards[i];
      if (!poolReward) {
        continue;
      }

      const coinType = normalizeCoinType(poolReward.coin_type);
      const startTime = parseInt(String(poolReward.start_time_ms)) || 0;
      const endTime = parseInt(String(poolReward.end_time_ms)) || 0;
      const totalRewards = BigInt(poolReward.total_rewards || 0);

      // Validate time values
      if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) {
        continue;
      }

      // Only include active rewards
      if (currentTime >= startTime && currentTime <= endTime) {
        availableRewards.push({
          index: i,
          coinType: coinType,
          startTimeMs: startTime,
          endTimeMs: endTime,
          totalRewards: totalRewards,
        });
      }
    }

    return availableRewards;
  }

  private async extractActiveRewards(
    poolRewardManager: any,
    currentTimeMs: number,
    reserveCoinType: string,
    priceMap?: Record<string, Decimal>,
  ): Promise<ActiveRewardSchedule[]> {
    const rewards = await this.extractRewards(poolRewardManager, currentTimeMs, reserveCoinType, priceMap, {
      activeOnly: true,
    });
    return rewards.map(({ isActive: _, ...rest }) => rest);
  }

  private async extractAllRewards(
    poolRewardManager: any,
    currentTimeMs: number,
    reserveCoinType: string,
    priceMap?: Record<string, Decimal>,
  ): Promise<RewardSchedule[]> {
    return this.extractRewards(poolRewardManager, currentTimeMs, reserveCoinType, priceMap, {
      activeOnly: false,
    });
  }

  private async extractRewards(
    poolRewardManager: any,
    currentTimeMs: number,
    reserveCoinType: string,
    priceMap?: Record<string, Decimal>,
    options?: { activeOnly: boolean },
  ): Promise<RewardSchedule[]> {
    const poolRewards = poolRewardManager.pool_rewards || [];
    const results: RewardSchedule[] = [];

    for (const poolReward of poolRewards) {
      if (!poolReward) {
        continue;
      }

      const startTime = Number(poolReward.start_time_ms || 0);
      const endTime = Number(poolReward.end_time_ms || 0);

      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
        continue;
      }

      const isActive = currentTimeMs >= startTime && currentTimeMs <= endTime;

      if (options?.activeOnly && !isActive) {
        continue;
      }

      const rewardCoinType = normalizeCoinType(poolReward.coin_type);

      const totalRewards = BigInt(poolReward.total_rewards || 0);
      const allocatedRewardsDecimal = this.parseDecimal(poolReward.allocated_rewards);
      const cumulativeRewardsPerShare = this.parseDecimal(poolReward.cumulative_rewards_per_share);
      const totalSharesRaw = poolRewardManager.total_shares || 0;

      let rewardDecimals = 9;
      let reserveDecimals = 9;
      try {
        const rewardMetadata = await getCoinMetadata(this.client, rewardCoinType);
        rewardDecimals = rewardMetadata.decimals;
      } catch {
        // Fallback to default
      }
      try {
        const reserveMetadata = await getCoinMetadata(this.client, reserveCoinType);
        reserveDecimals = reserveMetadata.decimals;
      } catch {
        // Fallback to default
      }

      const rewardPrice = this.getPriceFromMap(priceMap, rewardCoinType);
      const reservePrice = this.getPriceFromMap(priceMap, reserveCoinType);

      const apr = this.calculateRewardApr(
        totalRewards,
        BigInt(totalSharesRaw || 0),
        startTime,
        endTime,
        currentTimeMs,
        rewardDecimals,
        reserveDecimals,
        rewardPrice,
        reservePrice,
      );

      results.push({
        rewardCoinType,
        startTimeMs: startTime,
        endTimeMs: endTime,
        totalRewards,
        allocatedRewards: allocatedRewardsDecimal.floor(),
        cumulativeRewardsPerShare: cumulativeRewardsPerShare.floor(),
        apr,
        isActive,
      });
    }

    return results;
  }

  private parseDecimal(decimalValue: any): Decimal {
    if (!decimalValue) {
      return Decimal.zero();
    }

    if (decimalValue.value === undefined || decimalValue.value === null) {
      return Decimal.zero();
    }
    
    return new Decimal(BigInt(decimalValue.value));
  }


  /**
   * Get price from priceMap
   * priceMap keys are full type paths without 0x prefix (e.g., "0000...0002::sui::SUI")
   * or just 64-char hex addresses without 0x prefix
   */
  private getPriceFromMap(priceMap: Record<string, Decimal> | undefined, coinType: string): Decimal {
    if (!priceMap || !coinType) {
      return new Decimal(0n);
    }
    return priceMap[coinType];
  }

  private calculateRewardApr(
    totalRewards: bigint,
    totalShares: bigint,
    startTimeMs: number,
    endTimeMs: number,
    currentTimeMs: number,
    rewardDecimals: number = 9,
    reserveDecimals: number = 9,
    rewardPrice?: Decimal,
    reservePrice?: Decimal,
  ): number {
    if (totalRewards <= 0n || totalShares <= 0n) {
      return 0;
    }

    if (currentTimeMs < startTimeMs || currentTimeMs > endTimeMs) {
      return 0;
    }

    const durationMs = endTimeMs - startTimeMs;
    if (durationMs <= 0) {
      return 0;
    }

    // Throw error if prices are not found
    if (rewardPrice === undefined) {
      throw new Error('Reward coin price not found in priceMap');
    }
    if (reservePrice === undefined) {
      throw new Error('Reserve coin price not found in priceMap');
    }
    const msPerYear = 31536000000n; // 365 days
    const totalRewardsDecimal = Decimal.fromBigInt(totalRewards);
    const totalSharesDecimal = Decimal.fromBigInt(totalShares);
    const durationDecimal = Decimal.fromBigInt(BigInt(durationMs));
    const msPerYearDecimal = Decimal.fromBigInt(msPerYear);

    if (totalSharesDecimal.isZero() || durationDecimal.isZero()) {
      return 0;
    }

    // Adjust for decimals difference between reward coin and reserve coin (shares)
    // If rewardDecimals > reserveDecimals, we need to divide by 10^(rewardDecimals - reserveDecimals)
    // If rewardDecimals < reserveDecimals, we need to multiply by 10^(reserveDecimals - rewardDecimals)
    const decimalsDiff = rewardDecimals - reserveDecimals;
    let decimalsAdjustment = Decimal.one();
    if (decimalsDiff !== 0) {
      const adjustmentValue = BigInt(10 ** Math.abs(decimalsDiff));
      if (decimalsDiff > 0) {
        // Reward has more decimals, need to divide
        decimalsAdjustment = Decimal.fromBigInt(adjustmentValue);
      } else {
        // Reserve has more decimals, need to multiply
        decimalsAdjustment = Decimal.fromBigInt(adjustmentValue);
      }
    }

    let aprDecimal = totalRewardsDecimal
      .divDecimal(totalSharesDecimal);
    if (decimalsDiff > 0) {
      aprDecimal = aprDecimal.divDecimal(decimalsAdjustment);
    } else if (decimalsDiff < 0) {
      aprDecimal = aprDecimal.mul(decimalsAdjustment);
    }
    
    // Apply price adjustment
    // APR should be: (rewardAmount × rewardPrice) / (reserveAmount × reservePrice)
    // Calculate price ratio: (rewardPrice / reservePrice)
    const priceRatio = rewardPrice.divDecimal(reservePrice);
    // Multiply APR by price ratio
    aprDecimal = aprDecimal.mul(priceRatio);
    
    // Annualize: divide by duration and multiply by msPerYear
    aprDecimal = aprDecimal
      .divDecimal(durationDecimal)
      .mul(msPerYearDecimal);
    
    return aprDecimal.asNumber();
  }
}

