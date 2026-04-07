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
  mfgDate?: Date | any;
  batchNumber?: string;
  barcode?: string;
  stockBatches?: StockBatch[];
  gstRate?: number; // GST rate percentage (default: 5)
}

export interface StockBatch {
  id: string;
  batchNumber: string;
  quantity: number;
  expiryDate: Date | any;
  mfgDate?: Date | any;
  purchaseDate?: Date | any;
  purchasePrice?: number;
  mrp?: number;
  discountPercentage?: number;
  /** Retailer-facing purchase offer: pay for this many units, get schemeFreeQty free (e.g. 10 + 1). */
  schemePaidQty?: number;
  schemeFreeQty?: number;
}

export type OrderStatus = 'Pending' | 'Order Fulfillment' | 'In Transit' | 'Delivered' | 'Cancelled';

export interface OrderMedicine {
  medicineId: string;
  name: string;
  price: number;
  quantity: number;
  originalQuantity?: number; // Original ordered quantity (for partial fulfillment tracking)
  batchNumber?: string; // Keep for backward compatibility
  expiryDate?: Date | any;
  discountPercentage?: number; // Discount percentage for the item
  gstRate?: number; // GST rate for the item
  mrp?: number; // MRP for the item
  // NEW: Support multiple batch allocations
  batchAllocations?: Array<{
    batchNumber: string;
    quantity: number; // Quantity from this specific batch
    expiryDate?: Date | any;
    mrp?: number;
    purchasePrice?: number;
    gstRate?: number;
    discountPercentage?: number;
  }>;
}

export interface OrderTimelineEvent {
  status: OrderStatus;
  timestamp: Date | any;
  note?: string;
  updatedBy?: string;
}

export interface Order {
  id: string;
  retailerId: string;
  retailerEmail?: string;
  retailerName?: string;
  medicines: OrderMedicine[];
  subTotal: number;
  taxAmount: number;
  taxPercentage?: number;
  totalAmount: number;
  status: OrderStatus;
  orderDate: Date | any;
  invoiceNumber?: string; // Auto-generated invoice number (SPS + YYYY + MM + 001)
  trayNumber?: string; // Tray number for order fulfillment
  processedBy?: string; // Name of person processing the order
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
  paymentMethod?: PaymentMethod; // Cash or Online when payment collected
  transactionId?: string; // For online/bank payments
  payments?: Payment[];
  timeline: OrderTimelineEvent[];
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
export type PaymentMethod = 'Cash' | 'Online' | 'Card' | 'UPI' | 'Bank Transfer' | 'Cheque';

export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  paymentDate: Date | any;
  paymentMethod: PaymentMethod;
  notes?: string;
  collectedBy?: string;
  transactionId?: string; // For online payments
}

export interface User {
  id: string;
  uid: string;
  email: string;
  role?: 'retailer' | 'admin' | 'salesOfficer';
  salesOfficerId?: string; // For retailers: which Sales Officer manages them
  displayName?: string;
  phoneNumber?: string;
  address?: string;
  shopName?: string;
  isActive?: boolean;
  createdAt?: Date | any;
  // Store details
  licenceNumber?: string;
  aadharNumber?: string;
  ownerName?: string;
  licenceHolderName?: string;
  pan?: string;
  gst?: string;
  shopImage?: string;
  storeCode?: string; // Unique code for medical store (e.g., MS001, MS002)
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  mustResetPassword?: boolean;
}

export interface Vendor {
  id: string;
  vendorName: string;
  contactPerson?: string;
  email: string;
  phoneNumber?: string;
  address?: string;
  gstNumber: string; // Unique
  drugLicenseNumber?: string; // Unique
  pan?: string;
  bankDetails?: {
    accountNumber?: string;
    ifscCode?: string;
    bankName?: string;
  };
  isActive: boolean;
  createdAt: Date | any;
}

export interface PurchaseInvoiceItem {
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  mfgDate?: Date | any;
  expiryDate: Date | any;
  quantity: number;
  freeQuantity?: number;
  /** Shown to retailers: buy schemePaidQty, get schemeFreeQty free (same batch). */
  schemePaidQty?: number;
  schemeFreeQty?: number;
  unitPrice: number;
  purchasePrice: number;
  mrp?: number;
  gstRate?: number;
  standardDiscount?: number;
  discountPercentage?: number;
  totalAmount: number;
  qrCode?: string; // Base64 encoded QR code image
}

export interface PurchaseInvoice {
  id: string;
  invoiceNumber: string; // Unique
  vendorId: string;
  vendorName: string;
  invoiceDate: Date | any;
  items: PurchaseInvoiceItem[];
  subTotal: number;
  taxAmount: number;
  taxPercentage?: number;
  discount?: number;
  totalAmount: number;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod;
  notes?: string;
  createdAt: Date | any;
  createdBy: string;
}

export type ProductDemandStatus = 'pending' | 'fulfilled' | 'rejected';

export interface ProductDemand {
  id: string;
  retailerId: string;
  retailerEmail?: string;
  retailerName?: string;
  productName: string;
  manufacturerName: string;
  notes?: string;
  status: ProductDemandStatus;
  createdAt: Date | any;
  updatedAt?: Date | any;
  fulfilledMedicineId?: string;
  fulfilledMedicineName?: string;
  fulfilledBy?: string;
  fulfilledAt?: Date | any;
  fulfillmentNote?: string;
  purchaseInvoiceId?: string;
  rejectionReason?: string;
  rejectedAt?: Date | any;
  rejectedBy?: string;
}
