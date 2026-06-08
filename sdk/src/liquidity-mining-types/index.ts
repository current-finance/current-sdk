/**
 * Liquidity Mining Types
 */

export enum RewardType {
  Deposit = 0,
  Borrow = 1, 
}
export interface ClaimableReward {
  coinType: string;
  amount: bigint;
  rewardIndex: number;
}

export interface ClaimableRewardsResult {
  depositPool: ClaimableReward[];
  borrowPool: ClaimableReward[];
}

export interface ActiveRewardSchedule {
  rewardCoinType: string;
  startTimeMs: number;
  endTimeMs: number;
  totalRewards: bigint;
  allocatedRewards: bigint;
  cumulativeRewardsPerShare: bigint;
  apr: number;
}

export interface ActiveRewardSummary {
  rewardType: RewardType;
  reserveCoinType: string;
  rewards: ActiveRewardSchedule[];
}

export interface RewardSchedule extends ActiveRewardSchedule {
  isActive: boolean;
}

export interface RewardSummary {
  rewardType: RewardType;
  reserveCoinType: string;
  rewards: RewardSchedule[];
}

export interface ClaimableRewardsRequest {
  marketObjectId: string;
  obligationId: string;
  coinType: string; 
}

export interface ClaimableRewardsBatchRequest {
  marketObjectId: string;
  obligationId: string;
  coinTypes: string[];
}

export interface ClaimableRewardsBatchResult {
  [coinType: string]: ClaimableRewardsResult;
}

export interface RewardIndex {
  index: number;
  coinType: string;
  startTimeMs: number;
  endTimeMs: number;
  totalRewards: bigint;
}

export interface RewardIndicesResult {
  depositPool: RewardIndex[];
  borrowPool: RewardIndex[];
}

export interface ClaimRewardRequest {
  marketObjectId: string;
  marketType: string;
  obligationOwnerCapId: string;
  coinType: string; // Reserve type
  rewardType: RewardType;
  rewardIndex: number;
  rewardCoinType: string; // Reward coin type
  recipient: string;
}

export interface ClaimRewardAutoRequest {
  marketObjectId: string;
  marketType: string;
  obligationOwnerCapId: string;
  coinType: string; // Reserve type
  rewardType?: RewardType; // Optional, if not provided, claims all
  rewardCoinType?: string; // Optional, if provided, only claim this coin type
  recipient: string;
}

