/** Pending orders folded into another order. Not a retailer cancellation. */
export const CANCELLED_MERGED_STATUS = 'Cancelled-Merged';

export function isCancelledOrderStatus(status: unknown): boolean {
  return status === 'Cancelled' || status === CANCELLED_MERGED_STATUS;
}

/** Still waiting for fulfillment. Stock has not been billed yet. */
export function isAwaitingFulfillmentStatus(status: unknown): boolean {
  return status === 'Pending' || status === 'Picked up';
}
