// Reuse existing types and extend them
export interface Medicine {
  id: string;
  /** Often the GST HSN item code — the same HSN may apply to many different products/SKUs. */
  code?: string;
  name: string;
  category: string;
  unit?: string;
  stock: number;
  currentStock?: number;
  /** Min expiry among batches with quantity > 0 (denormalized on master). */
  nearestExpiry?: Date | any;
  /** Count of batches with quantity > 0 (denormalized on master). */
  activeBatchCount?: number;
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
  /** @deprecated Prefer nearestExpiry / medicineBatches. Kept for legacy docs. */
  expiryDate?: Date | any;
  mfgDate?: Date | any;
  batchNumber?: string;
  barcode?: string;
  /**
   * Hydrated at read time from `medicineBatches` (preferred) or legacy embedded array.
   * Not written as the source of truth going forward — see medicineBatches collection.
   */
  stockBatches?: StockBatch[];
  gstRate?: number; // GST rate percentage (default: 5)
  /** Set by migration when embedded stockBatches were copied to medicineBatches. */
  batchesMigratedAt?: Date | any;
  migrationVersion?: number;
}

/** On-hand lot. Persisted in `medicineBatches` (field medicineId links to medicines/{id}). */
export interface StockBatch {
  id: string;
  /** Parent medicine id when loaded from medicineBatches. */
  medicineId?: string;
  batchNumber: string;
  quantity: number;
  expiryDate: Date | any;
  mfgDate?: Date | any;
  purchaseDate?: Date | any;
  purchasePrice?: number;
  /** Set from purchase invoice; stock bought as non-returnable cannot be expiry/order returned. */
  nonReturnable?: boolean;
  /** Ex-GST landed cost per strip from PI: (paid cost − line disc) ÷ physical qty */
  landedUnitCostExGst?: number;
  mrp?: number;
  discountPercentage?: number;
  /** Retail margin % off MRP (from PI standard discount); used for sell pricing. */
  standardDiscount?: number;
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
  lineType?: 'medicine' | 'product_demand';
  productDemandId?: string;
  manufacturerName?: string;
  requestedUnit?: string;
  notes?: string;
  /** Product-request photo copied on order line when present. */
  imageUrl?: string;
  freeQuantity?: number;
  originalQuantity?: number; // Original ordered quantity (for partial fulfillment tracking)
  batchNumber?: string; // Keep for backward compatibility
  expiryDate?: Date | any;
  discountPercentage?: number; // Discount percentage for the item
  /** When true, user overrode discount % manually in fulfillment UI. */
  discountManuallySet?: boolean;
  gstRate?: number; // GST rate for the item
  mrp?: number; // MRP for the item
  /** When true, this line was fulfilled from non-returnable stock and must not be returned. */
  nonReturnable?: boolean;
  // NEW: Support multiple batch allocations
  batchAllocations?: Array<{
    batchNumber: string;
    quantity: number; // Quantity from this specific batch
    expiryDate?: Date | any;
    mrp?: number;
    purchasePrice?: number;
    gstRate?: number;
    discountPercentage?: number;
    schemePaidQty?: number;
    schemeFreeQty?: number;
    /** Scheme free units for this allocation; stock deduct = quantity + allocationFreeQty */
    allocationFreeQty?: number;
    /** Copied from stock batch at fulfilment — drives mobile return eligibility. */
    nonReturnable?: boolean;
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
  /** Set when cancel/unfulfill successfully put deducted stock back on inventory batches. */
  stockRestoredOnCancel?: boolean;
  paymentStatus?: PaymentStatus;
  paymentReviewStatus?: PaymentReviewStatus;
  paidAmount?: number;
  dueAmount?: number;
  lastPaymentRequestId?: string;
  lastPaymentRequestedAt?: Date | any;
  paymentRejectedReason?: string;
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
  /** In-progress fulfillment (batch assignments) while status is Pending. */
  fulfillmentDraft?: {
    medicines: OrderMedicine[];
    taxPercentage?: number;
    updatedAt?: Date | any;
  };
}

export type PaymentStatus = 'Paid' | 'Unpaid' | 'Partial';
export type PaymentMethod = 'Cash' | 'Online' | 'Card' | 'UPI' | 'Bank Transfer' | 'Cheque';
export type PaymentReviewStatus = 'none' | 'pending_admin_review' | 'approved' | 'rejected';

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

/** Payment recorded against a purchase invoice (vendor payable). */
export interface VendorInvoicePayment {
  id: string;
  amount: number;
  paymentDate: Date | any;
  paymentMethod?: PaymentMethod;
  transactionId?: string;
  notes?: string;
}

export type PaymentRequestStatus =
  | 'pending_admin_review'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export type PaymentRequestMethod = 'cash' | 'online';

export interface PaymentRequestCreditApplication {
  creditNoteId: string;
  creditNoteNumber?: string;
  source?: 'order_return' | 'expiry_return' | 'credit_note';
  requestedApplyAmount: number;
}

export interface PaymentRequest {
  id: string;
  orderId: string;
  invoiceNumber?: string;
  retailerId: string;
  retailerName?: string;
  retailerEmail?: string;
  requestedAmount: number;
  currency: 'INR';
  method: PaymentRequestMethod;
  provider?: 'upi_intent' | 'razorpay' | 'phonepe' | 'payu' | 'other';
  transactionId?: string;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  screenshotUrl?: string;
  cashReference?: string;
  notes?: string;
  creditApplications?: PaymentRequestCreditApplication[];
  status: PaymentRequestStatus;
  reviewedBy?: string;
  reviewedAt?: Date | any;
  reviewNote?: string;
  rejectionReason?: string;
  orderTotalSnapshot: number;
  dueBeforeRequestSnapshot: number;
  creditAvailableSnapshot?: number;
  netPayableSnapshot?: number;
  createdAt: Date | any;
  updatedAt: Date | any;
}

export interface User {
  id: string;
  uid: string;
  email: string;
  role?: 'retailer' | 'admin' | 'salesOfficer' | 'operations' | 'purchaseOfficer';
  firstName?: string;
  lastName?: string;
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
  shopImageUrl?: string;
  licenceImageUrl?: string;
  aadharImageUrl?: string;
  storeCode?: string; // Unique code for medical store (e.g., MS001, MS002)
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  mustResetPassword?: boolean;
  /** Admin temporary unlock: retailer may place orders until this time despite overdue payment. */
  orderBlockOverrideUntil?: Date | any;
  orderBlockOverrideAt?: Date | any;
  orderBlockOverrideBy?: string;
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
  /** When true, receipts for this PI line carry non-returnable stock (see StockBatch.nonReturnable). */
  nonReturnable?: boolean;
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
  paidAmount?: number;
  transactionId?: string;
  /** Last / latest payment date (when marked paid or partial). */
  paidAt?: Date | any;
  /** Individual payment vouchers for vendor ledger credits. */
  payments?: VendorInvoicePayment[];
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
  /** How many units the retailer needs supplied (mandatory on new requests). */
  requestedQuantity: number;
  /** Unit of measure (e.g. strips, bottles, pcs). */
  requestedUnit: string;
  notes?: string;
  /** Optional photo from retailer app (JPEG data URL on Firestore). */
  imageUrl?: string;
  status: ProductDemandStatus;
  /** Set when the retailer checked out with this request on an order */
  orderId?: string;
  createdAt: Date | any;
  updatedAt?: Date | any;
  fulfilledMedicineId?: string;
  fulfilledMedicineName?: string;
  fulfilledBy?: string;
  fulfilledAt?: Date | any;
  fulfillmentNote?: string;
  /** Quantity queued for retailer cart when ops fulfilled the demand. */
  fulfilledCartQuantity?: number;
  purchaseInvoiceId?: string;
  rejectionReason?: string;
  rejectedAt?: Date | any;
  rejectedBy?: string;
}

export interface CreditNoteLine {
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  mrp?: number;
  quantity: number;
  expiryDate?: Date | any;
  hsn?: string;
  gstRate: number;
  unitRefundPrice: number;
  refundAmount: number;
}

/** Shared line shape for credit/debit tax notes. */
export type TaxNoteLine = CreditNoteLine;

export type CreditNoteType = 'order_return' | 'ledger_adjustment';

export type DebitNoteSourceType =
  | 'manual'
  | 'ledger_adjustment'
  | 'order_adjustment'
  | 'billing_correction'
  | 'other';

export interface CreditNote {
  id: string;
  creditNoteNumber: string;
  creditNoteDate: Date | any;
  type: CreditNoteType;
  /** When false/omitted, note is included in retailer wallet. */
  ledgerOnly?: boolean;
  orderReturnRequestId?: string;
  orderId?: string;
  reason?: string;
  originalInvoiceNumber?: string;
  retailerId: string;
  retailerName?: string;
  retailerEmail?: string;
  retailerGstin?: string;
  retailerAddress?: string;
  retailerPhone?: string;
  retailerDl?: string;
  items: CreditNoteLine[];
  subTotal: number;
  taxAmount: number;
  totalAmount: number;
  taxPercentage: number;
  /** Wallet balance (mobile app); mirrors totalAmount when issued. */
  amount?: number;
  amountUsed?: number;
  status: 'issued';
  createdBy?: string;
  createdAt: Date | any;
}

export interface DebitNote {
  id: string;
  debitNoteNumber: string;
  debitNoteDate: Date | any;
  sourceType?: DebitNoteSourceType;
  /** When false/omitted, note is included in retailer wallet. */
  ledgerOnly?: boolean;
  retailerId: string;
  retailerName?: string;
  retailerEmail?: string;
  retailerGstin?: string;
  retailerAddress?: string;
  retailerPhone?: string;
  retailerDl?: string;
  originalInvoiceNumber?: string;
  orderId?: string;
  reason?: string;
  items: TaxNoteLine[];
  subTotal: number;
  taxAmount: number;
  totalAmount: number;
  taxPercentage: number;
  status: 'issued';
  createdBy?: string;
  createdAt: Date | any;
}
