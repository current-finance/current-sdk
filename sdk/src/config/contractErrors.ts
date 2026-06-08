export const CONTRACT_ERRORS: { [key: string]: {[key: number]: {
      message: string,
      suggestion: string,
    } } } = {
      protocol: {
        // Version errors
        0: {
          message: 'Version mismatch',
          suggestion: 'Check protocol version compatibility',
        },

        // Admin & Asset errors (100-115)
        100: {
          message: 'Asset already set as collateral',
          suggestion: 'Asset is already configured as collateral',
        },
        101: {
          message: 'Asset not configured as collateral',
          suggestion: 'Configure asset as collateral first',
        },
        102: {
          message: 'Double support for cToken',
          suggestion: 'Remove duplicate cToken support',
        },
        103: {
          message: 'Market under circuit break',
          suggestion: 'Wait for circuit breaker to be lifted',
        },
        104: {
          message: 'Invalid parameters',
          suggestion: 'Check parameter values',
        },
        105: {
          message: 'Outflow limit reached',
          suggestion: 'Wait for limit reset or reduce amount',
        },
        106: {
          message: 'Market not found',
          suggestion: 'Check if market exists',
        },
        107: {
          message: 'Market already exists',
          suggestion: 'Use existing market',
        },
        108: {
          message: 'Invalid market',
          suggestion: 'Check market parameters',
        },
        109: {
          message: 'Reserve not enough',
          suggestion: 'Insufficient reserve balance',
        },
        110: {
          message: 'Asset already onboarded',
          suggestion: 'Asset is already added to protocol',
        },
        111: {
          message: 'Coin decimals registry already registered',
          suggestion: 'Decimals already configured for this coin',
        },
        112: {
          message: 'Borrow index not incremental',
          suggestion: 'Contact protocol administrators',
        },
        113: {
          message: 'Seize tokens amount too large',
          suggestion: 'Contact protocol administrators',
        },
        114: {
          message: 'Caller not whitelisted',
          suggestion: 'Only whitelisted addresses can perform this action',
        },
        115: {
          message: 'Caller has no permission',
          suggestion: 'Insufficient permissions for this operation',
        },

        // Lending operations (200-213)
        200: {
          message: 'Deposit paused for this asset',
          suggestion: 'Wait for deposits to be resumed or use another asset',
        },
        201: {
          message: 'Obligation not safe after operation',
          suggestion: 'Adjust amounts to maintain safe ltv',
        },
        202: {
          message: 'Withdraw paused for this asset',
          suggestion: 'Wait for withdrawals to be resumed',
        },
        203: {
          message: 'Split cToken too many times',
          suggestion: 'Reduce number of split operations',
        },
        204: {
          message: 'Obligation from different market',
          suggestion: 'Use obligation from the same market',
        },
        205: {
          message: 'Market cash reserve not enough',
          suggestion: 'Wait for more liquidity or try a smaller amount',
        },
        206: {
          message: 'Market borrow limit exceeded',
          suggestion: 'Reduce borrow amount or wait for limit reset',
        },
        207: {
          message: 'Market deposit limit exceeded',
          suggestion: 'Reduce deposit amount or wait for limit reset',
        },
        208: {
          message: 'Borrow paused for this asset',
          suggestion: 'Wait for borrows to be resumed or use another asset',
        },
        209: {
          message: 'Obligation borrow below minimum',
          suggestion: 'Increase borrow amount or close position',
        },
        210: {
          message: 'Cannot borrow collateral asset',
          suggestion: 'Choose a different asset to borrow',
        },
        211: {
          message: 'No deposit to withdraw',
          suggestion: 'Deposit collateral first',
        },
        212: {
          message: 'Cannot deposit borrowed asset',
          suggestion: 'Choose a different asset to deposit',
        },
        213: {
          message: 'Zero debt to repay',
          suggestion: 'No outstanding debt for this asset',
        },

        // Flash loan errors (400-407)
        400: {
          message: 'Zero coin amount not allowed',
          suggestion: 'Use non-zero amount',
        },
        401: {
          message: 'Flash loan not paid enough',
          suggestion: 'Include required fees in repayment',
        },
        402: {
          message: 'Flash loan fee too small',
          suggestion: 'Increase flash loan amount',
        },
        403: {
          message: 'Flash loan exceeds available cash',
          suggestion: 'Reduce flash loan amount',
        },
        404: {
          message: 'Flash loan paused for this asset',
          suggestion: 'Wait for flash loans to be resumed',
        },
        405: {
          message: 'Flash loan already ongoing',
          suggestion: 'Complete current flash loan first',
        },
        406: {
          message: 'Flash loan not ongoing',
          suggestion: 'Initiate flash loan first',
        },
        407: {
          message: 'Flash loan repayment not enough',
          suggestion: 'Ensure full repayment with fees',
        },

        // EMode errors (500-503)
        500: {
          message: 'Maximum EMode groups reached',
          suggestion: 'Cannot create more EMode groups',
        },
        501: {
          message: 'EMode group does not exist',
          suggestion: 'Create EMode group first',
        },
        502: {
          message: 'EMode group already supports this asset',
          suggestion: 'Asset already configured for this group',
        },
        503: {
          message: 'EMode group does not support this asset',
          suggestion: 'Add asset to EMode group first',
        },

        // ADL and Liquidation errors (600-607)
        600: {
          message: 'ADL has no coin',
          suggestion: 'ADL system requires coin to be configured',
        },
        601: {
          message: 'ADL already has coin',
          suggestion: 'Coin already configured in ADL system',
        },
        602: {
          message: 'ADL not activated by time',
          suggestion: 'Wait for ADL activation time',
        },
        603: {
          message: 'ADL within limit',
          suggestion: 'ADL not triggered, position within safe limits',
        },
        604: {
          message: 'ADL EMode group not found',
          suggestion: 'Configure EMode group for ADL',
        },
        605: {
          message: 'Obligation still safe, cannot liquidate',
          suggestion: 'Obligation is healthy and not liquidatable',
        },
        606: {
          message: 'Liquidation close factor exceeded',
          suggestion: 'Reduce liquidation amount',
        },
        607: {
          message: 'Cannot liquidate with zero repay',
          suggestion: 'Specify amount to repay',
        },

        // Liquidity mining errors (700-706)
        700: {
          message: 'Invalid time for liquidity mining',
          suggestion: 'Check reward period configuration',
        },
        701: {
          message: 'Invalid type for liquidity mining',
          suggestion: 'Use valid reward type',
        },
        702: {
          message: 'Maximum concurrent pool rewards violated',
          suggestion: 'Too many active reward pools',
        },
        703: {
          message: 'Not all rewards claimed',
          suggestion: 'Claim all pending rewards first',
        },
        704: {
          message: 'Pool reward period not over',
          suggestion: 'Wait for reward period to complete',
        },
        705: {
          message: 'Pool not initialized',
          suggestion: 'Initialize liquidity mining pool first',
        },
        706: {
          message: 'Pool already initialized',
          suggestion: 'Pool is already set up',
        },

        // Referral errors (800-806)
        800: {
          message: 'No rebates available',
          suggestion: 'No referral rebates to claim',
        },
        801: {
          message: 'Already has referral code',
          suggestion: 'Referral code already assigned',
        },
        802: {
          message: 'Not enough deposit for referral',
          suggestion: 'Increase deposit amount to qualify for referral',
        },
        803: {
          message: 'Invalid referral code',
          suggestion: 'Use a valid referral code',
        },
        804: {
          message: 'No referral code',
          suggestion: 'Set up referral code first',
        },
        805: {
          message: 'Referral rebate has no token',
          suggestion: 'No tokens available for rebate',
        },
        806: {
          message: 'Referral claim paused',
          suggestion: 'Wait for referral claims to be resumed',
        },
      },

      leverage: {
        // Leverage specific errors (1000001-1000016)
        1000001: {
          message: 'Market not supported',
          suggestion: 'This market is not supported for leverage operations',
        },
        1000002: {
          message: 'Obligation already has leverage position',
          suggestion: 'Close existing position first',
        },
        1000003: {
          message: 'Obligation has no leverage position',
          suggestion: 'Open a position first',
        },
        1000004: {
          message: 'Inconsistent leverage operation',
          suggestion: 'Check operation parameters',
        },
        1000005: {
          message: 'Borrow coin type mismatch',
          suggestion: 'Use correct borrow coin type',
        },
        1000006: {
          message: 'Collateral coin type mismatch',
          suggestion: 'Use correct collateral coin type',
        },
        1000007: {
          message: 'Principle not intact',
          suggestion: 'Maintain required principle amount',
        },
        1000008: {
          message: 'Cannot repay flash loan',
          suggestion: 'Ensure sufficient balance for repayment',
        },
        1000009: {
          message: 'Withdrawn too much collateral',
          suggestion: 'Reduce withdrawal amount',
        },
        1000010: {
          message: 'Withdrawn more than principle',
          suggestion: 'Cannot withdraw more than deposited principle',
        },
        1000011: {
          message: 'Market not found',
          suggestion: 'Check if leverage market exists',
        },
        1000012: {
          message: 'Version mismatch',
          suggestion: 'Check leverage contract version compatibility',
        },
        1000013: {
          message: 'Invalid market',
          suggestion: 'Check leverage market parameters',
        },
        1000014: {
          message: 'Market already exists',
          suggestion: 'Use existing leverage market',
        },
        1000015: {
          message: 'Already assigned caller cap',
          suggestion: 'Caller capability already assigned',
        },
        1000016: {
          message: 'No caller cap',
          suggestion: 'Caller capability not found',
        },
      },

      x_oracle: {
        // Oracle errors (1-5)
        1: {
          message: 'Oracle price not found',
          suggestion: 'Check if asset price feed is configured',
        },
        2: {
          message: 'Unknown oracle base token',
          suggestion: 'Configure base token for oracle',
        },
        3: {
          message: 'EMA and spot price difference too large',
          suggestion: 'Wait for price stability',
        },
        4: {
          message: 'Oracle price is stale',
          suggestion: 'Wait for price oracle to update',
        },
        5: {
          message: 'Oracle price is zero',
          suggestion: 'Wait for valid price data',
        },
      },
    };
