import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// Load .env file from examples directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '.env') });

// Initialize keypair from private key environment variable
export function getKeypair(): Ed25519Keypair {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }

  // Handle Sui private key format (suiprivkey1...)
  if (privateKey.startsWith("suiprivkey1")) {
    return Ed25519Keypair.fromSecretKey(privateKey);
  }

  // Handle hex format (with or without 0x prefix)
  const cleanPrivateKey = privateKey.startsWith("0x")
    ? privateKey.slice(2)
    : privateKey;
  return Ed25519Keypair.fromSecretKey(
    Uint8Array.from(Buffer.from(cleanPrivateKey, "hex"))
  );
}
