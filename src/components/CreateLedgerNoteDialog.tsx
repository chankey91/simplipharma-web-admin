import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Alert,
} from '@mui/material';
import { format } from 'date-fns';
import { useStores } from '../hooks/useStores';
import {
  createDirectLedgerCreditNote,
  createDirectLedgerDebitNote,
  LEDGER_NOTE_GST_RATES,
  type LedgerNoteGstRate,
} from '../services/ledgerNotes';
import { setRetailerWalletBalance } from '../services/retailerWallet';

type NoteKind = 'credit' | 'debit';

type Props = {
  open: boolean;
  kind: NoteKind;
  onClose: () => void;
  onCreated: (result: { id: string; documentNumber: string }) => void;
  /** Prefill medical store (e.g. from Stores → Wallet). */
  initialRetailerId?: string;
  /** Hide store search/select when store is already chosen. */
  lockRetailer?: boolean;
  /** Prefill total amount (tax-inclusive). */
  initialAmount?: number;
  /** Prefill reason. */
  initialReason?: string;
  /** `set-balance` posts a credit or debit so wallet equals the entered amount. */
  mode?: 'direct' | 'set-balance';
  currentWalletAvailable?: number;
};

const toInputDate = (d: Date) => format(d, 'yyyy-MM-dd');

/** Parse `<input type="date">` value as local calendar day with the current wall-clock time. */
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
    now.getMilliseconds(),
  );
}

function mapCreateNoteError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (/INTERNAL ASSERTION FAILED/i.test(msg) || /Unexpected state/i.test(msg)) {
    return (
      'Firestore client crashed (local cache). Reload this page, keep only one admin tab open, then try again. ' +
      'If it persists, clear site data for this origin and sign in again.'
    );
  }
  return msg || 'Failed to create note';
}

export const CreateLedgerNoteDialog: React.FC<Props> = ({
  open,
  kind,
  onClose,
  onCreated,
  initialRetailerId,
  lockRetailer,
  initialAmount,
  initialReason,
  mode = 'direct',
  currentWalletAvailable = 0,
}) => {
  const { data: stores = [] } = useStores(open);
  const [retailerId, setRetailerId] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const [noteDate, setNoteDate] = useState(toInputDate(new Date()));
  const [totalAmount, setTotalAmount] = useState('');
  const [taxPercentage, setTaxPercentage] = useState<LedgerNoteGstRate>(5);
  const [reason, setReason] = useState('');
  const [originalInvoiceNumber, setOriginalInvoiceNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setRetailerId(initialRetailerId?.trim() || '');
    setStoreSearch('');
    setNoteDate(toInputDate(new Date()));
    setTotalAmount(
      initialAmount != null && Number.isFinite(initialAmount) && initialAmount >= 0
        ? String(Math.round(initialAmount * 100) / 100)
        : mode === 'set-balance' && Number.isFinite(currentWalletAvailable)
          ? String(Math.round(currentWalletAvailable * 100) / 100)
          : ''
    );
    setTaxPercentage(5);
    setReason(initialReason?.trim() || '');
    setOriginalInvoiceNumber('');
    setError('');
    setSaving(false);
  }, [open, kind, initialRetailerId, initialAmount, initialReason, mode, currentWalletAvailable]);

  const filteredStores = useMemo(() => {
    const q = storeSearch.trim().toLowerCase();
    const list = stores.filter((s) => s.isActive !== false);
    if (!q) return list;
    return list.filter(
      (s) =>
        (s.shopName || '').toLowerCase().includes(q) ||
        (s.displayName || '').toLowerCase().includes(q) ||
        (s.storeCode || '').toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q)
    );
  }, [stores, storeSearch]);

  const handleSubmit = async () => {
    setError('');
    setSaving(true);
    try {
      if (mode === 'set-balance') {
        const result = await setRetailerWalletBalance({
          retailerId,
          targetAmount: parseFloat(totalAmount),
          reason,
          noteDate: parseLocalDateInput(noteDate),
          originalInvoiceNumber: originalInvoiceNumber.trim() || undefined,
          taxPercentage,
        });
        if (result.kind === 'none') {
          setError('Wallet is already at this amount.');
          return;
        }
        onCreated({
          id: result.id || '',
          documentNumber: result.documentNumber || '',
        });
        onClose();
        return;
      }
      const payload = {
        retailerId,
        totalAmount: parseFloat(totalAmount),
        reason,
        noteDate: parseLocalDateInput(noteDate),
        originalInvoiceNumber: originalInvoiceNumber.trim() || undefined,
        taxPercentage,
      };
      const result =
        kind === 'credit'
          ? await createDirectLedgerCreditNote(payload)
          : await createDirectLedgerDebitNote(payload);
      onCreated({
        id: result.id,
        documentNumber:
          kind === 'credit'
            ? (result as { creditNoteNumber: string }).creditNoteNumber
            : (result as { debitNoteNumber: string }).debitNoteNumber,
      });
      onClose();
    } catch (e: unknown) {
      setError(mapCreateNoteError(e));
    } finally {
      setSaving(false);
    }
  };

  const isSetBalance = mode === 'set-balance';
  const targetAmount = parseFloat(totalAmount);
  const setBalanceDelta =
    isSetBalance && Number.isFinite(targetAmount)
      ? Math.round((targetAmount - currentWalletAvailable) * 100) / 100
      : 0;
  const title = isSetBalance
    ? 'Set wallet balance'
    : kind === 'credit'
      ? 'Create ledger credit note'
      : 'Create ledger debit note';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mt: 1, mb: 2 }}>
          {isSetBalance
            ? `Current wallet ${`₹${(currentWalletAvailable || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}. A ledger credit or debit note is posted for the difference.`
            : "Posted to the store ledger and the retailer's wallet immediately (no return approval required)."}
        </Alert>
        {isSetBalance && Number.isFinite(targetAmount) && Math.abs(setBalanceDelta) > 0.01 ? (
          <Alert severity={setBalanceDelta > 0 ? 'success' : 'warning'} sx={{ mb: 2 }}>
            Will post a {setBalanceDelta > 0 ? 'credit' : 'debit'} note of ₹
            {Math.abs(setBalanceDelta).toLocaleString('en-IN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            .
          </Alert>
        ) : null}
        {error ? (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={
              /Firestore client crashed|INTERNAL ASSERTION/i.test(error) ? (
                <Button color="inherit" size="small" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              ) : undefined
            }
          >
            {error}
          </Alert>
        ) : null}
        <Grid container spacing={2}>
          {!lockRetailer ? (
            <>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  label="Search store"
                  value={storeSearch}
                  onChange={(e) => setStoreSearch(e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth size="small" required>
                  <InputLabel>Medical store</InputLabel>
                  <Select
                    label="Medical store"
                    value={retailerId}
                    onChange={(e) => setRetailerId(e.target.value)}
                  >
                    <MenuItem value="">
                      <em>Select store</em>
                    </MenuItem>
                    {filteredStores.map((s) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.shopName || s.displayName || s.email}
                        {s.storeCode ? ` (${s.storeCode})` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </>
          ) : (
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                label="Medical store"
                value={
                  filteredStores.find((s) => s.id === retailerId)?.shopName ||
                  stores.find((s) => s.id === retailerId)?.shopName ||
                  stores.find((s) => s.id === retailerId)?.displayName ||
                  stores.find((s) => s.id === retailerId)?.email ||
                  retailerId
                }
                InputProps={{ readOnly: true }}
              />
            </Grid>
          )}
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              size="small"
              label="Note date"
              type="date"
              value={noteDate}
              onChange={(e) => setNoteDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              size="small"
              label={isSetBalance ? 'New wallet balance' : 'Total amount (incl. tax)'}
              type="number"
              inputProps={{ min: 0, step: '0.01' }}
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth size="small" required>
              <InputLabel>GST %</InputLabel>
              <Select
                label="GST %"
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
              label="Original invoice (optional)"
              value={originalInvoiceNumber}
              onChange={(e) => setOriginalInvoiceNumber(e.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Reason"
              multiline
              minRows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={saving}>
          {saving ? 'Saving…' : isSetBalance ? 'Set balance' : 'Create note'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
