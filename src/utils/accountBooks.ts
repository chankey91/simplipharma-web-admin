import type { AccountLedger, AccountVoucher } from '../types';
import { toLedgerDate } from './vendorLedger';

export type AccountBookLine = {
  date: Date;
  voucherNo: string;
  voucherType: AccountVoucher['voucherType'];
  particulars: string;
  inflow: number;
  outflow: number;
  balance: number;
};

export type AccountBookResult = {
  ledger: AccountLedger;
  fromDate: Date;
  toDate: Date;
  openingBalance: number;
  closingBalance: number;
  totalIn: number;
  totalOut: number;
  lines: AccountBookLine[];
};

function voucherAffectsLedger(
  v: AccountVoucher,
  ledgerId: string
): { inflow: number; outflow: number } | null {
  const amt = Number(v.amount) || 0;
  if (amt <= 0) return null;

  if (v.voucherType === 'receipt' && v.cashBankLedgerId === ledgerId) {
    return { inflow: amt, outflow: 0 };
  }
  if (
    (v.voucherType === 'payment' || v.voucherType === 'expense') &&
    v.cashBankLedgerId === ledgerId
  ) {
    return { inflow: 0, outflow: amt };
  }
  if (v.voucherType === 'contra') {
    if (v.cashBankLedgerId === ledgerId) return { inflow: 0, outflow: amt };
    if (v.contraLedgerId === ledgerId) return { inflow: amt, outflow: 0 };
  }
  return null;
}

function particulars(v: AccountVoucher): string {
  const party = (v.partyName || '').trim();
  const cat = (v.categoryLedgerName || '').trim();
  const narr = (v.narration || '').trim();
  if (v.voucherType === 'contra') {
    return `Contra: ${v.cashBankLedgerName} → ${v.contraLedgerName || ''}`.trim();
  }
  const bits = [party, cat, narr].filter(Boolean);
  return bits.join(' · ') || v.voucherType;
}

export function buildAccountBook(
  ledger: AccountLedger,
  vouchers: AccountVoucher[],
  fromDate: Date,
  toDate: Date
): AccountBookResult {
  const from = new Date(fromDate);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toDate);
  to.setHours(23, 59, 59, 999);
  const openingStart = Number(ledger.openingBalance) || 0;

  let openingDelta = 0;
  const period: Array<{ date: Date; voucher: AccountVoucher; inflow: number; outflow: number }> =
    [];

  for (const v of vouchers) {
    const hit = voucherAffectsLedger(v, ledger.id);
    if (!hit) continue;
    const d = toLedgerDate(v.date);
    if (d.getTime() < from.getTime()) {
      openingDelta += hit.inflow - hit.outflow;
      continue;
    }
    if (d.getTime() > to.getTime()) continue;
    period.push({ date: d, voucher: v, ...hit });
  }

  period.sort((a, b) => a.date.getTime() - b.date.getTime());

  let balance = openingStart + openingDelta;
  const openingBalance = balance;
  const lines: AccountBookLine[] = [];
  let totalIn = 0;
  let totalOut = 0;

  for (const row of period) {
    balance += row.inflow - row.outflow;
    totalIn += row.inflow;
    totalOut += row.outflow;
    lines.push({
      date: row.date,
      voucherNo: row.voucher.voucherNo,
      voucherType: row.voucher.voucherType,
      particulars: particulars(row.voucher),
      inflow: row.inflow,
      outflow: row.outflow,
      balance,
    });
  }

  return {
    ledger,
    fromDate: from,
    toDate: to,
    openingBalance,
    closingBalance: balance,
    totalIn,
    totalOut,
    lines,
  };
}

export function expenseTotalsByLedger(
  vouchers: AccountVoucher[],
  fromDate: Date,
  toDate: Date
): Array<{ ledgerId: string; ledgerName: string; amount: number }> {
  const from = new Date(fromDate);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toDate);
  to.setHours(23, 59, 59, 999);
  const map = new Map<string, { ledgerName: string; amount: number }>();

  for (const v of vouchers) {
    if (v.voucherType !== 'expense' && !(v.voucherType === 'payment' && v.categoryLedgerId)) {
      continue;
    }
    const d = toLedgerDate(v.date);
    if (d.getTime() < from.getTime() || d.getTime() > to.getTime()) continue;
    const id = v.categoryLedgerId || 'uncategorised';
    const name = v.categoryLedgerName || 'Uncategorised';
    const prev = map.get(id) || { ledgerName: name, amount: 0 };
    prev.amount += Number(v.amount) || 0;
    map.set(id, prev);
  }

  return [...map.entries()]
    .map(([ledgerId, row]) => ({ ledgerId, ...row }))
    .sort((a, b) => b.amount - a.amount);
}
