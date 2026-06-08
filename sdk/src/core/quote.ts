import axios, { AxiosInstance, AxiosError } from 'axios';
import { Decimal, TypeName } from '../market-types';
import { TokenExchange, IncreaseOperationType, parseDexRawString } from '..';
import { LeverageError } from '../leverage-types/errors';

export interface TokenExchangeQuote {
  priceImpact: number;
  exchange: TokenExchange;
  exchangePrice: Decimal;
}

export type TokenPairId = number;

/**
 * Configuration for the Quote client
 */
export interface QuoteClientConfig {
  /** Base URL for the protocol server */
  baseUrl: string;
  /** Optional timeout in milliseconds */
  timeout?: number;
}

/**
 * Request/Response types based on protocol-server DTOs
 */

// Open Leverage
export interface OpenLeverageRequest {
  leverageMarketId: number;
  tokenPairId: TokenPairId;
  isLong: boolean;
  inputCoin: boolean;
  amount: string;
  leverage: number;
  swapSlippage: number;
  hasPos?: boolean;
}

// Raw response from API
interface RawLeverageOperationResponse {
  dexQuote: {
    dex: string;
    dexPrice: string;
    priceImpact: string;
  };
  operation: {
    optType: number;
    totalCollateral: string;
    totalDebt: string;
    totalLeveragedDebt: string;
    collateralCoin: string,
    borrowCoin: string,
  };
}

export interface LeverageIncreaseParams {
  totalCollateral: bigint;
  totalDebt: bigint;
  totalLeveragedDebt: bigint;
  optType: IncreaseOperationType;
  collateralCoin: TypeName,
  borrowCoin: TypeName,
}

export interface LeverageOperationResponse {
  dexQuote: TokenExchangeQuote;
  operation: LeverageIncreaseParams;
}

// Increase Size (same request as Open)
export interface IncreaseSizeRequest {
  leverageMarketId: number;
  tokenPairId: string;
  isLong: boolean;
  inputCoin: boolean;
  amount: string;
  leverage: number;
  swapSlippage: number;
}

// Max Leverage (Open)
export interface MaxLeverageOpenRequestInner {
  leverageMarketId: number;
  tokenPairId: TokenPairId;
  isLong: boolean;
  inputCoin: boolean;
  swapSlippage: number;
}

export interface MaxLeverageOpenRequest {
  reqs: MaxLeverageOpenRequestInner[];
}

// Current Position type
export interface CurrentPosition {
  collateralAmount: bigint;
  borrowAmount: bigint;
}

// Increase Leverage
export interface IncreaseLeverageRequest {
  leverageMarketId: number;
  tokenPairId: TokenPairId;
  collateral: boolean;
  currentPosition: CurrentPosition;
  swapSlippage: number;
  toLeverage: number;
}

// Raw response from API
interface RawIncreaseLeverageResponse {
  dexQuote: {
    dex: string;
    dexPrice: string;
    priceImpact: string;
  };
  operation: {
    totalCollateral: string;
    totalDebt: string;
  };
}

interface IncreaseLeverageResponse {
  dexQuote: TokenExchangeQuote;
  operation: {
    totalCollateral: bigint;
    totalDebt: bigint;
  };
}

// Max Leverage (Increase)
export interface MaxLeverageIncreaseRequest {
  positions: Array<{
    leverageMarketId: number;
    tokenPairId: TokenPairId;
    collateral: boolean;
    currentPosition: CurrentPosition;
    swapSlippage: number;
  }>;
}

// Reduce Leverage
export interface ReduceLeverageRequest {
  leverageMarketId: number;
  tokenPairId: TokenPairId;
  collateral: TypeName;
  currentPosition: CurrentPosition;
  toLeverage: number;
  swapSlippage: number;
}

// Raw response from API
interface RawReduceLeverageResponse {
  dexQuote: {
    dex: string;
    dexPrice: string;
    priceImpact: string;
  };
  operation: {
    collateralWithdraw: string;
    borrowRepay: string;
    borrowSwapOut: string;
  };
}

export interface ReduceLeverageResponse {
  dexQuote: TokenExchangeQuote;
  operation: ReduceOperationParams;
}

// Reduce Size
export interface ReduceSizeRequest {
  leverageMarketId: number;
  tokenPairId: TokenPairId;
  collateral: TypeName;
  currentPosition: CurrentPosition;
  percentage: number;
  swapSlippage: number;
}

// Raw response from API
interface RawReduceSizeResponse {
  dexQuote: {
    dex: string;
    dexPrice: string;
    priceImpact: string;
  };
  operation: {
    collateralWithdraw: string;
    borrowRepay: string;
    borrowSwapOut: string;
    swapInAmount: string;
  };
}

export interface ReduceOperationParams {
  collateralWithdraw: bigint;
  borrowRepay: bigint;
  borrowSwapOut: bigint;
  swapInAmount: bigint;
}

export interface ReduceSizeResponse {
  dexQuote: TokenExchangeQuote | undefined;
  operation: ReduceOperationParams;
}

/**
 * Quote client for interacting with the protocol server leverage routes
 */
export class QuoteClient {
  private client: AxiosInstance;

  constructor(config: QuoteClientConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Quote opening a leverage position
   */
  @catchQuoteError()
  async openLeverage(request: OpenLeverageRequest): Promise<LeverageOperationResponse> {
    const response = await this.client.post<RawLeverageOperationResponse>(
      '/api/leverage/open',
      request,
    );

    return {
      dexQuote: parseRawDexQuote(response.data.dexQuote),
      operation: {
        optType: response.data.operation.optType === 0 ? IncreaseOperationType.BorrowSwap : IncreaseOperationType.SwapBorrow,
        totalCollateral: BigInt(response.data.operation.totalCollateral),
        totalDebt: BigInt(response.data.operation.totalDebt),
        totalLeveragedDebt: BigInt(response.data.operation.totalLeveragedDebt),
        collateralCoin: response.data.operation.collateralCoin,
        borrowCoin: response.data.operation.borrowCoin,
      },
    };
  }

  /**
   * Quote increasing position size
   */
  @catchQuoteError()
  async increaseSize(request: IncreaseSizeRequest): Promise<LeverageOperationResponse> {
    const response = await this.client.post<RawLeverageOperationResponse>(
      '/api/leverage/size/increase',
      request,
    );
    return {
      dexQuote: parseRawDexQuote(response.data.dexQuote),
      operation: {
        optType: response.data.operation.optType === 0 ? IncreaseOperationType.BorrowSwap : IncreaseOperationType.SwapBorrow,
        totalCollateral: BigInt(response.data.operation.totalCollateral),
        totalDebt: BigInt(response.data.operation.totalDebt),
        totalLeveragedDebt: BigInt(response.data.operation.totalDebt),
        collateralCoin: response.data.operation.collateralCoin,
        borrowCoin: response.data.operation.borrowCoin,
      },
    };
  }

  /**
   * Get maximum leverage for opening a position
   */
  @catchQuoteError()
  async maxLeverageOpen(request: MaxLeverageOpenRequest): Promise<number[]> {
    const response = await this.client.post<string[]>(
      '/api/leverage/max',
      request,
    );
    // Parse string array to number array (API returns number strings or error strings)
    return response.data.map(s => parseFloat(s));
  }

  /**
   * Quote increasing leverage on existing position
   */
  @catchQuoteError()
  async increaseLeverage(request: IncreaseLeverageRequest): Promise<IncreaseLeverageResponse> {
    const response = await this.client.post<RawIncreaseLeverageResponse>(
      '/api/leverage/leverage/increase',
      {
        ...request,
        currentPosition: {
          collateralAmount: request.currentPosition.collateralAmount.toString(),
          borrowAmount: request.currentPosition.borrowAmount.toString(),
        },
      },
    );
    return {
      dexQuote: parseRawDexQuote(response.data.dexQuote),
      operation: {
        totalCollateral: BigInt(response.data.operation.totalCollateral),
        totalDebt: BigInt(response.data.operation.totalDebt),
      },
    };
  }

  /**
   * Get maximum leverage for existing positions
   */
  @catchQuoteError()
  async maxLeverageIncrease(request: MaxLeverageIncreaseRequest): Promise<string[]> {
    const response = await this.client.post<string[]>(
      '/api/leverage/leverage/max',
      {
        positions: request.positions.map(pos => ({
          ...pos,
          currentPosition: {
            collateralAmount: pos.currentPosition.collateralAmount.toString(),
            borrowAmount: pos.currentPosition.borrowAmount.toString(),
          },
        })),
      },
    );
    return response.data;
  }

  /**
   * Quote reducing leverage (repay borrow)
   */
  @catchQuoteError()
  async reduceLeverageToBorrow(request: ReduceLeverageRequest): Promise<ReduceLeverageResponse> {
    const response = await this.client.post<RawReduceLeverageResponse>(
      '/api/leverage/reduce-leverage/borrow',
      {
        ...request,
        currentPosition: {
          collateralAmount: request.currentPosition.collateralAmount.toString(),
          borrowAmount: request.currentPosition.borrowAmount.toString(),
        },
      },
    );
    return {
      dexQuote: parseRawDexQuote(response.data.dexQuote),
      operation: {
        collateralWithdraw: BigInt(response.data.operation.collateralWithdraw),
        borrowRepay: BigInt(response.data.operation.borrowRepay),
        borrowSwapOut: BigInt(response.data.operation.borrowSwapOut),
        swapInAmount: BigInt(response.data.operation.collateralWithdraw),
      },
    };
  }

  /**
   * Quote reducing leverage (withdraw collateral)
   */
  @catchQuoteError()
  async reduceLeverageToCollateral(request: ReduceLeverageRequest): Promise<ReduceLeverageResponse> {
    const response = await this.client.post<RawReduceLeverageResponse>(
      '/api/leverage/reduce-leverage/collateral',
      {
        ...request,
        currentPosition: {
          collateralAmount: request.currentPosition.collateralAmount.toString(),
          borrowAmount: request.currentPosition.borrowAmount.toString(),
        },
      },
    );
    return {
      dexQuote: parseRawDexQuote(response.data.dexQuote),
      operation: {
        collateralWithdraw: BigInt(response.data.operation.collateralWithdraw),
        borrowRepay: BigInt(response.data.operation.borrowRepay),
        borrowSwapOut: BigInt(response.data.operation.borrowSwapOut),
        swapInAmount: BigInt(response.data.operation.collateralWithdraw),
      },
    };
  }

  /**
   * Quote reducing size (repay borrow)
   */
  @catchQuoteError()
  async reduceSizeToBorrow(request: ReduceSizeRequest): Promise<ReduceSizeResponse> {
    const response = await this.client.post<RawReduceSizeResponse>(
      '/api/leverage/reduce-size/borrow',
      {
        ...request,
        currentPosition: {
          collateralAmount: request.currentPosition.collateralAmount.toString(),
          borrowAmount: request.currentPosition.borrowAmount.toString(),
        },
      },
    );
    return {
      dexQuote: parseRawDexQuote(response.data.dexQuote),
      operation: {
        collateralWithdraw: BigInt(response.data.operation.collateralWithdraw),
        borrowRepay: BigInt(response.data.operation.borrowRepay),
        borrowSwapOut: BigInt(response.data.operation.borrowSwapOut),
        swapInAmount: BigInt(response.data.operation.swapInAmount),
      },
    };
  }

  /**
   * Quote reducing size (withdraw collateral)
   */
  @catchQuoteError()
  async reduceSizeToCollateral(request: ReduceSizeRequest): Promise<ReduceSizeResponse> {
    const response = await this.client.post<RawReduceSizeResponse>(
      '/api/leverage/reduce-size/collateral',
      {
        ...request,
        currentPosition: {
          collateralAmount: request.currentPosition.collateralAmount.toString(),
          borrowAmount: request.currentPosition.borrowAmount.toString(),
        },
      },
    );
    return {
      dexQuote: parseRawDexQuote(response.data.dexQuote),
      operation: {
        collateralWithdraw: BigInt(response.data.operation.collateralWithdraw),
        borrowRepay: BigInt(response.data.operation.borrowRepay),
        borrowSwapOut: BigInt(response.data.operation.borrowSwapOut),
        swapInAmount: BigInt(response.data.operation.swapInAmount),
      },
    };
  }

  /**
   * Quote a DEX swap (input amount specified)
   */
  @catchQuoteError()
  async quoteDexSwapIn(request: QuoteDexSwapInRequest): Promise<TokenExchangeQuote> {
    const response = await this.client.post<{
      dex: string;
      dexPrice: string;
      priceImpact: string;
    }>(
      '/api/quote',
      {
        inputCoin: request.inputCoin,
        inputAmount: request.inputAmount.toString(),
        outputCoin: request.outputCoin,
        swapSlippage: request.swapSlippage,
      },
    );
    return parseRawDexQuote(response.data);
  }
}

/**
 * Quote DEX swap request
 */
export interface QuoteDexSwapInRequest {
  inputCoin: TypeName;
  inputAmount: bigint;
  outputCoin: TypeName;
  swapSlippage: number;
}

function parseRawDexQuote(raw: {dex: string; dexPrice: string; priceImpact: string;}): TokenExchangeQuote {
  return {
    exchange: parseDexRawString(raw.dex),
    exchangePrice: Decimal.fromString(raw.dexPrice),
    priceImpact: parseFloat(raw.priceImpact),
  };
}

function handleQuoteError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    if (axiosError.response?.status === 400) {
      const responseData = axiosError.response?.data as { message?: string } | null | undefined;
      const message = responseData?.message || axiosError.message;
      throw new LeverageError(message, {
        innerError: error,
        details: {
          status: 400,
          data: axiosError.response?.data,
        },
      });
    }
  }
  throw error;
}

function catchQuoteError() {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        handleQuoteError(error);
      }
    };

    return descriptor;
  };
}