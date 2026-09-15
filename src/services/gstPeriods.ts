import { doc, getDoc, setDoc, serverTimestamp, db, auth } from './firebase';
import { stripUndefinedDeep } from '../utils/firestorePayload';
import { indianGstPeriod, periodIsLocked } from '../utils/gstPeriod';
import { compactGstFingerprint, expandGstFingerprints } from '../utils/gstFingerprint';
import type { GstFiledFingerprint, GstPeriod, GstPeriodStatus } from '../types/gst';

const COLLECTION = 'gst_periods';

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  const d = new Date(value as string | number);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function parsePeriod(id: string, data: Record<string, unknown>, fallback: GstPeriod): GstPeriod {
  return {
    ...fallback,
    id,
    fy: String(data.fy || fallback.fy),
    year: Number(data.year) || fallback.year,
    month: Number(data.month) || fallback.month,
    status: (data.status as GstPeriodStatus) || 'open',
    lockedAt: data.lockedAt,
    lockedBy: data.lockedBy ? String(data.lockedBy) : undefined,
    gstr1ExportedAt: data.gstr1ExportedAt,
    gstr1Filename: data.gstr1Filename ? String(data.gstr1Filename) : undefined,
    gstr1PayloadHash: data.gstr1PayloadHash ? String(data.gstr1PayloadHash) : undefined,
    gstr1ByteLength: Number(data.gstr1ByteLength) || undefined,
    gstr1ExportedBy: data.gstr1ExportedBy ? String(data.gstr1ExportedBy) : undefined,
    gstr1Arn: data.gstr1Arn ? String(data.gstr1Arn) : undefined,
    gstr3bExportedAt: data.gstr3bExportedAt,
    gstr3bArn: data.gstr3bArn ? String(data.gstr3bArn) : undefined,
    einvoiceExportedAt: data.einvoiceExportedAt,
    outwardFingerprints: expandGstFingerprints(data.outwardFingerprints),
  };
}

export function defaultGstPeriod(date = new Date()): GstPeriod {
  const meta = indianGstPeriod(date);
  return {
    id: meta.periodId,
    fy: meta.fy,
    year: meta.year,
    month: meta.month,
    status: 'open',
  };
}

export async function getGstPeriod(date = new Date()): Promise<GstPeriod> {
  const fallback = defaultGstPeriod(date);
  const snap = await getDoc(doc(db, COLLECTION, fallback.id));
  if (!snap.exists()) return fallback;
  return parsePeriod(snap.id, snap.data() as Record<string, unknown>, fallback);
}

export async function assertPeriodOpenForWrite(date = new Date()): Promise<GstPeriod> {
  const period = await getGstPeriod(date);
  if (periodIsLocked(period.status)) {
    throw new Error(
      `${indianGstPeriod(date).label} is ${period.status.replace(/_/g, ' ')}. Reopen the period to backfill.`
    );
  }
  return period;
}

export async function assertDocumentDateWritable(documentDate: unknown): Promise<GstPeriod> {
  const date = asDate(documentDate);
  const period = await getGstPeriod(date);
  if (periodIsLocked(period.status)) {
    throw new Error(
      `${indianGstPeriod(date).label} is ${period.status.replace(/_/g, ' ')}. Reopen the period to create or fulfill documents dated in this month.`
    );
  }
  return period;
}

export async function saveGstPeriod(
  date: Date,
  patch: Partial<Omit<GstPeriod, 'id' | 'fy' | 'year' | 'month'>>
): Promise<GstPeriod> {
  const current = await getGstPeriod(date);
  const next: GstPeriod = {
    ...current,
    ...patch,
    id: current.id,
    fy: current.fy,
    year: current.year,
    month: current.month,
  };
  await setDoc(
    doc(db, COLLECTION, current.id),
    stripUndefinedDeep({
      fy: next.fy,
      year: next.year,
      month: next.month,
      status: next.status,
      lockedAt: next.lockedAt,
      lockedBy: next.lockedBy,
      gstr1ExportedAt: next.gstr1ExportedAt,
      gstr1Filename: next.gstr1Filename,
      gstr1PayloadHash: next.gstr1PayloadHash,
      gstr1ByteLength: next.gstr1ByteLength,
      gstr1ExportedBy: next.gstr1ExportedBy,
      gstr1Arn: next.gstr1Arn,
      gstr3bExportedAt: next.gstr3bExportedAt,
      gstr3bArn: next.gstr3bArn,
      einvoiceExportedAt: next.einvoiceExportedAt,
      outwardFingerprints: next.outwardFingerprints?.map(compactGstFingerprint),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || undefined,
    }),
    { merge: true }
  );
  return next;
}

export async function lockGstPeriod(
  date: Date,
  input: {
    fingerprints: GstFiledFingerprint[];
    filename: string;
    payloadHash?: string;
    byteLength?: number;
  }
): Promise<GstPeriod> {
  return saveGstPeriod(date, {
    status: 'gstr1_ready',
    lockedAt: new Date(),
    lockedBy: auth.currentUser?.uid,
    gstr1ExportedAt: new Date(),
    gstr1Filename: input.filename,
    gstr1PayloadHash: input.payloadHash,
    gstr1ByteLength: input.byteLength,
    gstr1ExportedBy: auth.currentUser?.uid,
    outwardFingerprints: input.fingerprints,
  });
}

export async function markGstPeriodStatus(
  date: Date,
  status: GstPeriodStatus,
  extra?: { arn?: string }
): Promise<GstPeriod> {
  const patch: Partial<Omit<GstPeriod, 'id' | 'fy' | 'year' | 'month'>> = { status };
  const arn = extra?.arn?.trim();
  if (status === 'gstr1_filed' && arn) patch.gstr1Arn = arn;
  if (status === 'gstr3b_filed' && arn) patch.gstr3bArn = arn;
  if (status === 'gstr3b_filed') patch.gstr3bExportedAt = new Date();
  return saveGstPeriod(date, patch);
}
