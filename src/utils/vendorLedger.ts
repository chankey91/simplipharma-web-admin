import { endOfDay, startOfDay } from 'date-fns';
import { PurchaseInvoice, Vendor, VendorInvoicePayment } from '../types';

export type VendorLedgerVchType = 'Purchase' | 'Receipt' | 'Opening';

export type VendorLedgerEntry = {
  date: Date;
  particulars: string;
  particularsBold?: string;
  vchType: VendorLedgerVchType;
  vchNo: string;
  debit: number;
  credit: number;
  balance: number;
  isSummary?: boolean;
};

export type VendorLedgerResult = {
  vendor: Vendor | null;
  vendorName: string;
  vendorAddress: string;
  fromDate: Date;
  toDate: Date;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  entries: VendorLedgerEntry[];
};

export type PayablePurchaseInvoice = PurchaseInvoice & {
  outstanding: number;
};

export type VendorLedgerSummary = {
  vendorId: string;
  vendor: Vendor | null;
  displayName: string;
  gstNumber: string;
  phone: string;
  invoiceCount: number;
  totalOutstanding: number;
  oldestInvoiceDate: Date | null;
  invoices: PayablePurchaseInvoice[];
};

/** Indian financial year default: 1 Apr – today */
export function defaultVendorLedgerDateRange(): { from: Date; to: Date } {
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    from: new Date(fyStartYear, 3, 1),
    to: now,
  };
}

export function toLedgerDate(value: Date | unknown): Date {
  if (value instanceof Date) return value;
  const d = new Date(value as string | number);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

export function formatLedgerAmount(n: number): string {
  if (!n) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function purchaseInvoiceOutstanding(inv: PurchaseInvoice): number {
  if (inv.paymentStatus === 'Paid') return 0;
  if (inv.paymentStatus === 'Partial') {
    if (inv.paidAmount != null && inv.paidAmount > 0) {
      return Math.max(0, (inv.totalAmount ?? 0) - inv.paidAmount);
    }
    return inv.totalAmount ?? 0;
  }
  return inv.totalAmount ?? 0;
}

export function isPayablePurchaseInvoice(inv: PurchaseInvoice): boolean {
  const ps = inv.paymentStatus;
  return ps === 'Unpaid' || ps === 'Partial' || !ps;
}

/** Resolve credit lines from stored payments or synthesize from paidAmount for legacy data. */
export function extractVendorPaymentCredits(inv: PurchaseInvoice): VendorInvoicePayment[] {
  if (Array.isArray(inv.payments) && inv.payments.length > 0) {
    return inv.payments.filter((p) => (p.amount ?? 0) > 0);
  }

  const paid = inv.paidAmount ?? 0;
  if (paid <= 0 || inv.paymentStatus === 'Unpaid') return [];

  const paymentDate =
    inv.paidAt != null
      ? toLedgerDate(inv.paidAt)
      : toLedgerDate(inv.invoiceDate);

  return [
    {
      id: `legacy-${inv.id}`,
      amount: paid,
      paymentDate,
      paymentMethod: inv.paymentMethod,
    },
  ];
}

function paymentParticulars(method?: string): { text: string; bold: string } {
  const m = (method || 'Cash').toUpperCase();
  if (m.includes('ONLINE') || m.includes('UPI') || m.includes('BANK')) {
    return { text: 'By ', bold: 'BANK / ONLINE' };
  }
  return { text: 'By ', bold: 'CASH' };
}

function inRange(d: Date, from: Date, to: Date): boolean {
  const t = d.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

function beforeRange(d: Date, from: Date): boolean {
  return d.getTime() < from.getTime();
}

export function buildVendorLedger(
  vendor: Vendor | null,
  invoices: PurchaseInvoice[],
  fromDate: Date,
  toDate: Date
): VendorLedgerResult {
  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  let openingDebits = 0;
  let openingCredits = 0;

  const periodLines: Array<Omit<VendorLedgerEntry, 'balance'>> = [];

  for (const inv of invoices) {
    const invoiceDate = toLedgerDate(inv.invoiceDate);
    const total = inv.totalAmount ?? 0;
    const credits = extractVendorPaymentCredits(inv);

    if (beforeRange(invoiceDate, from)) {
      openingDebits += total;
    } else if (inRange(invoiceDate, from, to)) {
      periodLines.push({
        date: invoiceDate,
        particulars: 'To ',
        particularsBold: 'PURCHASE',
        vchType: 'Purchase',
        vchNo: inv.invoiceNumber || inv.id,
        debit: total,
        credit: 0,
      });
    }

    for (const pay of credits) {
      const payDate = toLedgerDate(pay.paymentDate);
      const amt = pay.amount ?? 0;
      if (amt <= 0) continue;

      if (beforeRange(payDate, from)) {
        openingCredits += amt;
      } else if (inRange(payDate, from, to)) {
        const { text, bold } = paymentParticulars(pay.paymentMethod);
        periodLines.push({
          date: payDate,
          particulars: text,
          particularsBold: bold,
          vchType: 'Receipt',
          vchNo: pay.transactionId || pay.id || inv.invoiceNumber,
          debit: 0,
          credit: amt,
        });
      }
    }
  }

  periodLines.sort((a, b) => {
    const cmp = a.date.getTime() - b.date.getTime();
    if (cmp !== 0) return cmp;
    if (a.vchType === b.vchType) return a.vchNo.localeCompare(b.vchNo);
    return a.vchType === 'Purchase' ? -1 : 1;
  });

  const openingBalance = openingDebits - openingCredits;
  let running = openingBalance;
  const entries: VendorLedgerEntry[] = [];

  if (openingBalance !== 0) {
    entries.push({
      date: from,
      particulars: 'Opening Balance',
      vchType: 'Opening',
      vchNo: '',
      debit: openingBalance > 0 ? openingBalance : 0,
      credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
      balance: openingBalance,
      isSummary: true,
    });
    running = openingBalance;
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of periodLines) {
    running += line.debit - line.credit;
    totalDebit += line.debit;
    totalCredit += line.credit;
    entries.push({ ...line, balance: running });
  }

  const vendorName =
    vendor?.vendorName || invoices[0]?.vendorName || 'Unknown vendor';

  return {
    vendor,
    vendorName,
    vendorAddress: vendor?.address?.trim() || '—',
    fromDate: from,
    toDate: to,
    openingBalance,
    closingBalance: running,
    totalDebit,
    totalCredit,
    entries,
  };
}

/** Legacy payables summary — kept for any callers still using open-bills view. */
export function buildVendorLedgerSummaries(
  invoices: PurchaseInvoice[],
  vendors: Vendor[]
): VendorLedgerSummary[] {
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const byVendor = new Map<string, PayablePurchaseInvoice[]>();

  for (const inv of invoices) {
    if (!isPayablePurchaseInvoice(inv)) continue;
    const outstanding = purchaseInvoiceOutstanding(inv);
    if (outstanding <= 0) continue;
    const vendorId = inv.vendorId || 'unknown';
    const list = byVendor.get(vendorId) ?? [];
    list.push({ ...inv, outstanding });
    byVendor.set(vendorId, list);
  }

  const summaries: VendorLedgerSummary[] = [];
  for (const [vendorId, payableInvoices] of byVendor) {
    const vendor = vendorById.get(vendorId) ?? null;
    payableInvoices.sort(
      (a, b) =>
        new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime()
    );
    const dates = payableInvoices
      .map((inv) => new Date(inv.invoiceDate))
      .filter((d) => !isNaN(d.getTime()));
    summaries.push({
      vendorId,
      vendor,
      displayName: vendor?.vendorName || payableInvoices[0]?.vendorName || 'Unknown vendor',
      gstNumber: vendor?.gstNumber || '—',
      phone: vendor?.phoneNumber || '—',
      invoiceCount: payableInvoices.length,
      totalOutstanding: payableInvoices.reduce((s, inv) => s + inv.outstanding, 0),
      oldestInvoiceDate: dates.length
        ? new Date(Math.min(...dates.map((d) => d.getTime())))
        : null,
      invoices: payableInvoices,
    });
  }

  return summaries.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
}
