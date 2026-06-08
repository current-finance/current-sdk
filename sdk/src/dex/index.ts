import { CetusAggregator } from './cetus';
import { SpringSui } from './springSui';
import { StSui } from './stSui';
import { VSui } from './vSui';
import { TransactionObjectArgument, Transaction, TransactionArgument } from '@mysten/sui/transactions';
import { Decimal, TypeName } from '../market-types';
import { LeverageError } from '../leverage-types';
import { HaSui } from './haSui';
import { ESui } from './eSui';
import { EThird } from './eThird';
import { EEarn } from './eEarn';

export { CetusAggregator, createPoolKey, getCetusPoolInfo, CETUS_POOLS } from './cetus';
export { SpringSui } from './springSui';
export { StSui } from './stSui';
export { VSui } from './vSui';
export { HaSui } from './haSui';
export { AfSui } from './afSui';
export { ESui } from './eSui';
export { EThird } from './eThird';
export { EEarn } from './eEarn';

export interface DexPoolInfo {
    poolId: string;
    leftType: string;
    rightType: string;
}

export enum TokenExchange {
    Cetus,
    Astros,
    Bluefin,
    SpringSui,
    StSui,
    VSui,
    Pebble,
    HaSui,
    AfSui,
    ESui,
    EThird,
    EEarn
}

export interface SwapIn {
    inCoinType: TypeName,
    outCoinType: TypeName,
    amountIn: bigint,
    coinId: string | TransactionObjectArgument,
    slippage: number,
    sender: string,
    minOutAmount: bigint
}

export interface SwapInOutput {
    coin: TransactionObjectArgument | TransactionArgument;
}

export interface QuoteOutput {
    dex: TokenExchange;
    amountIn: bigint;
    amountOut: bigint;
    avgPrice: Decimal;
    priceImpact: number;
}

export interface QuoteSwapIn {
    inCoinType: TypeName;
    outCoinType: TypeName;
    amountIn: bigint;
    slippage: number;
}

export function parseDexRawString(exchange: number | string): TokenExchange {
  if (exchange === 0 || exchange === '0' || exchange.toString().toLocaleLowerCase() === 'cetus') return TokenExchange.Cetus;
  if (exchange === 3 || exchange === '3' || exchange.toString().toLocaleLowerCase() === 'springsui') return TokenExchange.SpringSui;
  if (exchange === 4 || exchange === '4' || exchange.toString().toLocaleLowerCase() === 'stsui') return TokenExchange.StSui;
  if (exchange === 5 || exchange === '5' || exchange.toString().toLocaleLowerCase() === 'vsui') return TokenExchange.VSui;
  if (exchange === 6 || exchange === '6' || exchange.toString().toLocaleLowerCase() === 'pebble') return TokenExchange.Pebble;
  if (exchange === 7 || exchange === '7' || exchange.toString().toLocaleLowerCase() === 'hasui') return TokenExchange.HaSui;
  if (exchange === 8 || exchange === '8' || exchange.toString().toLocaleLowerCase() === 'afsui') return TokenExchange.AfSui;
  if (exchange === 9 || exchange === '9' || exchange.toString().toLocaleLowerCase() === 'esui') return TokenExchange.ESui;
  if (exchange === 10 || exchange === '10' || exchange.toString().toLocaleLowerCase() === 'ethird') return TokenExchange.EThird;
  if (exchange === 11 || exchange === '11' || exchange.toString().toLocaleLowerCase() === 'eearn') return TokenExchange.EEarn;
  throw new Error(`unknown exchange: ${exchange}`);
}

/// Find the best swap among all the dexes
export class BestMultiTokenExchange {
  private cetus: CetusAggregator;
  private springSui: SpringSui;
  private stSui: StSui;
  private vSui: VSui;
  private hasui: HaSui;
  private esui: ESui;
  private ethird: EThird;
  private eearn: EEarn;

  constructor(
    cetus: CetusAggregator,
    springSui: SpringSui,
    stSui: StSui,
    vSui: VSui,
    hasui: HaSui,
    esui: ESui,
    ethird: EThird,
    eearn: EEarn,
  ) {
    this.cetus = cetus;
    this.springSui = springSui;
    this.stSui = stSui;
    this.vSui = vSui;
    this.hasui = hasui;
    this.esui = esui;
    this.ethird = ethird;
    this.eearn = eearn;
  }

  public async populateSwapIn(exchange: TokenExchange, tx: Transaction, params: SwapIn): Promise<SwapInOutput> {
    switch (exchange) {
    case TokenExchange.Cetus:
      return await this.cetus.populateSwapIn(tx, params);
    case TokenExchange.SpringSui:
      return await this.springSui.populateSwapIn(tx, params);
    case TokenExchange.StSui:
      return await this.stSui.populateSwapIn(tx, params);
    case TokenExchange.VSui:
      return await this.vSui.populateSwapIn(tx, params);
    case TokenExchange.HaSui:
      return await this.hasui.populateSwapIn(tx, params);        
    case TokenExchange.ESui:
      return await this.esui.populateSwapIn(tx, params);
    case TokenExchange.EThird:
      return await this.ethird.populateSwapIn(tx, params);
    case TokenExchange.EEarn:
      return await this.eearn.populateSwapIn(tx, params);
    default:
      throw new LeverageError(`Unsupported DEX: ${exchange}`);
    }
  }
}