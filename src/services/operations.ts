import { collection, getDocs, addDoc, deleteDoc, doc, Timestamp, serverTimestamp, db, query, where, auth } from './firebase';

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

/** Firestore tray docs may use different field names across deployments. */
function resolveTrayName(data: Record<string, unknown>): string {
  const keys = ['name', 'trayName', 'label', 'tray', 'trayNumber', 'title', 'number'] as const;
  for (const k of keys) {
    const v = data[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return '';
}

/** Wait until Firebase Auth has resolved the initial user/token so Firestore rules see request.auth. */
async function ensureAuthReady(): Promise<void> {
  await auth.authStateReady();
}

export const getTrays = async (): Promise<Tray[]> => {
  await ensureAuthReady();
  const traysRef = collection(db, TRAYS_COLLECTION);
  const snapshot = await getDocs(traysRef);
  const rows: Tray[] = snapshot.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const name = resolveTrayName(data);
    return {
      id: d.id,
      name,
      createdAt: data.createdAt as Tray['createdAt'],
    };
  });
  const byName = new Map<string, Tray>();
  for (const t of rows) {
    if (!t.name) continue;
    if (!byName.has(t.name)) byName.set(t.name, t);
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
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
  await ensureAuthReady();
  const ordersRef = collection(db, 'orders');
  const trayNumbers = new Set<string>();
  
  const statusesToCheck = ['Pending', 'Order Fulfillment'];
  for (const status of statusesToCheck) {
    const q = query(ordersRef, where('status', '==', status));
    const snapshot = await getDocs(q);
    snapshot.docs.forEach((d) => {
      if (d.id === excludeOrderId) return;
      const data = d.data();
      const raw = data.trayNumber;
      const trayNum = raw === undefined || raw === null ? '' : String(raw).trim();
      if (trayNum) {
        trayNumbers.add(trayNum);
      }
    });
  }
  
  return Array.from(trayNumbers);
};

export const getOperators = async (): Promise<Operator[]> => {
  await ensureAuthReady();
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
    createdAt: serverTimestamp(),
  });
  return docRef.id;
};

export const addOperator = async (name: string): Promise<string> => {
  const operatorsRef = collection(db, OPERATORS_COLLECTION);
  const docRef = await addDoc(operatorsRef, {
    name: name.trim(),
    createdAt: serverTimestamp(),
  });
  return docRef.id;
};

export const deleteTray = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, TRAYS_COLLECTION, id));
};

export const deleteOperator = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, OPERATORS_COLLECTION, id));
};
