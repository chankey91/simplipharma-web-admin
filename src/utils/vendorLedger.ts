import { PurchaseInvoice, Vendor } from '../types';

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

/** Purchase bill still owed to vendor */
export function isPayablePurchaseInvoice(inv: PurchaseInvoice): boolean {
  const ps = inv.paymentStatus;
  return ps === 'Unpaid' || ps === 'Partial' || !ps;
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
