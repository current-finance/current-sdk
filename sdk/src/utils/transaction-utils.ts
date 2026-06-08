import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { Signer } from '../market-types';
import { Transaction } from '@mysten/sui/transactions';

const NORMALIZED_SUI_TYPE = '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

const potentialSuiTypes = new Set([
  '0x2::sui::SUI',
  '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
]);

export function normalizeCoinType(coinType: string): string {
  if (isSuiCoinType(coinType)) {
    return NORMALIZED_SUI_TYPE;
  }
  return coinType.startsWith('0x') ? coinType.slice(2) : coinType;
}

export function typeNameWithout0x(typeName: string): string {
  return typeName.startsWith('0x') ? typeName.slice(2) : typeName;
}

export function getSender(signer: Signer): string {
  return 'getPublicKey' in signer ? signer.getPublicKey().toSuiAddress() : signer.toSuiAddress();
}

export async function simulateTransactionChecked(
  client: SuiClient,
  transaction: Transaction,
  checksEnabled?: boolean,
) {
  const simulated = await client.simulateTransaction({
    transaction,
    include: { commandResults: true } as const,
    ...(checksEnabled !== undefined ? { checksEnabled } : {}),
  });
  if (simulated.$kind === 'FailedTransaction') {
    throw new Error('txn most likely to fail');
  }
  return simulated;
}

export async function waitForTransaction(
  client: SuiClient,
  digest: string,
  timeoutMs: number = 30000,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await client.waitForTransaction({ digest });
      return;
    } catch (error) {
      // Continue waiting if transaction is not found yet
      if (Date.now() - startTime >= timeoutMs) {
        throw new Error(
          `Transaction confirmation timeout: ${digest} with inner error: ${error}`,
        );
      }
      // Wait a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export function isSuiCoinType(coinType: string): boolean {
  return potentialSuiTypes.has(coinType);
}

export function isUnderlyingCoinType(inCoinType: string, underlyingCoinType: string): boolean {
  return normalizeCoinType(inCoinType) === normalizeCoinType(underlyingCoinType);
}
