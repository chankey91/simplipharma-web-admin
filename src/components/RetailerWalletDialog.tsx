import React, { useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Alert,
} from '@mui/material';
import { format } from 'date-fns';
import { useRetailerWallet, useInvalidateRetailerWallet } from '../hooks/useRetailerWallet';
import { Loading } from './Loading';
import { CreateLedgerNoteDialog } from './CreateLedgerNoteDialog';
import type { User } from '../types';
import type { WalletTxn } from '../utils/retailerWallet';

type Props = {
  open: boolean;
  store: User | null;
  onClose: () => void;
};

const formatAmount = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const RetailerWalletDialog: React.FC<Props> = ({ open, store, onClose }) => {
  const retailerId = store?.id || '';
  const { data, isLoading, error, refetch, isFetching } = useRetailerWallet(retailerId, open);
  const invalidateWallet = useInvalidateRetailerWallet();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [ledgerKind, setLedgerKind] = useState<'credit' | 'debit' | null>(null);

  const storeName = store?.shopName || store?.displayName || store?.email || 'Store';

  const filteredTxns = useMemo(() => {
    const rows = data?.transactions ?? [];
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    return rows.filter((tx) => {
      const ts = tx.at?.getTime?.() ?? NaN;
      if (Number.isNaN(ts)) return false;
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;
      return true;
    });
  }, [data?.transactions, fromDate, toDate]);

  const handleNoteCreated = () => {
    invalidateWallet(retailerId);
    void refetch();
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>
          Wallet — {storeName}
          {store?.storeCode ? (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              ({store.storeCode})
            </Typography>
          ) : null}
        </DialogTitle>
        <DialogContent>
          {isLoading ? (
            <Loading message="Loading wallet…" />
          ) : error ? (
            <Alert severity="error">Failed to load wallet</Alert>
          ) : (
            <>
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                flexWrap="wrap"
                gap={1}
                mb={2}
                mt={1}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Available balance
                  </Typography>
                  <Typography variant="h5" fontWeight={700}>
                    {formatAmount(data?.available ?? 0)}
                  </Typography>
                </Box>
                <Box display="flex" gap={1} flexWrap="wrap">
                  <Button variant="outlined" color="success" onClick={() => setLedgerKind('credit')}>
                    Credit
                  </Button>
                  <Button variant="contained" color="warning" onClick={() => setLedgerKind('debit')}>
                    Debit
                  </Button>
                </Box>
              </Box>

              <Alert severity="info" sx={{ mb: 2 }}>
                Debit posts a ledger debit note with reason and reduces wallet balance immediately.
                Credits and invoice wallet usage also appear below.
              </Alert>

              <Box display="flex" gap={2} flexWrap="wrap" mb={2}>
                <TextField
                  size="small"
                  label="From"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  size="small"
                  label="To"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <Button
                  size="small"
                  onClick={() => {
                    setFromDate('');
                    setToDate('');
                  }}
                  disabled={!fromDate && !toDate}
                >
                  Clear dates
                </Button>
              </Box>

              {isFetching && !isLoading ? (
                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                  Refreshing…
                </Typography>
              ) : null}

              {filteredTxns.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 2 }}>
                  {(data?.transactions.length ?? 0) === 0
                    ? 'No wallet activity yet.'
                    : 'No entries in the selected date range.'}
                </Typography>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Reference</TableCell>
                        <TableCell>Reason</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell align="right">Balance</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredTxns.map((tx: WalletTxn) => (
                        <TableRow key={tx.id} hover>
                          <TableCell>
                            {tx.at ? format(tx.at, 'dd MMM yyyy, HH:mm') : '—'}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={tx.label}
                              color={tx.kind === 'credit' ? 'success' : 'error'}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>{tx.ref}</TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 220 }}>
                              {tx.reason || '—'}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography
                              variant="body2"
                              fontWeight={700}
                              color={tx.kind === 'credit' ? 'success.main' : 'error.main'}
                            >
                              {tx.kind === 'credit' ? '+' : '−'}
                              {formatAmount(tx.amount)}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">{formatAmount(tx.balanceAfter || 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => void refetch()} disabled={isLoading || isFetching}>
            Refresh
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>

      <CreateLedgerNoteDialog
        open={ledgerKind != null}
        kind={ledgerKind ?? 'debit'}
        initialRetailerId={retailerId}
        lockRetailer
        onClose={() => setLedgerKind(null)}
        onCreated={handleNoteCreated}
      />
    </>
  );
};
