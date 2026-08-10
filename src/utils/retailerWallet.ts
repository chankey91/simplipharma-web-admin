/** Retailer wallet math — mirrors simplipharma-web-app credit/wallet ledger. */

export function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type WalletCreditNote = {
  id: string;
  creditNoteNumber: string;
  amount: number;
  amountUsed: number;
  creditNoteDate?: Date | null;
  status: 'available' | 'fully_used' | 'cancelled';
  returnType?: 'order_return' | 'expiry_return' | 'credit_note';
  returnRequestId?: string;
  reason?: string;
};

export type WalletDebitNote = {
  id: string;
  debitNoteNumber: string;
  amount: number;
  debitNoteDate?: Date | null;
  reason?: string;
};

export type WalletOrderDebit = {
  id: string;
  invoiceNumber?: string;
  creditApplied: number;
  orderDate?: Date | null;
};

export type WalletTxn = {
  id: string;
  kind: 'credit' | 'debit';
  label: string;
  ref: string;
  amount: number;
  at: Date | null;
  reason?: string;
  balanceAfter?: number;
};

function toMillis(d: Date | unknown): number {
  if (!d) return 0;
  const t = d instanceof Date ? d.getTime() : new Date(d as string | number).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function asDate(input: unknown): Date | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

const APPROVED_RETURN_STATUSES = new Set(['approved', 'paid']);

export function sumCreditAvailable(notes: WalletCreditNote[]): number {
  return roundMoney2(
    notes.reduce((sum, n) => {
      if (n.status === 'cancelled') return sum;
      const rem = roundMoney2(n.amount - (n.amountUsed || 0));
      return sum + (rem > 0.01 ? rem : 0);
    }, 0)
  );
}

export function computeWalletAvailable(
  notes: WalletCreditNote[],
  debitNotes: WalletDebitNote[]
): number {
  const creditAvail = sumCreditAvailable(notes);
  const debitTotal = roundMoney2(debitNotes.reduce((sum, n) => sum + n.amount, 0));
  return Math.max(0, roundMoney2(creditAvail - debitTotal));
}

type ReturnLike = {
  id: string;
  retailerId: string;
  status: string;
  totalRefundAmount?: number;
  creditNoteAmount?: number;
  creditAmountUsed?: number;
  creditNoteNumber?: string;
  paymentReferenceNumber?: string;
  creditNoteDate?: unknown;
  approvedAt?: unknown;
  createdAt?: unknown;
};

function noteFromReturn(
  r: ReturnLike,
  returnType: 'order_return' | 'expiry_return'
): WalletCreditNote | null {
  if (!APPROVED_RETURN_STATUSES.has(r.status)) return null;
  const amount =
    typeof r.creditNoteAmount === 'number' && r.creditNoteAmount > 0
      ? roundMoney2(r.creditNoteAmount)
      : roundMoney2(r.totalRefundAmount || 0);
  if (amount <= 0) return null;
  const amountUsed = roundMoney2(r.creditAmountUsed ?? 0);
  const remaining = roundMoney2(amount - amountUsed);
  const explicit = (r.creditNoteNumber || r.paymentReferenceNumber || '').trim();
  return {
    id: r.id,
    creditNoteNumber: explicit || `CN-${r.id.slice(0, 8).toUpperCase()}`,
    amount,
    amountUsed,
    creditNoteDate: asDate(r.creditNoteDate ?? r.approvedAt ?? r.createdAt),
    status: remaining <= 0.01 ? 'fully_used' : 'available',
    returnType,
    returnRequestId: r.id,
  };
}

/** Merge dedicated credit_notes with return-derived notes (prefer dedicated). */
export function mergeWalletCreditNotes(
  dedicated: WalletCreditNote[],
  fromExpiry: ReturnLike[],
  fromOrders: ReturnLike[]
): WalletCreditNote[] {
  const byReturnKey = new Map<string, WalletCreditNote>();
  const byCreditNoteNumber = new Set<string>();
  for (const n of dedicated) {
    if (n.returnRequestId && n.returnType && n.returnType !== 'credit_note') {
      byReturnKey.set(`${n.returnType}:${n.returnRequestId}`, n);
    }
    const num = (n.creditNoteNumber || '').trim().toLowerCase();
    if (num) byCreditNoteNumber.add(num);
  }

  const out: WalletCreditNote[] = [...dedicated];
  const seenIds = new Set(dedicated.map((n) => n.id));

  const addFromReturn = (note: WalletCreditNote | null) => {
    if (!note) return;
    const key =
      note.returnType && note.returnRequestId
        ? `${note.returnType}:${note.returnRequestId}`
        : null;
    if (key && byReturnKey.has(key)) return;
    const num = (note.creditNoteNumber || '').trim().toLowerCase();
    if (num && byCreditNoteNumber.has(num)) return;
    if (seenIds.has(note.id)) return;
    out.push(note);
    seenIds.add(note.id);
  };

  for (const r of fromExpiry) addFromReturn(noteFromReturn(r, 'expiry_return'));
  for (const r of fromOrders) addFromReturn(noteFromReturn(r, 'order_return'));

  out.sort((a, b) => toMillis(b.creditNoteDate) - toMillis(a.creditNoteDate));
  return out;
}

export function buildWalletTransactions(
  notes: WalletCreditNote[],
  debitNotes: WalletDebitNote[],
  orderDebits: WalletOrderDebit[],
  available: number
): WalletTxn[] {
  const credits: WalletTxn[] = notes
    .filter((n) => n.creditNoteNumber?.trim() && (n.amount || 0) > 0.01)
    .map((n) => ({
      id: `cn:${n.id}`,
      kind: 'credit' as const,
      label: 'Credited',
      ref: n.creditNoteNumber,
      amount: Math.max(0, n.amount || 0),
      at: asDate(n.creditNoteDate),
      reason: n.reason,
    }));

  const fromOrders: WalletTxn[] = orderDebits.map((o) => ({
    id: `ord:${o.id}`,
    kind: 'debit' as const,
    label: 'Used on invoice',
    ref: o.invoiceNumber?.trim() || o.id,
    amount: Math.max(0, o.creditApplied || 0),
    at: asDate(o.orderDate),
  }));

  const fromDebits: WalletTxn[] = debitNotes.map((n) => ({
    id: `dn:${n.id}`,
    kind: 'debit' as const,
    label: 'Debit note',
    ref: n.debitNoteNumber,
    amount: Math.max(0, n.amount || 0),
    at: asDate(n.debitNoteDate),
    reason: n.reason,
  }));

  const debits = [...fromOrders, ...fromDebits].filter((tx) => tx.amount > 0.01);

  const asc = [...credits, ...debits].sort(
    (a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0)
  );
  let running = 0;
  const withBalance = asc.map((tx) => {
    running += tx.kind === 'credit' ? tx.amount : -tx.amount;
    return { ...tx, balanceAfter: running };
  });
  const currentFromLedger =
    withBalance.length > 0 ? withBalance[withBalance.length - 1].balanceAfter || 0 : 0;
  const targetCurrent = Math.max(0, Number(available || 0));
  const reconcileDelta = targetCurrent - currentFromLedger;
  return withBalance
    .map((tx) => ({
      ...tx,
      balanceAfter: (tx.balanceAfter || 0) + reconcileDelta,
    }))
    .reverse();
}
