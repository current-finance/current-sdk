import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { bcs } from '@mysten/sui/bcs';
import { blake2b } from '@noble/hashes/blake2.js';
import { getObjectTypeBcsOrThrow } from './object-utils';

export async function getPackageDigest(
  provider: SuiGrpcClient,
  packageId: string,
): Promise<Uint8Array> {
  const { type, objectBcs } = await getObjectTypeBcsOrThrow(provider, packageId);

  if (type !== 'package') {
    throw new Error('Object isn\'t a package.');
  }

  const parsed = bcs.Object.parse(objectBcs);
  const movePackage = parsed.data.Package;
  if (!movePackage) {
    throw new Error('Object isn\'t a package.');
  }

  const { moduleMap, linkageTable } = movePackage;

  const sortedModuleNames = [...moduleMap.keys()].sort();
  const moduleDigests: Uint8Array[] = [];
  for (const moduleName of sortedModuleNames) {
    const moduleBytes = moduleMap.get(moduleName);
    if (!moduleBytes) continue;
    moduleDigests.push(blake2b(moduleBytes, { dkLen: 32 }));
  }

  const dependencyIds: Uint8Array[] = [];
  for (const upgradeInfo of linkageTable.values()) {
    const hexStr = upgradeInfo.upgradedId.replace(/^0x/, '');
    const idBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      idBytes[i] = parseInt(hexStr.substring(i * 2, i * 2 + 2), 16);
    }
    dependencyIds.push(idBytes);
  }

  const components: Uint8Array[] = [...moduleDigests, ...dependencyIds];

  components.sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        return a[i] - b[i];
      }
    }
    return a.length - b.length;
  });

  const totalLength = components.reduce((sum, comp) => sum + comp.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const comp of components) {
    combined.set(comp, offset);
    offset += comp.length;
  }

  return blake2b(combined, { dkLen: 32 });
}
