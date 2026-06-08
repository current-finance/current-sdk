import { Keypair } from '@mysten/sui/cryptography';

export * from './decimal';
export * from './assets';
export * from './market';
export * from './obligation';
export * from './operation';
export * from './errors';

// Signer types for executeTransaction method
export interface WalletAdapter {
  toSuiAddress: () => string;
  signAndExecuteTransaction: (transaction: any) => Promise<any>;
}

export type Signer = Keypair | WalletAdapter;