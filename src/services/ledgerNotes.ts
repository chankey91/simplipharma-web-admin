import {
  collection,
  doc,
  setDoc,
  Timestamp,
  serverTimestamp,
  db,
  auth,
  getUserProfile,
} from './firebase';
import { generateCreditNoteNumber, generateDebitNoteNumber } from '../utils/invoiceNumber';
import { CreditNoteLine } from '../types';

export interface CreateDirectLedgerNoteInput {
  retailerId: string;
  totalAmount: number;
  reason: string;
  noteDate?: Date;
  originalInvoiceNumber?: string;
  taxPercentage?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function splitTaxInclusive(total: number, taxPct: number): { subTotal: number; taxAmount: number } {
  const subTotal = round2(total / (1 + taxPct / 100));
  const taxAmount = round2(total - subTotal);
  return { subTotal, taxAmount };
}

function buildLedgerLine(reason: string, subTotal: number, taxPct: number): CreditNoteLine {
  const label = reason.trim().slice(0, 200) || 'Ledger adjustment';
  return {
    medicineId: 'ledger-adjustment',
    medicineName: label,
    batchNumber: '—',
    quantity: 1,
    gstRate: taxPct,
    unitRefundPrice: subTotal,
    refundAmount: subTotal,
    mrp: subTotal,
  };
}

async function loadRetailerFields(retailerId: string) {
  const profile = await getUserProfile(retailerId);
  if (!profile) {
    throw new Error('Retailer not found');
  }
  return {
    retailerName: profile.shopName || profile.displayName || profile.email,
    retailerEmail: profile.email,
    retailerGstin: profile.gst,
    retailerAddress: profile.address,
    retailerPhone: profile.phoneNumber,
    retailerDl: profile.licenceNumber,
  };
}

function validateInput(input: CreateDirectLedgerNoteInput) {
  const retailerId = input.retailerId?.trim();
  if (!retailerId) throw new Error('Select a medical store');
  const reason = input.reason?.trim();
  if (!reason) throw new Error('Reason is required');
  const totalAmount = round2(Number(input.totalAmount));
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('Enter a valid amount greater than zero');
  }
  const taxPercentage = input.taxPercentage ?? 5;
  if (!Number.isFinite(taxPercentage) || taxPercentage < 0) {
    throw new Error('Enter a valid tax percentage');
  }
  return { retailerId, reason, totalAmount, taxPercentage };
}

export async function createDirectLedgerCreditNote(
  input: CreateDirectLedgerNoteInput
): Promise<{ id: string; creditNoteNumber: string }> {
  const { retailerId, reason, totalAmount, taxPercentage } = validateInput(input);
  const retailer = await loadRetailerFields(retailerId);
  const { subTotal, taxAmount } = splitTaxInclusive(totalAmount, taxPercentage);
  const items = [buildLedgerLine(reason, subTotal, taxPercentage)];
  const creditNoteNumber = await generateCreditNoteNumber();
  const noteRef = doc(collection(db, 'credit_notes'));
  const noteDate = input.noteDate ? Timestamp.fromDate(input.noteDate) : Timestamp.now();

  await setDoc(noteRef, {
    creditNoteNumber,
    creditNoteDate: noteDate,
    type: 'ledger_adjustment',
    reason,
    originalInvoiceNumber: input.originalInvoiceNumber?.trim() || undefined,
    retailerId,
    ...retailer,
    items,
    subTotal,
    taxAmount,
    totalAmount,
    amount: totalAmount,
    amountUsed: 0,
    taxPercentage,
    status: 'issued',
    createdBy: auth.currentUser?.uid,
    createdAt: serverTimestamp(),
  });

  return { id: noteRef.id, creditNoteNumber };
}

export async function createDirectLedgerDebitNote(
  input: CreateDirectLedgerNoteInput
): Promise<{ id: string; debitNoteNumber: string }> {
  const { retailerId, reason, totalAmount, taxPercentage } = validateInput(input);
  const retailer = await loadRetailerFields(retailerId);
  const { subTotal, taxAmount } = splitTaxInclusive(totalAmount, taxPercentage);
  const items = [buildLedgerLine(reason, subTotal, taxPercentage)];
  const debitNoteNumber = await generateDebitNoteNumber();
  const noteRef = doc(collection(db, 'debit_notes'));
  const noteDate = input.noteDate ? Timestamp.fromDate(input.noteDate) : Timestamp.now();

  await setDoc(noteRef, {
    debitNoteNumber,
    debitNoteDate: noteDate,
    sourceType: 'ledger_adjustment',
    reason,
    originalInvoiceNumber: input.originalInvoiceNumber?.trim() || undefined,
    retailerId,
    ...retailer,
    items,
    subTotal,
    taxAmount,
    totalAmount,
    taxPercentage,
    status: 'issued',
    createdBy: auth.currentUser?.uid,
    createdAt: serverTimestamp(),
  });

  return { id: noteRef.id, debitNoteNumber };
}
