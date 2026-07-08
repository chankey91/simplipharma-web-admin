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
} from '../services/ledgerNotes';

type NoteKind = 'credit' | 'debit';

type Props = {
  open: boolean;
  kind: NoteKind;
  onClose: () => void;
  onCreated: (result: { id: string; documentNumber: string }) => void;
};

const toInputDate = (d: Date) => format(d, 'yyyy-MM-dd');

export const CreateLedgerNoteDialog: React.FC<Props> = ({ open, kind, onClose, onCreated }) => {
  const { data: stores = [] } = useStores(open);
  const [retailerId, setRetailerId] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const [noteDate, setNoteDate] = useState(toInputDate(new Date()));
  const [totalAmount, setTotalAmount] = useState('');
  const [taxPercentage, setTaxPercentage] = useState('5');
  const [reason, setReason] = useState('');
  const [originalInvoiceNumber, setOriginalInvoiceNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setRetailerId('');
    setStoreSearch('');
    setNoteDate(toInputDate(new Date()));
    setTotalAmount('');
    setTaxPercentage('5');
    setReason('');
    setOriginalInvoiceNumber('');
    setError('');
    setSaving(false);
  }, [open, kind]);

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
      const payload = {
        retailerId,
        totalAmount: parseFloat(totalAmount),
        reason,
        noteDate: new Date(noteDate),
        originalInvoiceNumber: originalInvoiceNumber.trim() || undefined,
        taxPercentage: parseFloat(taxPercentage),
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
      setError(e instanceof Error ? e.message : 'Failed to create note');
    } finally {
      setSaving(false);
    }
  };

  const title = kind === 'credit' ? 'Create ledger credit note' : 'Create ledger debit note';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mt: 1, mb: 2 }}>
          Posted to the store ledger and the retailer&apos;s wallet immediately (no return approval required).
        </Alert>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Grid container spacing={2}>
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
              label="Total amount (incl. tax)"
              type="number"
              inputProps={{ min: 0, step: '0.01' }}
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              size="small"
              label="GST %"
              type="number"
              inputProps={{ min: 0, step: '0.01' }}
              value={taxPercentage}
              onChange={(e) => setTaxPercentage(e.target.value)}
            />
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
          {saving ? 'Creating…' : 'Create note'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
