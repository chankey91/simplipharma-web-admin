/** Reasons an admin can choose when cancelling an order. Stored as the cancel note. */
export const ORDER_CANCEL_REASONS = [
  'Market short',
  'Retailer does not want to purchase',
  'Duplicate order',
  'Wrong items or quantity',
  'Price or scheme not acceptable',
  'Credit limit exceeded',
  'Payment not received',
  'Retailer shop closed',
  'Placed by mistake',
  'Cannot deliver',
] as const;
