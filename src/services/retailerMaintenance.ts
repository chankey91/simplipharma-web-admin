import { httpsCallable } from 'firebase/functions';
import { db, doc, functions, getDoc } from './firebase';

export type RetailerMaintenanceStatus = {
  enabled: boolean;
  message: string;
  updatedAt: Date | null;
};

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value && 'toDate' in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

export async function getRetailerMaintenance(): Promise<RetailerMaintenanceStatus> {
  const snap = await getDoc(doc(db, 'app_config', 'retailer_maintenance'));
  if (!snap.exists()) return { enabled: false, message: '', updatedAt: null };
  const data = snap.data() as Record<string, unknown>;
  return {
    enabled: data.enabled === true,
    message: String(data.message || ''),
    updatedAt: toDate(data.updatedAt),
  };
}

export async function requestRetailerMaintenanceOtp(): Promise<{ sentTo: string }> {
  const fn = httpsCallable<Record<string, never>, { sentTo?: string }>(
    functions,
    'requestRetailerMaintenanceOtp'
  );
  const result = await fn({});
  return { sentTo: String(result.data?.sentTo || 'your email') };
}

export async function enableRetailerMaintenance(otp: string, message: string): Promise<void> {
  const fn = httpsCallable<{ otp: string; message: string }, { ok?: boolean }>(
    functions,
    'enableRetailerMaintenance'
  );
  await fn({ otp: otp.trim(), message: message.trim() });
}

export async function disableRetailerMaintenance(): Promise<void> {
  const fn = httpsCallable<Record<string, never>, { ok?: boolean }>(
    functions,
    'disableRetailerMaintenance'
  );
  await fn({});
}

export function callableErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const raw = String((err as { message?: string }).message || '');
    const cleaned = raw
      .replace(/^Firebase:\s*/i, '')
      .replace(/\s*\(functions\/[a-z-]+\)\.?$/i, '')
      .trim();
    if (cleaned) return cleaned;
  }
  return fallback;
}
