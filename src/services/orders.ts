import { collection, getDocs, doc, updateDoc, query, orderBy, Timestamp, db } from './firebase';
import { Order, OrderStatus } from '../types';

export const getAllOrders = async (): Promise<Order[]> => {
  const ordersCol = collection(db, 'orders');
  try {
    // Try with orderBy first
    const q = query(ordersCol, orderBy('orderDate', 'desc'));
    const snapshot = await getDocs(q);
    const orders: Order[] = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      orderDate: doc.data().orderDate?.toDate() || new Date()
    } as Order));
    return orders;
  } catch (error) {
    // Fallback: Get all and sort in memory
    console.warn('OrderBy query failed, sorting in memory:', error);
    const snapshot = await getDocs(ordersCol);
    const orders: Order[] = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      orderDate: doc.data().orderDate?.toDate() || new Date()
    } as Order));
    
    // Sort in memory
    return orders.sort((a, b) => {
      const dateA = a.orderDate instanceof Date ? a.orderDate : new Date(a.orderDate);
      const dateB = b.orderDate instanceof Date ? b.orderDate : new Date(b.orderDate);
      return dateB.getTime() - dateA.getTime();
    });
  }
};

export const updateOrderStatus = async (orderId: string, status: OrderStatus) => {
  const orderRef = doc(db, 'orders', orderId);
  await updateDoc(orderRef, { status });
};

export const updateOrderDispatch = async (
  orderId: string, 
  dispatchData: {
    status: 'Dispatched';
    dispatchDate: Date;
    dispatchNotes?: string;
    trackingNumber?: string;
    courierName?: string;
    dispatchedBy: string;
    estimatedDeliveryDate?: Date;
  }
) => {
  const orderRef = doc(db, 'orders', orderId);
  const updatePayload: any = {
    status: dispatchData.status,
    dispatchDate: Timestamp.fromDate(dispatchData.dispatchDate),
    dispatchedBy: dispatchData.dispatchedBy,
  };
  
  if (dispatchData.trackingNumber) {
    updatePayload.trackingNumber = dispatchData.trackingNumber;
  }
  
  if (dispatchData.courierName) {
    updatePayload.courierName = dispatchData.courierName;
  }
  
  if (dispatchData.dispatchNotes) {
    updatePayload.dispatchNotes = dispatchData.dispatchNotes;
  }
  
  if (dispatchData.estimatedDeliveryDate) {
    updatePayload.estimatedDeliveryDate = Timestamp.fromDate(dispatchData.estimatedDeliveryDate);
  }
  
  await updateDoc(orderRef, updatePayload);
};

export const markOrderDelivered = async (orderId: string, deliveredBy: string) => {
  const orderRef = doc(db, 'orders', orderId);
  await updateDoc(orderRef, {
    status: 'Delivered',
    deliveryConfirmation: {
      deliveredAt: Timestamp.now(),
      deliveredBy
    }
  });
};
