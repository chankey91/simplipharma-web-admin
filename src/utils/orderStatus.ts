/** Pending orders folded into another order. Not a retailer cancellation. */
export const CANCELLED_MERGED_STATUS = 'Cancelled-Merged';

export function isCancelledOrderStatus(status: unknown): boolean {
  return status === 'Cancelled' || status === CANCELLED_MERGED_STATUS;
}
