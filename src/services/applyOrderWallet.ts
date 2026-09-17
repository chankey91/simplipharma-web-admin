import { addDoc, collection, db, getDocs, Timestamp, updateDoc } from './firebase';
import type { PaymentRequestCreditApplication } from '../types';
import {
  allocateWalletApplications,
  computeWalletAvailable,
  roundMoney2,
  type WalletCreditNote,
  type WalletDebitNote,
} from '../utils/retailerWallet';
import { getRetailerWalletSummary } from './retailerWallet';
import { applyCreditApplications, reverseCreditApplications } from './paymentRequests';

export async function applyRetailerWalletTowardAmount(
  retailerId: string,
  amount: number
): Promise<{ applied: number; applications: PaymentRequestCreditApplication[] }> {
  const wanted = roundMoney2(Math.max(0, amount));
  if (!retailerId.trim() || wanted <= 0.01) {
    return { applied: 0, applications: [] };
  }

  const summary = await getRetailerWalletSummary(retailerId);
  const cap = roundMoney2(Math.min(wanted, summary.available));
  if (cap <= 0.01) return { applied: 0, applications: [] };

  const applications = allocateWalletApplications(summary.notes, cap);
  const applied = await applyCreditApplications(applications);
  return {
    applied,
    applications,
  };
}

export async function postWalletPaymentOnOrder(input: {
  orderId: string;
  amount: number;
  applications: PaymentRequestCreditApplication[];
  note?: string;
}): Promise<void> {
  const amount = roundMoney2(input.amount);
  if (amount <= 0.01) return;
  await addDoc(collection(db, 'orders', input.orderId, 'payments'), {
    orderId: input.orderId,
    amount,
    paymentDate: Timestamp.now(),
    paymentMethod: 'Wallet',
    settlementKind: 'wallet',
    notes: input.note || 'Wallet applied at invoice',
    creditApplications: input.applications,
    createdAt: Timestamp.now(),
  });
}

export async function rollbackWalletApplications(
  apps: PaymentRequestCreditApplication[]
): Promise<void> {
  if (apps?.length) await reverseCreditApplications(apps);
}

export async function reverseFulfillmentWallet(
  orderId: string,
  fallbackApps?: PaymentRequestCreditApplication[]
): Promise<void> {
  const paymentsSnap = await getDocs(collection(db, 'orders', orderId, 'payments'));
  const apps: PaymentRequestCreditApplication[] = [];
  for (const d of paymentsSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (String(data.settlementKind || '') !== 'wallet') continue;
    if (Number(data.amount ?? 0) <= 0.01) continue;
    const stored = Array.isArray(data.creditApplications)
      ? (data.creditApplications as PaymentRequestCreditApplication[])
      : [];
    apps.push(...stored);
    await updateDoc(d.ref, {
      amount: 0,
      reversedAt: Timestamp.now(),
      notes: `${String(data.notes || 'Wallet applied at invoice')} (reversed on un-fulfill)`,
    });
  }
  const toReverse = apps.length ? apps : fallbackApps || [];
  if (toReverse.length) await reverseCreditApplications(toReverse);
}

export function walletAvailableFromNotes(
  notes: WalletCreditNote[],
  debitNotes: WalletDebitNote[]
): number {
  return computeWalletAvailable(notes, debitNotes);
}
