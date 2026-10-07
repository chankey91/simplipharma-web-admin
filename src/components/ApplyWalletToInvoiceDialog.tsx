import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { format } from 'date-fns';
import { useApplyWalletToUnpaidOrder, useUnpaidInvoicesByRetailer } from '../hooks/useOrders';
import { useRetailerWallet } from '../hooks/useRetailerWallet';
import { Loading } from './Loading';
import { useAppDialog } from '../context/AppDialogProvider';

type Props = {
  open: boolean;
  retailerId: string;
  onClose: () => void;
  onApplied?: () => void;
  /** When set, skip invoice picker and apply to this order. */
  lockOrderId?: string;
};

const formatAmount = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const ApplyWalletToInvoiceDialog: React.FC<Props> = ({
  open,
  retailerId,
  onClose,
  onApplied,
  lockOrderId,
}) => {
  const { alert } = useAppDialog();
  const { data: wallet, isLoading: walletLoading } = useRetailerWallet(retailerId, open);
  const { data: invoices, isLoading: invoicesLoading, error } = useUnpaidInvoicesByRetailer(
    retailerId,
    open
  );
  const applyMutation = useApplyWalletToUnpaidOrder();
  const [orderId, setOrderId] = useState(lockOrderId || '');
  const [amount, setAmount] = useState('');

  const available = wallet?.available ?? 0;
  const rows = invoices ?? [];
  const selected = useMemo(
    () => rows.find((r) => r.id === orderId) || null,
    [rows, orderId]
  );
  const maxApply = Math.min(available, selected?.outstanding ?? 0);

  useEffect(() => {
    if (!open) return;
    const nextId = lockOrderId || rows[0]?.id || '';
    setOrderId(nextId);
    const row = rows.find((r) => r.id === nextId);
    const cap = Math.min(available, row?.outstanding ?? 0);
    setAmount(cap > 0.01 ? String(Math.round(cap * 100) / 100) : '');
  }, [open, lockOrderId, rows, available]);

  const handleApply = async () => {
    const value = parseFloat(amount);
    if (!orderId) {
      await alert('Select an unpaid invoice.', { severity: 'warning' });
      return;
    }
    if (!Number.isFinite(value) || value <= 0.01) {
      await alert('Enter an amount greater than zero.', { severity: 'warning' });
      return;
    }
    if (value > maxApply + 0.01) {
      await alert(
        `Cannot apply more than ${formatAmount(maxApply)} (wallet or invoice due).`,
        { severity: 'warning' }
      );
      return;
    }
    try {
      const result = await applyMutation.mutateAsync({ orderId, amount: value });
      onApplied?.();
      onClose();
      await alert(
        `${formatAmount(result.applied)} applied. Invoice is now ${result.paymentStatus}` +
          (result.remainingDue > 0.01 ? ` (due ${formatAmount(result.remainingDue)})` : ''),
        { severity: 'success' }
      );
    } catch (e: unknown) {
      await alert(e instanceof Error ? e.message : 'Failed to apply wallet', { severity: 'error' });
    }
  };

  const loading = walletLoading || invoicesLoading;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Apply wallet to invoice</DialogTitle>
      <DialogContent>
        {loading ? (
          <Loading message="Loading unpaid invoices…" />
        ) : error ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            Failed to load unpaid invoices
          </Alert>
        ) : (
          <>
            <Alert severity="info" sx={{ mt: 1, mb: 2 }}>
              Available wallet {formatAmount(available)}. This settles an unpaid bill and reduces
              wallet immediately.
            </Alert>
            {available <= 0.01 ? (
              <Alert severity="warning">This store has no wallet balance.</Alert>
            ) : rows.length === 0 ? (
              <Alert severity="success">No unpaid invoices for this store.</Alert>
            ) : (
              <>
                {lockOrderId ? (
                  <TextField
                    fullWidth
                    size="small"
                    label="Invoice"
                    value={
                      selected
                        ? `${selected.label} · due ${formatAmount(selected.outstanding)}`
                        : lockOrderId
                    }
                    InputProps={{ readOnly: true }}
                    sx={{ mb: 2 }}
                  />
                ) : (
                  <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                    <InputLabel>Unpaid invoice</InputLabel>
                    <Select
                      label="Unpaid invoice"
                      value={orderId}
                      onChange={(e) => {
                        const id = String(e.target.value);
                        setOrderId(id);
                        const row = rows.find((r) => r.id === id);
                        const cap = Math.min(available, row?.outstanding ?? 0);
                        setAmount(cap > 0.01 ? String(Math.round(cap * 100) / 100) : '');
                      }}
                    >
                      {rows.map((row) => (
                        <MenuItem key={row.id} value={row.id}>
                          {row.label} · {format(row.orderDate, 'dd MMM yyyy')} · due{' '}
                          {formatAmount(row.outstanding)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
                {selected ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Invoice {formatAmount(selected.totalAmount)} · {selected.paymentStatus} · due{' '}
                    {formatAmount(selected.outstanding)}
                  </Typography>
                ) : null}
                <TextField
                  fullWidth
                  size="small"
                  label="Amount to apply"
                  type="number"
                  inputProps={{ min: 0, step: '0.01', max: maxApply }}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  helperText={`Max ${formatAmount(maxApply)}`}
                />
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={applyMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleApply()}
          disabled={
            applyMutation.isPending ||
            loading ||
            available <= 0.01 ||
            rows.length === 0 ||
            !orderId ||
            maxApply <= 0.01
          }
        >
          {applyMutation.isPending ? 'Applying…' : 'Apply wallet'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
