// Reuse existing types and extend them
export interface Medicine {
  id: string;
  code?: string;
  name: string;
  category: string;
  unit?: string;
  stock: number;
  currentStock?: number;
  price: number;
  costPrice?: number;
  mrp?: number;
  purchasePrice?: number;
  salesPrice?: number;
  salesSchemeDeal?: number;
  salesSchemeFree?: number;
  purchaseSchemeDeal?: number;
  purchaseSchemeFree?: number;
  value?: number;
  manufacturer: string;
  company?: string;
  description?: string;
  imageUrl?: string;
  dosage?: string;
  sideEffects?: string;
  composition?: string;
  // NEW: Expiry and batch management
  expiryDate?: Date | any;
  batchNumber?: string;
  barcode?: string;
  stockBatches?: StockBatch[];
}

export interface StockBatch {
  id: string;
  batchNumber: string;
  quantity: number;
  expiryDate: Date | any;
  purchaseDate?: Date | any;
  purchasePrice?: number;
}

export type OrderStatus = 'Pending' | 'Dispatched' | 'Delivered' | 'Cancelled';

export interface OrderMedicine {
  medicineId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  retailerId: string;
  retailerEmail?: string;
  medicines: OrderMedicine[];
  totalAmount: number;
  status: OrderStatus;
  orderDate: Date | any;
  deliveryAddress?: string;
  trackingLocation?: {
    latitude: number;
    longitude: number;
  };
  estimatedDelivery?: string;
  cancelReason?: string;
  cancelledAt?: Date | any;
  paymentStatus?: PaymentStatus;
  paidAmount?: number;
  dueAmount?: number;
  payments?: Payment[];
  // NEW: Dispatch fields
  dispatchDate?: Date | any;
  dispatchNotes?: string;
  trackingNumber?: string;
  courierName?: string;
  dispatchedBy?: string;
  estimatedDeliveryDate?: Date | any;
  deliveryConfirmation?: {
    deliveredAt: Date | any;
    deliveredBy: string;
    signature?: string;
  };
}

export type PaymentStatus = 'Paid' | 'Unpaid' | 'Partial';
export type PaymentMethod = 'Cash' | 'Card' | 'UPI' | 'Bank Transfer' | 'Cheque';

export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  paymentDate: Date | any;
  paymentMethod: PaymentMethod;
  notes?: string;
  collectedBy?: string;
}

export interface User {
  id: string;
  uid: string;
  email: string;
  role?: 'retailer' | 'admin';
  displayName?: string;
  phoneNumber?: string;
  address?: string;
  shopName?: string;
  isActive?: boolean;
  createdAt?: Date | any;
}

