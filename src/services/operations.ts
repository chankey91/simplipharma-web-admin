import { collection, getDocs, addDoc, deleteDoc, doc, Timestamp, db, query, where } from './firebase';

export interface Tray {
  id: string;
  name: string;
  createdAt?: Date | any;
}

export interface Operator {
  id: string;
  name: string;
  createdAt?: Date | any;
}

const TRAYS_COLLECTION = 'trays';
const OPERATORS_COLLECTION = 'operators';

export const getTrays = async (): Promise<Tray[]> => {
  const traysRef = collection(db, TRAYS_COLLECTION);
  const snapshot = await getDocs(traysRef);
  const trays = snapshot.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    createdAt: d.data().createdAt,
  } as Tray));
  return trays.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Get tray numbers that are currently in use.
 * A tray is "in use" when assigned to an order that is:
 * - Pending (tray assigned in dialog, not yet fulfilled)
 * - Order Fulfillment (in fulfillment, not yet dispatched)
 * Tray becomes available when order is In Transit (dispatched) or Delivered.
 * Exclude the given orderId so the current order's tray remains selectable when editing.
 */
export const getTraysInUse = async (excludeOrderId?: string): Promise<string[]> => {
  const ordersRef = collection(db, 'orders');
  const trayNumbers = new Set<string>();
  
  const statusesToCheck = ['Pending', 'Order Fulfillment'];
  for (const status of statusesToCheck) {
    const q = query(ordersRef, where('status', '==', status));
    const snapshot = await getDocs(q);
    snapshot.docs.forEach((d) => {
      if (d.id === excludeOrderId) return;
      const data = d.data();
      const trayNum = data.trayNumber?.trim();
      if (trayNum) {
        trayNumbers.add(trayNum);
      }
    });
  }
  
  return Array.from(trayNumbers);
};

export const getOperators = async (): Promise<Operator[]> => {
  const operatorsRef = collection(db, OPERATORS_COLLECTION);
  const snapshot = await getDocs(operatorsRef);
  const operators = snapshot.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    createdAt: d.data().createdAt,
  } as Operator));
  return operators.sort((a, b) => a.name.localeCompare(b.name));
};

export const addTray = async (name: string): Promise<string> => {
  const traysRef = collection(db, TRAYS_COLLECTION);
  const docRef = await addDoc(traysRef, {
    name: name.trim(),
    createdAt: Timestamp.now(),
  });
  return docRef.id;
};

export const addOperator = async (name: string): Promise<string> => {
  const operatorsRef = collection(db, OPERATORS_COLLECTION);
  const docRef = await addDoc(operatorsRef, {
    name: name.trim(),
    createdAt: Timestamp.now(),
  });
  return docRef.id;
};

export const deleteTray = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, TRAYS_COLLECTION, id));
};

export const deleteOperator = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, OPERATORS_COLLECTION, id));
};
