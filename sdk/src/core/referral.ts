import { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { normalizeSuiAddress, normalizeStructTag } from '@mysten/sui/utils';
import { TypeName } from '../market-types';
import { getDynamicFieldJsonOrNull } from '../utils/object-utils';
import { simulateTransactionChecked } from '../utils/transaction-utils';

export interface ReferralRebates {
  coinTypes: TypeName[];
  amounts: bigint[];
}

export interface ReferrerLookupResult {
  isAvailable: boolean;
  owner: string | null;
}

/** Fields of the on-chain `ReferralKey` we read — each is a `Table` ({ id }). */
interface RawReferralKey {
  code_owner?: { id?: string };
  referee_to_code?: { id?: string };
  accumulated_deposit_only_usd?: { id?: string };
}

export class ReferralClient {
  private client: SuiClient;
  private protocolPackageId: string;
  private protocolAppId: string;

  constructor(client: SuiClient, protocolPackageId: string, protocolAppId: string) {
    this.client = client;
    this.protocolPackageId = protocolPackageId;
    this.protocolAppId = protocolAppId;
  }


  private async getReferralKeyFields(): Promise<RawReferralKey | undefined> {
    const referralKeyType = `0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::app::ReferralKey`;
    const json = await getDynamicFieldJsonOrNull<{ value: RawReferralKey }>(
      this.client,
      this.protocolAppId,
      referralKeyType,
      bcs.struct('Key', { dummy_field: bcs.bool() }).serialize({ dummy_field: false }).toBytes(),
    );
    return json?.value;
  }

  // =================== Getter Methods (using devInspect) ===================

  /**
   * Check if a user can generate a referral code
   */
  public async canGenerateReferralCode(address: string): Promise<boolean> {
    const tx = new Transaction();

    tx.moveCall({
      target: `${this.protocolPackageId}::user_rebates::can_generate_referral_code`,
      arguments: [
        tx.object(this.protocolAppId),
        tx.pure.address(address),
      ],
      typeArguments: [],
    });

    tx.setSenderIfNotSet('0x0000000000000000000000000000000000000000000000000000000000000000');
    const result = await simulateTransactionChecked(this.client, tx, false);

    if (!result.commandResults?.length) {
      throw new Error('No results from can_generate_referral_code query');
    }

    const returnValues = result.commandResults[0].returnValues;
    if (!returnValues || returnValues.length === 0) {
      throw new Error('No return values from can_generate_referral_code query');
    }

    return bcs.bool().parse(new Uint8Array(returnValues[0].bcs));
  }

  /**
   * Check if a user has a referral code
   */
  public async hasReferralCode(address: string): Promise<boolean> {
    const tx = new Transaction();

    tx.moveCall({
      target: `${this.protocolPackageId}::user_rebates::has_referral_code`,
      arguments: [
        tx.object(this.protocolAppId),
        tx.pure.address(address),
      ],
      typeArguments: [],
    });

    tx.setSenderIfNotSet('0x0000000000000000000000000000000000000000000000000000000000000000');
    const result = await simulateTransactionChecked(this.client, tx, false);

    if (!result.commandResults?.length) {
      throw new Error('No results from has_referral_code query');
    }

    const returnValues = result.commandResults[0].returnValues;
    if (!returnValues || returnValues.length === 0) {
      throw new Error('No return values from has_referral_code query');
    }

    return bcs.bool().parse(new Uint8Array(returnValues[0].bcs));
  }

  /**
   * Get a user's referral code
   */
  public async getReferralCode(address: string): Promise<string> {
    const tx = new Transaction();

    tx.moveCall({
      target: `${this.protocolPackageId}::user_rebates::get_referral_code`,
      arguments: [
        tx.object(this.protocolAppId),
        tx.pure.address(address),
      ],
      typeArguments: [],
    });

    tx.setSenderIfNotSet('0x0000000000000000000000000000000000000000000000000000000000000000');
    const result = await simulateTransactionChecked(this.client, tx, false);

    if (!result.commandResults?.length) {
      throw new Error('No results from get_referral_code query');
    }

    const returnValues = result.commandResults[0].returnValues;
    if (!returnValues || returnValues.length === 0) {
      throw new Error('No return values from get_referral_code query');
    }

    return bcs.string().parse(new Uint8Array(returnValues[0].bcs));
  }

  /**
   * Get a user's referral rebates
   */
  public async getReferralRebates(address: string): Promise<ReferralRebates> {
    const tx = new Transaction();

    tx.moveCall({
      target: `${this.protocolPackageId}::user_rebates::get_referral_rebates`,
      arguments: [
        tx.object(this.protocolAppId),
        tx.pure.address(address),
      ],
      typeArguments: [],
    });

    tx.setSenderIfNotSet('0x0000000000000000000000000000000000000000000000000000000000000000');
    const result = await simulateTransactionChecked(this.client, tx, false);

    if (!result.commandResults?.length) {
      throw new Error('No results from get_referral_rebates query');
    }

    const returnValues = result.commandResults[0].returnValues;
    if (!returnValues || returnValues.length < 2) {
      throw new Error('No return values from get_referral_rebates query');
    }

    // Parse vector<TypeName> (vector<string>)
    const coinTypes = bcs.vector(bcs.string()).parse(new Uint8Array(returnValues[0].bcs));

    // Parse vector<u64> and convert to bigint
    const amountsParsed = bcs.vector(bcs.u64()).parse(new Uint8Array(returnValues[1].bcs));
    const amounts = amountsParsed.map((amount) => BigInt(amount));

    return {
      coinTypes,
      amounts,
    };
  }

  /* Get the referral code that is linked to a given address */
  public async getLinkedReferralCode(address: string): Promise<string| null> {
    
    const rf = await this.getReferralKeyFields();
    const tableId = rf?.referee_to_code?.id;
    if (!tableId) {
      return null;
    }

    const entryJson = await getDynamicFieldJsonOrNull<{ value: string }>(
      this.client,
      tableId,
      'address',
      bcs.Address.serialize(normalizeSuiAddress(address)).toBytes(),
    );
    if (!entryJson) {
      return null;
    }
    return entryJson.value || null;
  }

  /**
   * Get the accumulated USD value of flash loans (deposits) for an address.
  */
  public async getAccumulatedDepositUsd(address: string): Promise<bigint> {
    const rf = await this.getReferralKeyFields();

    const tableId = rf?.accumulated_deposit_only_usd?.id;
    if (!tableId) {
      throw new Error('Failed to get accumulated deposit USD by address');
    }

    // An address that has never accumulated a referred deposit simply has no entry in the table, so
    // there's no dynamic field object to read. That's not an error — it's a zero balance. Use the
    // OrNull lookup (like getLinkedReferralCode above) and fall back to 0 instead of throwing
    // "Object ... not found".
    const entryJson = await getDynamicFieldJsonOrNull<{ value: string }>(
      this.client,
      tableId,
      'address',
      bcs.Address.serialize(normalizeSuiAddress(address)).toBytes(),
    );
    return BigInt(entryJson?.value ?? '0');
  }

  public async getReferrerAddressForReferralCode(referralCode: string): Promise<ReferrerLookupResult> {
    const unavailable = (): ReferrerLookupResult => ({ isAvailable: false, owner: null });

    const code = referralCode.trim();
    if (!code) {
      return unavailable();
    }

    const rf = await this.getReferralKeyFields();

    const tableId = rf?.code_owner?.id;
    if (!tableId) {
      return unavailable();
    }

    try {
      const entryJson = await getDynamicFieldJsonOrNull(
        this.client,
        tableId,
        '0x1::string::String',
        bcs.string().serialize(code).toBytes(),
      );
      if (!entryJson) {
        return unavailable();
      }
      const addr = entryJson.value;
      if (!addr) {
        return unavailable();
      }
      return { isAvailable: true, owner: normalizeSuiAddress(addr) };
    } catch {
      return unavailable();
    }
  }

  // =================== Transaction Methods (populate* style) ===================

  /**
   * Populate transaction to generate a referral code
   */
  public populateGenerateReferralCode(tx: Transaction): void {
    tx.moveCall({
      target: `${this.protocolPackageId}::user_rebates::generate_referral_code`,
      arguments: [
        tx.object(this.protocolAppId),
        tx.object('0x8'), // Random object
      ],
      typeArguments: [],
    });
  }

  /**
   * Populate transaction to claim referral rebates for a specific coin type
   * Note: The claimed coins are automatically transferred to the transaction sender
   */
  public populateClaimReferralRebates<CoinType extends TypeName>(
    tx: Transaction,
    coinType: CoinType,
  ): void {
    tx.moveCall({
      target: `${this.protocolPackageId}::user_rebates::claim_referral_rebates`,
      arguments: [
        tx.object(this.protocolAppId),
      ],
      typeArguments: [normalizeStructTag(coinType)],
    });
  }
}
