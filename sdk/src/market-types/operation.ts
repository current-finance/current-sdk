import { Decimal } from './decimal';
import { TypeName } from './assets';

export enum OperationName {
  Deposit = 'deposit',
  Withdraw = 'withdraw',
  Borrow = 'borrow',
  Repay = 'repay'
}

export class Operation {
  constructor(
    public name: OperationName,
    public assetType: TypeName,
    public amount: Decimal,
  ) {}

  static from(name: OperationName, assetType: TypeName, amount: Decimal): Operation {
    return new Operation(name, assetType, amount);
  }
}