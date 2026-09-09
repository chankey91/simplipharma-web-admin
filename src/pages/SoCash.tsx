import React, { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Collapse,
  IconButton,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { ExpandLess, ExpandMore, Refresh } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { auth } from '../services/firebase';
import {
  backfillSoCashCollectionFields,
  getUnremittedSoCashRequests,
  groupUnremittedBySo,
  remittanceSoCash,
} from '../services/soCash';
import { useAppDialog } from '../context/AppDialogProvider';

const formatCurrency = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const SoCashPage: React.FC = () => {
  const { alert, confirm } = useAppDialog();
  const queryClient = useQueryClient();
  const [expandedSoId, setExpandedSoId] = useState<string | null>(null);
  const [notesBySo, setNotesBySo] = useState<Record<string, string>>({});

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['so-cash-unremitted'],
    queryFn: getUnremittedSoCashRequests,
  });

  const rows = useMemo(() => groupUnremittedBySo(data ?? []), [data]);
  const totalUnremitted = useMemo(
    () => rows.reduce((sum, r) => sum + r.unremittedAmount, 0),
    [rows]
  );

  const backfillMutation = useMutation({
    mutationFn: backfillSoCashCollectionFields,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['so-cash-unremitted'] });
      await alert(
        `Backfill done. Updated ${result.requestsUpdated} payment request(s) and ${result.paymentsUpdated} payment row(s).`,
        { severity: 'success' }
      );
    },
    onError: async (err: unknown) => {
      await alert((err as Error)?.message || 'Backfill failed', { severity: 'error' });
    },
  });

  const remitMutation = useMutation({
    mutationFn: remittanceSoCash,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['so-cash-unremitted'] });
      await alert(
        `Recorded remittance of ${formatCurrency(result.amount)} (${result.paymentRequestIds.length} request(s)).`,
        { severity: 'success' }
      );
    },
    onError: async (err: unknown) => {
      await alert((err as Error)?.message || 'Remittance failed', { severity: 'error' });
    },
  });

  const handleRemit = async (row: (typeof rows)[0]) => {
    const ok = await confirm(
      `Mark ${formatCurrency(row.unremittedAmount)} from ${row.salesOfficerName} as remitted to office?`,
      { title: 'Confirm remittance', confirmLabel: 'Mark remitted' }
    );
    if (!ok) return;
    await remitMutation.mutateAsync({
      salesOfficerId: row.salesOfficerId,
      salesOfficerName: row.salesOfficerName,
      remittedBy: auth.currentUser?.email || auth.currentUser?.uid || 'admin',
      notes: notesBySo[row.salesOfficerId]?.trim() || undefined,
    });
    setNotesBySo((prev) => ({ ...prev, [row.salesOfficerId]: '' }));
  };

  if (isLoading) return <Typography>Loading SO cash…</Typography>;
  if (error) {
    return (
      <Alert severity="error">
        {(error as Error)?.message || 'Failed to load SO cash.'}
      </Alert>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h4">SO cash</Typography>
        <Box display="flex" gap={1} flexWrap="wrap">
          <Button
            variant="outlined"
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending || remitMutation.isPending}
          >
            Backfill existing
          </Button>
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => refetch()}
            disabled={isFetching}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Cash collected by sales officers (via payment requests) that has been approved but not yet
        handed to the office. Use Backfill once to stamp older approved SO cash.
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1">
          Total unremitted:{' '}
          <Typography component="span" fontWeight={700}>
            {formatCurrency(totalUnremitted)}
          </Typography>
          {' · '}
          {rows.length} sales officer{rows.length === 1 ? '' : 's'}
        </Typography>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={48} />
              <TableCell>Sales officer</TableCell>
              <TableCell align="right">Unremitted</TableCell>
              <TableCell align="right">Requests</TableCell>
              <TableCell>Notes</TableCell>
              <TableCell align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    No unremitted SO cash.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const open = expandedSoId === row.salesOfficerId;
                return (
                  <React.Fragment key={row.salesOfficerId}>
                    <TableRow hover>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() =>
                            setExpandedSoId(open ? null : row.salesOfficerId)
                          }
                        >
                          {open ? <ExpandLess /> : <ExpandMore />}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Typography fontWeight={500}>{row.salesOfficerName}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.salesOfficerId}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{formatCurrency(row.unremittedAmount)}</TableCell>
                      <TableCell align="right">{row.requestCount}</TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          placeholder="Remittance note"
                          value={notesBySo[row.salesOfficerId] || ''}
                          onChange={(e) =>
                            setNotesBySo((prev) => ({
                              ...prev,
                              [row.salesOfficerId]: e.target.value,
                            }))
                          }
                          sx={{ minWidth: 160 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => handleRemit(row)}
                          disabled={remitMutation.isPending || backfillMutation.isPending}
                        >
                          Mark remitted
                        </Button>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={6} sx={{ py: 0, borderBottom: open ? undefined : 'none' }}>
                        <Collapse in={open} timeout="auto" unmountOnExit>
                          <Box sx={{ py: 1.5, px: 1 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Invoice</TableCell>
                                  <TableCell>Retailer</TableCell>
                                  <TableCell align="right">Amount</TableCell>
                                  <TableCell>Approved</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {row.requests.map((r) => (
                                  <TableRow key={r.id}>
                                    <TableCell>
                                      <Link
                                        component={RouterLink}
                                        to={`/orders/${r.orderId}`}
                                        underline="hover"
                                      >
                                        {r.invoiceNumber || r.orderId}
                                      </Link>
                                    </TableCell>
                                    <TableCell>{r.retailerName || r.retailerId}</TableCell>
                                    <TableCell align="right">
                                      {formatCurrency(
                                        Number(r.approvedAmount ?? r.requestedAmount ?? 0)
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {r.reviewedAt
                                        ? format(
                                            r.reviewedAt instanceof Date
                                              ? r.reviewedAt
                                              : new Date(r.reviewedAt as string),
                                            'dd MMM yyyy'
                                          )
                                        : r.createdAt
                                          ? format(
                                              r.createdAt instanceof Date
                                                ? r.createdAt
                                                : new Date(r.createdAt as string),
                                              'dd MMM yyyy'
                                            )
                                          : '—'}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};
