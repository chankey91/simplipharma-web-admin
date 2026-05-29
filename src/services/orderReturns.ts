import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
  db,
  auth,
} from './firebase';

export interface OrderReturnItem {
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  quantity: number;
  expiryDate: Date | any;
  unitRefundPrice: number;
  refundAmount: number;
  orderId?: string;
}

export type OrderReturnStatus = 'pending_so' | 'pending_admin' | 'approved' | 'rejected' | 'paid';

export interface OrderReturnRequest {
  id: string;
  retailerId: string;
  retailerName?: string;
  retailerEmail?: string;
  salesOfficerId: string;
  orderId: string;
  invoiceNumber?: string;
  items: OrderReturnItem[];
  totalRefundAmount: number;
  status: OrderReturnStatus;
  createdAt: Date | any;
  updatedAt?: Date | any;
  submittedBy?: string;
  soNotes?: string;
  soEvidenceUrls?: string[];
  soEvidenceUploadedAt?: Date | any;
  soEvidenceUploadedBy?: string;
  receivedBySO?: string;
  receivedAt?: Date | any;
  soForwardedAt?: Date | any;
  approvedBy?: string;
  approvedAt?: Date | any;
  rejectedBy?: string;
  rejectedAt?: Date | any;
  rejectionReason?: string;
  paymentReferenceNumber?: string;
  paymentDate?: Date | any;
  paymentMethod?: string;
  paidBy?: string;
  paidAt?: Date | any;
  creditNoteId?: string;
  creditNoteNumber?: string;
}

const parseDoc = (d: any): OrderReturnRequest => {
  const data = d.data();
  const items = (data.items || []).map((i: any) => ({
    ...i,
    expiryDate: i.expiryDate?.toDate?.() || i.expiryDate,
  }));
  return {
    id: d.id,
    ...data,
    items,
    totalRefundAmount: data.totalRefundAmount ?? 0,
    createdAt: data.createdAt?.toDate?.() || data.createdAt,
    updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
    receivedAt: data.receivedAt?.toDate?.() || data.receivedAt,
    soForwardedAt: data.soForwardedAt?.toDate?.() || data.soForwardedAt,
    soEvidenceUploadedAt: data.soEvidenceUploadedAt?.toDate?.() || data.soEvidenceUploadedAt,
    approvedAt: data.approvedAt?.toDate?.() || data.approvedAt,
    rejectedAt: data.rejectedAt?.toDate?.() || data.rejectedAt,
    paymentDate: data.paymentDate?.toDate?.() || data.paymentDate,
    paidAt: data.paidAt?.toDate?.() || data.paidAt,
  } as OrderReturnRequest;
};

export const getOrderReturnRequests = async (
  status?: OrderReturnStatus | 'all'
): Promise<OrderReturnRequest[]> => {
  const col = collection(db, 'order_return_requests');
  let q;
  if (status && status !== 'all') {
    q = query(col, where('status', '==', status), orderBy('createdAt', 'desc'));
  } else {
    q = query(col, orderBy('createdAt', 'desc'));
  }
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => parseDoc(d));
};

export { approveOrderReturnRequest } from './creditNotes';

export const rejectOrderReturnRequest = async (requestId: string, reason?: string): Promise<void> => {
  const reqRef = doc(db, 'order_return_requests', requestId);
  await updateDoc(reqRef, {
    status: 'rejected',
    rejectionReason: reason || '',
    rejectedBy: auth.currentUser?.uid,
    rejectedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const recordOrderReturnPayment = async (
  requestId: string,
  data: {
    paymentReferenceNumber: string;
    paymentDate: Date;
    paymentMethod: string;
  }
): Promise<void> => {
  const reqRef = doc(db, 'order_return_requests', requestId);
  await updateDoc(reqRef, {
    status: 'paid',
    paymentReferenceNumber: data.paymentReferenceNumber.trim(),
    paymentDate: Timestamp.fromDate(data.paymentDate),
    paymentMethod: data.paymentMethod || 'Offline',
    paidBy: auth.currentUser?.uid,
    paidAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};
