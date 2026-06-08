export class LeverageError extends Error {
  public readonly innerError?: Error;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options?: {
      innerError?: Error;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);

    this.name = 'LeverageError';
    this.innerError = options?.innerError;
    this.details = options?.details;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LeverageError);
    }

    // If there's an inner error, append its stack trace
    if (this.innerError && this.innerError.stack) {
      this.stack = `${this.stack}\n\nCaused by:\n${this.innerError.stack}`;
    }
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      details: this.details,
      innerError: this.innerError ? {
        name: this.innerError.name,
        message: this.innerError.message,
        stack: this.innerError.stack,
      } : undefined,
    };
  }

  public static parseLeverageError(error: Error): LeverageError | Error {
    return error;
  }

  public static exceedMarketAvailableLeverageSize(): LeverageError {
    return new LeverageError('Exceed lending market liquidity');
  }
}