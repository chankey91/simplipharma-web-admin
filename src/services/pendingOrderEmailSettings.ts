import { doc, getDoc, setDoc, serverTimestamp, db, auth } from './firebase';
import { stripUndefinedDeep } from '../utils/firestorePayload';

export const PENDING_ORDER_EMAIL_DOC = 'app_settings/pendingOrderEmail';

export type PublicHoliday = {
  date: string;
  name: string;
};

export type PendingOrderEmailSettings = {
  enabled: boolean;
  toEmails: string[];
  skipSunday: boolean;
  holidays: PublicHoliday[];
};

export const DEFAULT_PENDING_ORDER_EMAIL: PendingOrderEmailSettings = {
  enabled: true,
  toEmails: ['satishyadav4446@gmail.com'],
  skipSunday: true,
  holidays: [],
};

function parseSettings(data: Record<string, unknown> | undefined): PendingOrderEmailSettings {
  const holidays = Array.isArray(data?.holidays)
    ? (data!.holidays as unknown[])
        .map((h) => {
          if (!h || typeof h !== 'object') return null;
          const row = h as { date?: unknown; name?: unknown };
          const date = String(row.date || '').trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
          return { date, name: String(row.name || '').trim() || date };
        })
        .filter((h): h is PublicHoliday => h != null)
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const emails = Array.isArray(data?.toEmails)
    ? (data!.toEmails as unknown[])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@'))
    : DEFAULT_PENDING_ORDER_EMAIL.toEmails;
  return {
    enabled: data?.enabled === false ? false : true,
    toEmails: emails.length ? [...new Set(emails)] : DEFAULT_PENDING_ORDER_EMAIL.toEmails,
    skipSunday: data?.skipSunday === false ? false : true,
    holidays,
  };
}

export async function getPendingOrderEmailSettings(): Promise<PendingOrderEmailSettings> {
  const snap = await getDoc(doc(db, 'app_settings', 'pendingOrderEmail'));
  if (!snap.exists()) return { ...DEFAULT_PENDING_ORDER_EMAIL, holidays: [] };
  return parseSettings(snap.data() as Record<string, unknown>);
}

export async function savePendingOrderEmailSettings(
  settings: PendingOrderEmailSettings
): Promise<void> {
  const emails = settings.toEmails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'));
  if (emails.length === 0) throw new Error('Enter at least one recipient email');
  await setDoc(
    doc(db, 'app_settings', 'pendingOrderEmail'),
    stripUndefinedDeep({
      enabled: settings.enabled !== false,
      toEmails: [...new Set(emails)],
      skipSunday: settings.skipSunday !== false,
      holidays: settings.holidays
        .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date))
        .map((h) => ({ date: h.date, name: h.name.trim() || h.date })),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || undefined,
    }),
    { merge: true }
  );
}
