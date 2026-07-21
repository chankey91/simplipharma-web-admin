export type AdminNotificationType =
  | 'order'
  | 'product_demand'
  | 'retailer_registration'
  | 'order_return'
  | 'expiry_return'
  | 'purchase_list';

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  title: string;
  message: string;
  path: string;
  createdAt: Date;
}
