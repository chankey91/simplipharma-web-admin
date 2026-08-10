import { collection, query, where, getDocs, db } from '../services/firebase';

const STORE_CODE_PREFIX = 'MS';
const STORE_CODE_RE = /^MS(\d+)$/i;

export function parseStoreCodeNumber(code: string | undefined | null): number | null {
  const raw = String(code || '').trim();
  const m = raw.match(STORE_CODE_RE);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function formatStoreCode(n: number): string {
  const digits = Math.max(3, String(n).length);
  return `${STORE_CODE_PREFIX}${String(n).padStart(digits, '0')}`;
}

/** Highest numeric MS### among retailer store codes (0 if none). */
export async function getMaxStoreCodeNumber(): Promise<number> {
  const usersCol = collection(db, 'users');
  const snapshot = await getDocs(query(usersCol, where('role', '==', 'retailer')));
  let max = 0;
  for (const docSnap of snapshot.docs) {
    const n = parseStoreCodeNumber(docSnap.data().storeCode as string | undefined);
    if (n != null && n > max) max = n;
  }
  return max;
}

/**
 * Generate next unique store code.
 * Format: MS + zero-padded number (MS001, MS002, …).
 */
export const generateStoreCode = async (): Promise<string> => {
  const max = await getMaxStoreCodeNumber();
  return formatStoreCode(max + 1);
};
