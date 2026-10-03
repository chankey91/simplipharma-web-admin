import {
  addDoc,
  collection,
  db,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from './firebase';
import { auth } from './firebase';
import type {
  AccountLedger,
  AccountLedgerType,
  AccountVoucher,
  AccountVoucherType,
  PaymentMethod,
} from '../types';
import { updatePurchaseInvoicePayment, getPurchaseInvoiceById } from './purchaseInvoices';
import { getOrderById, updatePaymentStatus } from './orders';
import { istDateStampCompact } from '../utils/dateTime';
import { toLedgerDate } from '../utils/vendorLedger';
import { stripUndefinedDeep } from '../utils/firestorePayload';

export const ACCOUNT_LEDGERS = 'accountLedgers';
export const ACCOUNT_VOUCHERS = 'accountVouchers';

const SYSTEM_LEDGERS: Array<Omit<AccountLedger, 'id'>> = [
  { code: 'CASH', name: 'Cash', type: 'cash', isSystem: true, isActive: true, openingBalance: 0 },
  { code: 'BANK', name: 'Bank', type: 'bank', isSystem: true, isActive: true, openingBalance: 0 },
  { code: 'SALARY', name: 'Salary', type: 'expense', isSystem: true, isActive: true },
  { code: 'RENT', name: 'Rent', type: 'expense', isSystem: true, isActive: true },
  { code: 'OFFICE', name: 'Office expenses', type: 'expense', isSystem: true, isActive: true },
  { code: 'TRAVEL', name: 'Travel / Petrol', type: 'expense', isSystem: true, isActive: true },
  { code: 'STAFF', name: 'Staff advance', type: 'expense', isSystem: true, isActive: true },
  { code: 'OTHER_INC', name: 'Other income', type: 'income', isSystem: true, isActive: true },
];

function mapLedger(id: string, data: Record<string, unknown>): AccountLedger {
  return {
    id,
    code: String(data.code || id),
    name: String(data.name || ''),
    type: (data.type as AccountLedgerType) || 'expense',
    openingBalance: typeof data.openingBalance === 'number' ? data.openingBalance : 0,
    isSystem: data.isSystem === true,
    isActive: data.isActive !== false,
    createdAt: data.createdAt,
    createdBy: data.createdBy ? String(data.createdBy) : undefined,
  };
}

function mapVoucher(id: string, data: Record<string, unknown>): AccountVoucher {
  return {
    id,
    voucherNo: String(data.voucherNo || id),
    voucherType: (data.voucherType as AccountVoucherType) || 'payment',
    date: toLedgerDate(data.date),
    amount: Number(data.amount) || 0,
    cashBankLedgerId: String(data.cashBankLedgerId || ''),
    cashBankLedgerName: String(data.cashBankLedgerName || ''),
    contraLedgerId: data.contraLedgerId ? String(data.contraLedgerId) : undefined,
    contraLedgerName: data.contraLedgerName ? String(data.contraLedgerName) : undefined,
    categoryLedgerId: data.categoryLedgerId ? String(data.categoryLedgerId) : undefined,
    categoryLedgerName: data.categoryLedgerName ? String(data.categoryLedgerName) : undefined,
    partyType: data.partyType as AccountVoucher['partyType'],
    partyId: data.partyId ? String(data.partyId) : undefined,
    partyName: data.partyName ? String(data.partyName) : undefined,
    paymentMethod: data.paymentMethod as PaymentMethod | undefined,
    transactionId: data.transactionId ? String(data.transactionId) : undefined,
    narration: data.narration ? String(data.narration) : undefined,
    linkedPurchaseInvoiceId: data.linkedPurchaseInvoiceId
      ? String(data.linkedPurchaseInvoiceId)
      : undefined,
    linkedPurchaseInvoiceNumber: data.linkedPurchaseInvoiceNumber
      ? String(data.linkedPurchaseInvoiceNumber)
      : undefined,
    linkedOrderId: data.linkedOrderId ? String(data.linkedOrderId) : undefined,
    linkedOrderNumber: data.linkedOrderNumber ? String(data.linkedOrderNumber) : undefined,
    createdAt: data.createdAt,
    createdBy: data.createdBy ? String(data.createdBy) : undefined,
  };
}

export async function ensureDefaultAccountLedgers(): Promise<AccountLedger[]> {
  const snap = await getDocs(collection(db, ACCOUNT_LEDGERS));
  const existing = snap.docs.map((d) => mapLedger(d.id, d.data() as Record<string, unknown>));
  const byCode = new Map(existing.map((l) => [l.code, l]));
  const uid = auth.currentUser?.uid || '';

  for (const seed of SYSTEM_LEDGERS) {
    if (byCode.has(seed.code)) continue;
    await setDoc(doc(db, ACCOUNT_LEDGERS, seed.code), {
      ...seed,
      createdAt: Timestamp.now(),
      createdBy: uid,
    });
  }

  const again = await getDocs(collection(db, ACCOUNT_LEDGERS));
  return again.docs.map((d) => mapLedger(d.id, d.data() as Record<string, unknown>));
}

export async function getAccountLedgers(): Promise<AccountLedger[]> {
  let rows = await ensureDefaultAccountLedgers();
  if (!rows.length) {
    const snap = await getDocs(collection(db, ACCOUNT_LEDGERS));
    rows = snap.docs.map((d) => mapLedger(d.id, d.data() as Record<string, unknown>));
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function createAccountLedger(input: {
  name: string;
  type: AccountLedgerType;
  openingBalance?: number;
}): Promise<AccountLedger> {
  const name = input.name.trim();
  if (!name) throw new Error('Ledger name is required');
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Please login to continue');
  const code = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24) || `L${Date.now()}`;
  const ref = await addDoc(collection(db, ACCOUNT_LEDGERS), {
    code,
    name,
    type: input.type,
    openingBalance: Number(input.openingBalance) || 0,
    isSystem: false,
    isActive: true,
    createdAt: Timestamp.now(),
    createdBy: uid,
  });
  return {
    id: ref.id,
    code,
    name,
    type: input.type,
    openingBalance: Number(input.openingBalance) || 0,
    isSystem: false,
    isActive: true,
    createdBy: uid,
  };
}

export async function updateAccountLedgerOpening(
  ledgerId: string,
  openingBalance: number
): Promise<void> {
  await updateDoc(doc(db, ACCOUNT_LEDGERS, ledgerId), {
    openingBalance: Number(openingBalance) || 0,
  });
}

export type CreateAccountVoucherInput = {
  voucherType: AccountVoucherType;
  date: Date;
  amount: number;
  cashBankLedgerId: string;
  contraLedgerId?: string;
  categoryLedgerId?: string;
  partyType?: AccountVoucher['partyType'];
  partyId?: string;
  partyName?: string;
  paymentMethod?: PaymentMethod;
  transactionId?: string;
  narration?: string;
  linkedPurchaseInvoiceId?: string;
  linkedOrderId?: string;
};

export async function getAccountVouchers(fromDate: Date, toDate: Date): Promise<AccountVoucher[]> {
  const from = Timestamp.fromDate(new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()));
  const to = Timestamp.fromDate(
    new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999)
  );
  try {
    const snap = await getDocs(
      query(
        collection(db, ACCOUNT_VOUCHERS),
        where('date', '>=', from),
        where('date', '<=', to)
      )
    );
    return snap.docs
      .map((d) => mapVoucher(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => toLedgerDate(a.date).getTime() - toLedgerDate(b.date).getTime());
  } catch (error) {
    console.warn('Account voucher range query failed, scanning collection:', error);
    const snap = await getDocs(collection(db, ACCOUNT_VOUCHERS));
    const fromMs = from.toMillis();
    const toMs = to.toMillis();
    return snap.docs
      .map((d) => mapVoucher(d.id, d.data() as Record<string, unknown>))
      .filter((v) => {
        const t = toLedgerDate(v.date).getTime();
        return t >= fromMs && t <= toMs;
      })
      .sort((a, b) => toLedgerDate(a.date).getTime() - toLedgerDate(b.date).getTime());
  }
}

/** Include older vouchers so cash/bank opening can be computed. */
export async function getAccountVouchersUpTo(toDate: Date): Promise<AccountVoucher[]> {
  const to = Timestamp.fromDate(
    new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999)
  );
  try {
    const snap = await getDocs(
      query(collection(db, ACCOUNT_VOUCHERS), where('date', '<=', to))
    );
    return snap.docs
      .map((d) => mapVoucher(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => toLedgerDate(a.date).getTime() - toLedgerDate(b.date).getTime());
  } catch (error) {
    console.warn('Account voucher up-to query failed, scanning collection:', error);
    const snap = await getDocs(collection(db, ACCOUNT_VOUCHERS));
    const toMs = to.toMillis();
    return snap.docs
      .map((d) => mapVoucher(d.id, d.data() as Record<string, unknown>))
      .filter((v) => toLedgerDate(v.date).getTime() <= toMs)
      .sort((a, b) => toLedgerDate(a.date).getTime() - toLedgerDate(b.date).getTime());
  }
}

export async function createAccountVoucher(
  input: CreateAccountVoucherInput
): Promise<{ voucher: AccountVoucher; linkWarnings: string[] }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Please login to continue');

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  const ledgers = await getAccountLedgers();
  const cashBank = ledgers.find((l) => l.id === input.cashBankLedgerId);
  if (!cashBank || (cashBank.type !== 'cash' && cashBank.type !== 'bank')) {
    throw new Error('Select a Cash or Bank account');
  }

  let contra: AccountLedger | undefined;
  if (input.voucherType === 'contra') {
    contra = ledgers.find((l) => l.id === input.contraLedgerId);
    if (!contra || (contra.type !== 'cash' && contra.type !== 'bank')) {
      throw new Error('Contra needs a destination Cash or Bank account');
    }
    if (contra.id === cashBank.id) {
      throw new Error('Contra source and destination must be different');
    }
  }

  let category: AccountLedger | undefined;
  if (input.categoryLedgerId) {
    category = ledgers.find((l) => l.id === input.categoryLedgerId);
  }
  if (input.voucherType === 'expense' && !category) {
    throw new Error('Select an expense ledger');
  }

  const stamp = istDateStampCompact(input.date);
  const voucherNo = `AV-${stamp}-${String(Date.now()).slice(-5)}`;

  let linkedPurchaseInvoiceNumber: string | undefined;
  let linkedOrderNumber: string | undefined;
  const linkWarnings: string[] = [];

  let linkedInvoice: Awaited<ReturnType<typeof getPurchaseInvoiceById>> | null = null;
  let linkedOrder: Awaited<ReturnType<typeof getOrderById>> | null = null;

  if (input.voucherType === 'payment' && input.linkedPurchaseInvoiceId) {
    linkedInvoice = await getPurchaseInvoiceById(input.linkedPurchaseInvoiceId);
    if (!linkedInvoice) throw new Error('Purchase invoice not found');
    linkedPurchaseInvoiceNumber = linkedInvoice.invoiceNumber;
  }

  if (input.voucherType === 'receipt' && input.linkedOrderId) {
    linkedOrder = await getOrderById(input.linkedOrderId);
    if (!linkedOrder) throw new Error('Order not found');
    linkedOrderNumber = linkedOrder.invoiceNumber || linkedOrder.id;
  }

  const payload = stripUndefinedDeep({
    voucherNo,
    voucherType: input.voucherType,
    date: Timestamp.fromDate(input.date),
    amount,
    cashBankLedgerId: cashBank.id,
    cashBankLedgerName: cashBank.name,
    contraLedgerId: contra?.id,
    contraLedgerName: contra?.name,
    categoryLedgerId: category?.id,
    categoryLedgerName: category?.name,
    partyType: input.partyType,
    partyId: input.partyId,
    partyName: input.partyName?.trim() || undefined,
    paymentMethod: input.paymentMethod,
    transactionId: input.transactionId?.trim() || undefined,
    narration: input.narration?.trim() || undefined,
    linkedPurchaseInvoiceId: input.linkedPurchaseInvoiceId,
    linkedPurchaseInvoiceNumber,
    linkedOrderId: input.linkedOrderId,
    linkedOrderNumber,
    createdAt: Timestamp.now(),
    createdBy: uid,
  });

  const ref = await addDoc(collection(db, ACCOUNT_VOUCHERS), payload);
  const snap = await getDoc(ref);
  const voucher = mapVoucher(ref.id, (snap.data() || payload) as Record<string, unknown>);

  const method: 'Cash' | 'Online' =
    cashBank.type === 'cash' || input.paymentMethod === 'Cash' ? 'Cash' : 'Online';

  if (linkedInvoice) {
    const total = Number(linkedInvoice.totalAmount) || 0;
    const prevPaid = Number(linkedInvoice.paidAmount) || 0;
    const nextPaid = Math.min(total, prevPaid + amount);
    const status = nextPaid >= total - 0.01 ? 'Paid' : 'Partial';
    try {
      await updatePurchaseInvoicePayment(
        linkedInvoice.id,
        status,
        method,
        nextPaid,
        input.date,
        input.transactionId
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      linkWarnings.push(`Voucher saved, but purchase invoice was not marked paid: ${msg}`);
    }
  }

  if (linkedOrder) {
    const total = Number(linkedOrder.totalAmount) || 0;
    const prevPaid = Number(linkedOrder.paidAmount) || 0;
    const nextPaid = Math.min(total, prevPaid + amount);
    const status = nextPaid >= total - 0.01 ? 'Paid' : nextPaid > 0.01 ? 'Partial' : 'Unpaid';
    try {
      await updatePaymentStatus(
        linkedOrder.id,
        status,
        nextPaid,
        total,
        method,
        input.transactionId
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      linkWarnings.push(`Voucher saved, but order payment was not updated: ${msg}`);
    }
  }

  return { voucher, linkWarnings };
}

export async function deleteAccountVoucher(voucherId: string): Promise<void> {
  const snap = await getDoc(doc(db, ACCOUNT_VOUCHERS, voucherId));
  if (!snap.exists()) return;
  const voucher = mapVoucher(snap.id, snap.data() as Record<string, unknown>);
  if (voucher.linkedPurchaseInvoiceId || voucher.linkedOrderId) {
    throw new Error(
      'Cannot delete a voucher that marked a bill or order paid. Reverse that payment from the invoice or order first.'
    );
  }
  await deleteDoc(doc(db, ACCOUNT_VOUCHERS, voucherId));
}
