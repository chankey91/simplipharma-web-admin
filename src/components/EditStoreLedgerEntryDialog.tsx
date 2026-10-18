import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import { format } from 'date-fns';
import type { PaymentMethod } from '../types';
import type { StoreLedgerEntry } from '../utils/storeLedger';
import {
  getLedgerNote,
  updateLedgerNote,
  LEDGER_NOTE_GST_RATES,
  type LedgerNoteGstRate,
} from '../services/ledgerNotes';
import { getOrderLedgerPayment, updateOrderLedgerPayment } from '../services/orders';

const PAYMENT_METHODS: PaymentMethod[] = [
  'Cash',
  'Online',
  'Card',
  'UPI',
  'Bank Transfer',
  'Cheque',
];

const toInputDate = (d: Date) => format(d, 'yyyy-MM-dd');

function parseLocalDateInput(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return new Date(value);
  const now = new Date();
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );
}

type Props = {
  open: boolean;
  entry: StoreLedgerEntry | null;
  onClose: () => void;
  onSaved: () => void;
};

export const EditStoreLedgerEntryDialog: React.FC<Props> = ({
  open,
  entry,
  onClose,
  onSaved,
}) => {
  const [entryDate, setEntryDate] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [taxPercentage, setTaxPercentage] = useState<LedgerNoteGstRate>(5);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [transactionId, setTransactionId] = useState('');
  const [amountUsed, setAmountUsed] = useState(0);
  const [returnLinked, setReturnLinked] = useState(false);
  const [walletLocked, setWalletLocked] = useState(false);
  const [remitted, setRemitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const kind = entry?.sourceKind;
  const isPayment = kind === 'payment';
  const isNote = kind === 'credit_note' || kind === 'debit_note';
  const amountLocked = walletLocked || remitted || returnLinked;

  useEffect(() => {
    if (!open || !entry) return;
    let cancelled = false;
    setError('');
    setSaving(false);
    setEntryDate(toInputDate(entry.date));
    setAmount(String(entry.debit || entry.credit || ''));
    setReason('');
    setInvoiceRef(entry.vchNo === '-' ? '' : entry.vchNo);
    setTaxPercentage(5);
    setPaymentMethod('Cash');
    setTransactionId(entry.vchNo !== '-' ? entry.vchNo : '');
    setAmountUsed(0);
    setReturnLinked(false);
    setWalletLocked(Boolean(entry.walletLocked));
    setRemitted(false);

    const load = async () => {
      setLoading(true);
      try {
        if (isPayment && entry.orderId && entry.paymentId) {
          const snap = await getOrderLedgerPayment(entry.orderId, entry.paymentId);
          if (cancelled || !snap) return;
          const payDate =
            snap.payment.paymentDate instanceof Date
              ? snap.payment.paymentDate
              : snap.payment.paymentDate?.toDate?.() || entry.date;
          setEntryDate(toInputDate(payDate));
          setAmount(String(round2(Number(snap.payment.amount) || 0)));
          setPaymentMethod(
            PAYMENT_METHODS.includes(snap.payment.paymentMethod) ||
              snap.payment.paymentMethod === 'Wallet'
              ? snap.payment.paymentMethod
              : 'Cash'
          );
          setTransactionId(snap.payment.transactionId || '');
          setWalletLocked(
            Boolean(entry.walletLocked) ||
              snap.payment.settlementKind === 'wallet' ||
              String(snap.payment.paymentMethod || '').toUpperCase().includes('WALLET')
          );
          setRemitted(snap.remitted);
        } else if (isNote && entry.noteId) {
          const note = await getLedgerNote(
            kind === 'credit_note' ? 'credit' : 'debit',
            entry.noteId
          );
          if (cancelled || !note) return;
          setEntryDate(toInputDate(note.noteDate));
          setAmount(String(note.totalAmount));
          setReason(note.reason);
          setInvoiceRef(note.originalInvoiceNumber);
          setTaxPercentage(note.taxPercentage);
          setAmountUsed(note.amountUsed);
          setReturnLinked(note.returnLinked);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load entry');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, entry, isPayment, isNote, kind]);

  const title = isPayment
    ? 'Edit payment'
    : kind === 'credit_note'
      ? 'Edit credit note'
      : kind === 'debit_note'
        ? 'Edit debit note'
        : 'Edit ledger entry';

  const handleSave = async () => {
    if (!entry) return;
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter a valid amount greater than zero');
      return;
    }
    const nextDate = parseLocalDateInput(entryDate);
    if (Number.isNaN(nextDate.getTime())) {
      setError('Enter a valid date');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isPayment && entry.orderId && entry.paymentId) {
        await updateOrderLedgerPayment({
          orderId: entry.orderId,
          paymentId: entry.paymentId,
          paymentDate: nextDate,
          ...(walletLocked
            ? {}
            : {
                amount: parsedAmount,
                paymentMethod,
                transactionId,
              }),
        });
      } else if (isNote && entry.noteId) {
        await updateLedgerNote(kind === 'credit_note' ? 'credit' : 'debit', entry.noteId, {
          totalAmount: parsedAmount,
          noteDate: nextDate,
          reason,
          originalInvoiceNumber: invoiceRef,
          taxPercentage,
        });
      } else {
        throw new Error('This line cannot be edited');
      }
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        {walletLocked ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            Wallet receipts keep their amount. You can change the date only.
          </Alert>
        ) : null}
        {remitted ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            This cash is remitted, so the amount is locked. Date and reference can still change.
          </Alert>
        ) : null}
        {returnLinked ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            Return credit notes keep their amount. Date, reason, and invoice reference can change.
          </Alert>
        ) : null}
        {amountUsed > 0.01 ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            ₹{amountUsed.toFixed(2)} is already applied to invoices. New total must stay at least that
            amount. Unused wallet updates automatically.
          </Alert>
        ) : null}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              size="small"
              label="Date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              disabled={loading || saving}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              size="small"
              label={kind === 'credit_note' ? 'Credit note amount' : 'Amount'}
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={loading || saving || amountLocked}
              inputProps={{ min: 0, step: '0.01' }}
            />
          </Grid>
          {isPayment ? (
            <>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small" disabled={loading || saving || walletLocked}>
                  <InputLabel>Method</InputLabel>
                  <Select
                    label="Method"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  >
                    {(paymentMethod === 'Wallet'
                      ? (['Wallet', ...PAYMENT_METHODS] as PaymentMethod[])
                      : PAYMENT_METHODS
                    ).map((method) => (
                      <MenuItem key={method} value={method}>
                        {method}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Transaction / cheque no."
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  disabled={loading || saving || walletLocked}
                />
              </Grid>
            </>
          ) : null}
          {isNote ? (
            <>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small" disabled={loading || saving}>
                  <InputLabel>GST</InputLabel>
                  <Select
                    label="GST"
                    value={taxPercentage}
                    onChange={(e) => setTaxPercentage(Number(e.target.value) as LedgerNoteGstRate)}
                  >
                    {LEDGER_NOTE_GST_RATES.map((rate) => (
                      <MenuItem key={rate} value={rate}>
                        {rate}%
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Invoice reference"
                  value={invoiceRef}
                  onChange={(e) => setInvoiceRef(e.target.value)}
                  disabled={loading || saving}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  label="Reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={loading || saving}
                />
              </Grid>
            </>
          ) : null}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={loading || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
