import { CONTRACT_ERRORS } from '../config/contractErrors';
import { NETWORK_CONFIGS } from '../config/networks';

interface SuiRpcError {
  code: number;
  message: string;
  data?: any;
}

// ============================================
// Parse Transaction Execution Errors
// ============================================

export class SuiTransactionErrorParser {
  /**
   * Parse errors from signAndExecuteTransaction
   */
  static parseTransactionError(
    error: unknown,
  ): {
    errorType: string;
    message: string;
    details?: any;
    suggestion?: string;
  } {
    // Convert to any for easier access
    const e = error as any;
    
    // Check if it's a string error
    if (typeof error === 'string') {
      return this.parseErrorString(error);
    }

    // Check for RPC errors
    if (e?.code && e?.message) {
      return this.parseRpcError(e);
    }
    
    // Check for execution errors in response
    if (e?.cause?.data?.execution_errors) {
      return this.parseExecutionErrors(e.cause.data.execution_errors);
    }
    
    if (e?.cause?.effects?.abortError) {
      return this.parseAbortError(e?.cause?.effects?.abortError);
    }

    // Check for status in effects
    if (e?.effects?.status?.status === 'failure') {
      return this.parseEffectsError(e.effects.status);
    }

    // Check error message for specific patterns
    if (e?.message) {
      return this.parseErrorMessage(e.message);
    }
    
    // Default parsing
    return {
      errorType: 'UnknownError',
      message: e?.message || String(error),
      details: e,
    };
  }

  /**
   * Parse specific error messages
   */
  private static parseErrorMessage(message: string): {
    errorType: string;
    message: string;
    suggestion?: string;
  } {
    // Gas errors
    if (message.includes('InsufficientGas')) {
      return {
        errorType: 'InsufficientGas',
        message: 'Transaction ran out of gas',
        suggestion: 'Increase gas budget in transaction',
      };
    }
    
    // Balance errors
    if (message.includes('InsufficientCoinBalance') || 
        message.includes('insufficient balance')) {
      return {
        errorType: 'InsufficientBalance',
        message: 'Insufficient balance to complete transaction',
        suggestion: 'Ensure account has enough SUI for gas and transaction',
      };
    }
    
    // Object errors
    if (message.includes('ObjectNotFound')) {
      const match = message.match(/Object (\w+) does not exist/);
      return {
        errorType: 'ObjectNotFound',
        message: `Object not found: ${match?.[1] || 'unknown'}`,
        suggestion: 'Verify object ID exists and is accessible',
      };
    }

    // Move abort
    if (message.includes('MoveAbort')) {
      const match = message.match(/MoveAbort.*code:\s*(\d+)/);
      return {
        errorType: 'MoveAbort',
        message: `Move execution aborted with code: ${match?.[1] || 'unknown'}`,
        suggestion: 'Check Move contract abort codes',
      };
    }

    return {
      errorType: 'GeneralError',
      message: message,
    };
  }

  /**
   * Parse RPC errors
   */
  private static parseRpcError(error: SuiRpcError): {
    errorType: string;
    message: string;
    details?: any;
    suggestion?: string;
  } {
    const errorMap: Record<string, { type: string; suggestion: string }> = {
      '-32700': { type: 'ParseError', suggestion: 'Invalid JSON in request' },
      '-32600': { type: 'InvalidRequest', suggestion: 'Check request format' },
      '-32601': { type: 'MethodNotFound', suggestion: 'Check API method name' },
      '-32602': { type: 'InvalidParams', suggestion: 'Check parameter types' },
      '-32603': { type: 'InternalError', suggestion: 'Retry or contact support' },
      '-32000': { type: 'ServerError', suggestion: 'Check node connection' },
    };
    
    const errorInfo = errorMap[error.code.toString()] || { 
      type: 'RpcError', 
      suggestion: 'Check RPC connection', 
    };
    
    return {
      errorType: errorInfo.type,
      message: error.message,
      details: error.data,
      suggestion: errorInfo.suggestion,
    };
  }

  /**
   * Parse execution errors array
   */
  private static parseExecutionErrors(errors: string[]): {
    errorType: string;
    message: string;
    details?: any;
    suggestion?: string;
  } {
    if (errors.length === 0) {
      return {
        errorType: 'ExecutionError',
        message: 'Unknown execution error',
      };
    }
    
    // Parse first error for type
    const firstError = errors[0];
    const parsed = this.parseErrorMessage(firstError);
    
    return {
      ...parsed,
      details: errors.length > 1 ? errors : undefined,
    };
  }

  /**
   * Parse effects status error
   */
  private static parseEffectsError(status: any): {
    errorType: string;
    message: string;
    details?: any;
    suggestion?: string;
  } {
    return {
      errorType: 'TransactionFailed',
      message: status.error || 'Transaction execution failed',
      details: status,
      suggestion: 'Check transaction effects for details',
    };
  }

  /**
   * Parse error string
   */
  private static parseErrorString(error: string): {
    errorType: string;
    message: string;
    suggestion?: string;
  } {
    return this.parseErrorMessage(error);
  }

  /**
   * Parse Move abort errors with module_id and error_code
   * Maps module_id to package name and looks up error in CONTRACT_ERRORS
   */
  private static parseAbortError(error: {module_id: string, function: string, error_code: number}): {
    errorType: string;
    message: string;
    suggestion?: string;
    details?: any;
  } {
    // Extract package ID from module_id (format: "package_id::module_name")
    const packageIdMatch = error.module_id.match(/^(0x[a-fA-F0-9]+)::/);

    if (!packageIdMatch) {
      // If format doesn't match, return original error
      return {
        errorType: 'MoveAbort',
        message: `Move abort in ${error.module_id}::${error.function} with code ${error.error_code}`,
        details: error,
      };
    }

    const packageId = packageIdMatch[1];

    // Try to map package ID to our known packages
    let packageName: string | null = null;

    // Check against all known networks
    for (const [_, config] of Object.entries(NETWORK_CONFIGS)) {
      // Check if it matches protocol package
      if (config.protocolPackageId === packageId) {
        packageName = 'protocol';
        break;
      }

      if (config.xOraclePackageId === packageId) {
        packageName = 'x_oracle';
        break;
      }

      if (config.leveragePackageId === packageId) {
        packageName = 'leverage';
        break;
      }
    }

    // If we found a matching package, look up the error
    if (packageName && CONTRACT_ERRORS[packageName]) {
      const errorInfo = CONTRACT_ERRORS[packageName][error.error_code];

      if (errorInfo) {
        return {
          errorType: 'MoveAbort',
          message: errorInfo.message,
          suggestion: errorInfo.suggestion,
          details: {
            package: packageName,
            module: error.module_id,
            function: error.function,
            code: error.error_code,
          },
        };
      }
    }

    // If not found or not our package, return original error with context
    return {
      errorType: 'MoveAbort',
      message: `Move abort in ${error.module_id}::${error.function} with code ${error.error_code}`,
      details: error,
    };
  }
}