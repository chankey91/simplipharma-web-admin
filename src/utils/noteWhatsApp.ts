import { format } from 'date-fns';
import { CreditNote, DebitNote } from '../types';
import { getUserProfile } from '../services/firebase';
import { generateCreditNotePdfBlob } from './creditNote';
import { generateDebitNotePdfBlob } from './debitNote';
import { sharePdfOnWhatsApp } from './sharePdfWhatsApp';
import { coerceToDate } from './dateTime';

const formatAmount = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatNoteDate = (value: unknown) => {
  const d = coerceToDate(value);
  return d ? format(d, 'dd MMM yyyy') : '';
};

async function resolveRetailerPhone(retailerId: string, storedPhone?: string | null): Promise<string | null> {
  const stored = String(storedPhone || '').trim();
  if (stored) return stored;
  if (!retailerId) return null;
  const profile = await getUserProfile(retailerId);
  const phone = String(profile?.phoneNumber || '').trim();
  return phone || null;
}

export async function shareCreditNoteOnWhatsApp(note: CreditNote): Promise<{ opened: boolean }> {
  const [{ blob, fileName }, phoneRaw] = await Promise.all([
    generateCreditNotePdfBlob(note),
    resolveRetailerPhone(note.retailerId, note.retailerPhone),
  ]);
  const date = formatNoteDate(note.creditNoteDate);
  const text = [
    'SimpliPharma — Credit note',
    `Note: ${note.creditNoteNumber}`,
    date ? `Date: ${date}` : '',
    `Store: ${note.retailerName || note.retailerEmail || note.retailerId}`,
    `Amount: *${formatAmount(note.totalAmount)}*`,
    note.originalInvoiceNumber ? `Invoice: ${note.originalInvoiceNumber}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return sharePdfOnWhatsApp({
    blob,
    fileName,
    storageFolder: 'tax_notes',
    text,
    phoneRaw,
  });
}

export async function shareDebitNoteOnWhatsApp(note: DebitNote): Promise<{ opened: boolean }> {
  const [{ blob, fileName }, phoneRaw] = await Promise.all([
    generateDebitNotePdfBlob(note),
    resolveRetailerPhone(note.retailerId, note.retailerPhone),
  ]);
  const date = formatNoteDate(note.debitNoteDate);
  const text = [
    'SimpliPharma — Debit note',
    `Note: ${note.debitNoteNumber}`,
    date ? `Date: ${date}` : '',
    `Store: ${note.retailerName || note.retailerEmail || note.retailerId}`,
    `Amount: *${formatAmount(note.totalAmount)}*`,
    note.originalInvoiceNumber ? `Invoice: ${note.originalInvoiceNumber}` : '',
    note.reason ? `Reason: ${note.reason}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return sharePdfOnWhatsApp({
    blob,
    fileName,
    storageFolder: 'tax_notes',
    text,
    phoneRaw,
  });
}
