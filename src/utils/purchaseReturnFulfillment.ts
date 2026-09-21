import type {
  PurchaseReturn,
  PurchaseReturnFulfillmentStatus,
  PurchaseReturnItem,
} from '../types';

export type PurchaseReturnOutcome = NonNullable<PurchaseReturnItem['returnOutcome']>;

/** Older returns deducted stock on create and have no outcome fields. */
export function isLegacyPurchaseReturn(ret: Pick<PurchaseReturn, 'fulfillmentStatus' | 'items'>): boolean {
  if (ret.fulfillmentStatus) return false;
  return !(ret.items || []).some(
    (item) => item.returnOutcome != null || item.stockDeducted != null
  );
}

export function itemReturnOutcome(
  item: PurchaseReturnItem,
  ret?: Pick<PurchaseReturn, 'fulfillmentStatus' | 'items'>
): PurchaseReturnOutcome {
  if (item.returnOutcome === 'returned' || item.returnOutcome === 'not_returned' || item.returnOutcome === 'pending') {
    return item.returnOutcome;
  }
  if (item.stockDeducted === true) return 'returned';
  if (ret && isLegacyPurchaseReturn(ret)) return 'returned';
  return 'pending';
}

export function derivePurchaseReturnFulfillmentStatus(
  items: PurchaseReturnItem[],
  ret?: Pick<PurchaseReturn, 'fulfillmentStatus' | 'items'>
): PurchaseReturnFulfillmentStatus {
  const outcomes = (items || []).map((item) => itemReturnOutcome(item, ret));
  if (!outcomes.length) return 'pending';
  const pending = outcomes.filter((o) => o === 'pending').length;
  const returned = outcomes.filter((o) => o === 'returned').length;
  if (pending === 0) return 'completed';
  if (returned > 0) return 'partial';
  return 'pending';
}

export function purchaseReturnFulfillmentLabel(
  ret: Pick<PurchaseReturn, 'fulfillmentStatus' | 'items'>
): string {
  if (isLegacyPurchaseReturn(ret)) return 'Returned';
  const status = ret.fulfillmentStatus || derivePurchaseReturnFulfillmentStatus(ret.items || [], ret);
  if (status === 'completed') {
    const anyReturned = (ret.items || []).some((item) => itemReturnOutcome(item, ret) === 'returned');
    return anyReturned ? 'Completed' : 'Not returned';
  }
  if (status === 'partial') return 'Partial';
  return 'Pending';
}

export function purchaseReturnOutcomeLabel(outcome: PurchaseReturnOutcome): string {
  if (outcome === 'returned') return 'Returned';
  if (outcome === 'not_returned') return 'Not returned';
  return 'Pending';
}

/** Amount that actually went back to the vendor (for ledger). */
export function purchaseReturnSettledAmount(ret: PurchaseReturn): number {
  const items = ret.items || [];
  if (!items.length) return Number(ret.totalAmount) || 0;
  if (isLegacyPurchaseReturn(ret)) return Number(ret.totalAmount) || 0;
  return items.reduce((sum, item) => {
    if (itemReturnOutcome(item, ret) !== 'returned') return sum;
    return sum + (Number(item.totalAmount) || 0);
  }, 0);
}
