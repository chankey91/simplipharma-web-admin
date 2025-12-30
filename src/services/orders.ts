import { collection, getDocs, doc, updateDoc, query, orderBy, Timestamp, db, getDoc, where } from './firebase';
import { Order, OrderStatus, OrderTimelineEvent } from '../types';
import { reduceStockFromBatch } from './inventory';

const createTimelineEvent = (status: OrderStatus, updatedBy: string, note?: string): OrderTimelineEvent => ({
  status,
  timestamp: Timestamp.now(),
  updatedBy,
  note
});

export const getOrderById = async (orderId: string): Promise<Order | null> => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  
  if (!orderDoc.exists()) return null;
  
  const data = orderDoc.data();
  return {
    id: orderDoc.id,
    ...data,
    orderDate: data.orderDate?.toDate() || new Date(),
    timeline: data.timeline?.map((t: any) => ({
      ...t,
      timestamp: t.timestamp?.toDate() || new Date()
    })) || []
  } as Order;
};

export const getAllOrders = async (): Promise<Order[]> => {
  const ordersCol = collection(db, 'orders');
  try {
    const q = query(ordersCol, orderBy('orderDate', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        orderDate: data.orderDate?.toDate() || new Date(),
        timeline: data.timeline?.map((t: any) => ({
          ...t,
          timestamp: t.timestamp?.toDate() || new Date()
        })) || []
      } as Order;
    });
  } catch (error) {
    console.warn('OrderBy query failed, sorting in memory:', error);
    const snapshot = await getDocs(ordersCol);
    const orders = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        orderDate: data.orderDate?.toDate() || new Date(),
        timeline: data.timeline?.map((t: any) => ({
          ...t,
          timestamp: t.timestamp?.toDate() || new Date()
        })) || []
      } as Order;
    });
    
    return orders.sort((a, b) => {
      const dateA = a.orderDate instanceof Date ? a.orderDate : new Date(a.orderDate);
      const dateB = b.orderDate instanceof Date ? b.orderDate : new Date(b.orderDate);
      return dateB.getTime() - dateA.getTime();
    });
  }
};

export const updateOrderStatus = async (
  orderId: string, 
  status: OrderStatus, 
  updatedBy: string, 
  note?: string
) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  await updateDoc(orderRef, { 
    status,
    timeline: [...currentTimeline, createTimelineEvent(status, updatedBy, note)]
  });
};

export const cancelOrder = async (orderId: string, cancelledBy: string, reason: string) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  await updateDoc(orderRef, {
    status: 'Cancelled',
    cancelReason: reason,
    cancelledAt: Timestamp.now(),
    timeline: [...currentTimeline, createTimelineEvent('Cancelled', cancelledBy, reason)]
  });
};

export const fulfillOrder = async (
  orderId: string, 
  fulfilledBy: string, 
  fulfillmentData: {
    medicines: any[];
    taxAmount: number;
    taxPercentage: number;
    subTotal: number;
    totalAmount: number;
  }
) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  // Reduce stock from batches for items that have batch numbers assigned
  const stockUpdateErrors: string[] = [];
  
  for (const item of fulfillmentData.medicines) {
    if (item.batchNumber && item.medicineId && item.quantity) {
      try {
        await reduceStockFromBatch(
          item.medicineId,
          item.batchNumber,
          item.quantity
        );
        console.log(`✓ Stock reduced for medicine ${item.medicineId}, batch ${item.batchNumber}, quantity: ${item.quantity}`);
      } catch (error: any) {
        const errorMsg = `Failed to reduce stock for ${item.name || item.medicineId} (batch ${item.batchNumber}): ${error.message || error}`;
        console.error(errorMsg, error);
        stockUpdateErrors.push(errorMsg);
        // Continue with other items even if one fails
      }
    }
  }
  
  if (stockUpdateErrors.length > 0) {
    console.warn('Some stock updates failed:', stockUpdateErrors);
    // Still update the order, but log the errors
  }
  
  // Update medicines array to include batchExpiryDate as expiryDate for invoice generation
  const updatedMedicines = fulfillmentData.medicines.map(m => ({
    ...m,
    expiryDate: m.batchExpiryDate || m.expiryDate
  }));
  
  await updateDoc(orderRef, {
    ...fulfillmentData,
    medicines: updatedMedicines,
    status: 'Order Fulfillment',
    timeline: [...currentTimeline, createTimelineEvent('Order Fulfillment', fulfilledBy, 'Order items verified and tax added')]
  });
};

export const updateOrderDispatch = async (
  orderId: string, 
  dispatchData: {
    status: 'In Transit';
    dispatchDate: Date;
    dispatchNotes?: string;
    trackingNumber?: string;
    courierName?: string;
    dispatchedBy: string;
    estimatedDeliveryDate?: Date;
  }
) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  const updatePayload: any = {
    status: dispatchData.status,
    dispatchDate: Timestamp.fromDate(dispatchData.dispatchDate),
    dispatchedBy: dispatchData.dispatchedBy,
    timeline: [...currentTimeline, createTimelineEvent('In Transit', dispatchData.dispatchedBy, dispatchData.dispatchNotes)]
  };
  
  if (dispatchData.trackingNumber) updatePayload.trackingNumber = dispatchData.trackingNumber;
  if (dispatchData.courierName) updatePayload.courierName = dispatchData.courierName;
  if (dispatchData.dispatchNotes) updatePayload.dispatchNotes = dispatchData.dispatchNotes;
  if (dispatchData.estimatedDeliveryDate) {
    updatePayload.estimatedDeliveryDate = Timestamp.fromDate(dispatchData.estimatedDeliveryDate);
  }
  
  await updateDoc(orderRef, updatePayload);
};

export const markOrderDelivered = async (orderId: string, deliveredBy: string) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  
  if (!orderDoc.exists()) {
    throw new Error('Order not found');
  }
  
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  await updateDoc(orderRef, {
    status: 'Delivered',
    deliveryConfirmation: {
      deliveredAt: Timestamp.now(),
      deliveredBy
    },
    timeline: [...currentTimeline, createTimelineEvent('Delivered', deliveredBy, 'Order delivered successfully')]
  });
};

export const updatePaymentStatus = async (
  orderId: string,
  paymentStatus: 'Paid' | 'Unpaid' | 'Partial',
  paidAmount?: number,
  totalAmount?: number
) => {
  const orderRef = doc(db, 'orders', orderId);
  const updateData: any = {
    paymentStatus,
  };
  
  if (paidAmount !== undefined) {
    updateData.paidAmount = paidAmount;
  }
  
  if (totalAmount !== undefined) {
    updateData.dueAmount = totalAmount - (paidAmount || 0);
  }
  
  await updateDoc(orderRef, updateData);
};
