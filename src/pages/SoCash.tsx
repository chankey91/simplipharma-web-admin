import React, { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
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
import { ExpandLess, ExpandMore, FileDownload, Refresh } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { auth } from '../services/firebase';
import {
  backfillSoCashCollectionFields,
  getUnremittedSoCashRequests,
  groupUnremittedBySo,
  remittanceSoCash,
  type SoCashBagRow,
} from '../services/soCash';
import type { PaymentRequest } from '../types';
import { useAppDialog } from '../context/AppDialogProvider';
import { istDateStampCompact } from '../utils/dateTime';

const formatCurrency = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const requestAmount = (r: PaymentRequest) =>
  Number(r.approvedAmount ?? r.requestedAmount ?? 0);

const requestApprovedDate = (r: PaymentRequest): Date | null => {
  const raw = r.reviewedAt || r.createdAt;
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw as string);
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatRequestDate = (r: PaymentRequest) => {
  const d = requestApprovedDate(r);
  return d ? format(d, 'dd MMM yyyy') : '—';
};

const safeFilePart = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'so';

export const SoCashPage: React.FC = () => {
  const { alert, confirm } = useAppDialog();
  const queryClient = useQueryClient();
  const [expandedSoId, setExpandedSoId] = useState<string | null>(null);
  const [notesBySo, setNotesBySo] = useState<Record<string, string>>({});
  const [selectedBySo, setSelectedBySo] = useState<Record<string, string[]>>({});

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['so-cash-unremitted'],
    queryFn: getUnremittedSoCashRequests,
  });

  const rows = useMemo(() => groupUnremittedBySo(data ?? []), [data]);
  const totalUnremitted = useMemo(
    () => rows.reduce((sum, r) => sum + r.unremittedAmount, 0),
    [rows]
  );

  const selectedIdsFor = (row: SoCashBagRow) => {
    const valid = new Set(row.requests.map((r) => r.id));
    return (selectedBySo[row.salesOfficerId] || []).filter((id) => valid.has(id));
  };

  const toggleRequest = (soId: string, requestId: string) => {
    setSelectedBySo((prev) => {
      const current = new Set(prev[soId] || []);
      if (current.has(requestId)) current.delete(requestId);
      else current.add(requestId);
      return { ...prev, [soId]: [...current] };
    });
  };

  const toggleAllForSo = (row: SoCashBagRow) => {
    const allIds = row.requests.map((r) => r.id);
    const selected = selectedIdsFor(row);
    const allOn = allIds.length > 0 && selected.length === allIds.length;
    setSelectedBySo((prev) => ({ ...prev, [row.salesOfficerId]: allOn ? [] : allIds }));
  };

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

  const handleRemit = async (row: SoCashBagRow) => {
    const selectedIds = selectedIdsFor(row);
    const toRemit =
      selectedIds.length > 0
        ? row.requests.filter((r) => selectedIds.includes(r.id))
        : row.requests;
    const isPartial = selectedIds.length > 0 && selectedIds.length < row.requests.length;
    const amount = toRemit.reduce((sum, r) => sum + requestAmount(r), 0);
    const ok = await confirm(
      isPartial
        ? `Mark ${toRemit.length} selected invoice(s) totaling ${formatCurrency(amount)} from ${row.salesOfficerName} as remitted to office? Remaining invoices stay unremitted.`
        : `Mark ${formatCurrency(amount)} from ${row.salesOfficerName} as remitted to office?`,
      { title: 'Confirm remittance', confirmLabel: 'Mark remitted' }
    );
    if (!ok) return;
    await remitMutation.mutateAsync({
      salesOfficerId: row.salesOfficerId,
      salesOfficerName: row.salesOfficerName,
      remittedBy: auth.currentUser?.email || auth.currentUser?.uid || 'admin',
      notes: notesBySo[row.salesOfficerId]?.trim() || undefined,
      requestIds: selectedIds.length > 0 ? toRemit.map((r) => r.id) : undefined,
    });
    setNotesBySo((prev) => ({ ...prev, [row.salesOfficerId]: '' }));
    setSelectedBySo((prev) => ({ ...prev, [row.salesOfficerId]: [] }));
  };

  const handleExport = async (row?: SoCashBagRow) => {
    const source = row ? [row] : rows;
    const exportRows = source.flatMap((so) =>
      so.requests.map((r) => ({ so, r }))
    );
    if (exportRows.length === 0) {
      await alert('No pending invoices to export', { severity: 'warning' });
      return;
    }

    const excelData: (string | number)[][] = [
      [
        'Sales officer',
        'Sales officer ID',
        'Invoice',
        'Order ID',
        'Retailer',
        'Amount',
        'Approved',
        'Payment request ID',
      ],
      ...exportRows.map(({ so, r }) => [
        so.salesOfficerName,
        so.salesOfficerId,
        r.invoiceNumber || r.orderId,
        r.orderId,
        r.retailerName || r.retailerId,
        requestAmount(r),
        formatRequestDate(r),
        r.id,
      ]),
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(excelData);
    ws['!cols'] = [
      { wch: 24 },
      { wch: 28 },
      { wch: 18 },
      { wch: 22 },
      { wch: 28 },
      { wch: 12 },
      { wch: 14 },
      { wch: 28 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Pending invoices');

    const stamp = istDateStampCompact();
    const filename = row
      ? `so-cash-pending-${safeFilePart(row.salesOfficerName || row.salesOfficerId)}-${stamp}.xlsx`
      : `so-cash-pending-${stamp}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  const busy = remitMutation.isPending || backfillMutation.isPending;

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
            disabled={busy}
          >
            Backfill existing
          </Button>
          <Button
            variant="outlined"
            startIcon={<FileDownload />}
            onClick={() => void handleExport()}
            disabled={rows.length === 0}
          >
            Export pending
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
        handed to the office. Expand an officer, tick invoices to remit only those amounts, or leave
        none ticked to remit all. Use Backfill once to stamp older approved SO cash.
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
                const selectedIds = selectedIdsFor(row);
                const selectedAmount = row.requests
                  .filter((r) => selectedIds.includes(r.id))
                  .reduce((sum, r) => sum + requestAmount(r), 0);
                const allSelected =
                  row.requests.length > 0 && selectedIds.length === row.requests.length;
                const someSelected = selectedIds.length > 0 && !allSelected;
                const remitLabel =
                  selectedIds.length > 0 && selectedIds.length < row.requests.length
                    ? `Mark remitted (${selectedIds.length})`
                    : 'Mark remitted';
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
                      <TableCell align="right">
                        {formatCurrency(row.unremittedAmount)}
                        {someSelected && (
                          <Typography variant="caption" color="primary" display="block">
                            {formatCurrency(selectedAmount)} selected
                          </Typography>
                        )}
                      </TableCell>
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
                        <Box display="flex" gap={1} justifyContent="flex-end" flexWrap="wrap">
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<FileDownload />}
                            onClick={() => void handleExport(row)}
                            disabled={row.requests.length === 0}
                          >
                            Export
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => handleRemit(row)}
                            disabled={busy}
                          >
                            {remitLabel}
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={6} sx={{ py: 0, borderBottom: open ? undefined : 'none' }}>
                        <Collapse in={open} timeout="auto" unmountOnExit>
                          <Box sx={{ py: 1.5, px: 1 }}>
                            <Box
                              display="flex"
                              justifyContent="space-between"
                              alignItems="center"
                              flexWrap="wrap"
                              gap={1}
                              sx={{ mb: 1 }}
                            >
                              <Typography variant="body2" color="text.secondary">
                                {selectedIds.length > 0
                                  ? `${selectedIds.length} invoice(s) selected · ${formatCurrency(selectedAmount)}`
                                  : 'Tick invoices to remit individually. Leave none ticked to remit all.'}
                              </Typography>
                            </Box>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell padding="checkbox">
                                    <Checkbox
                                      size="small"
                                      checked={allSelected}
                                      indeterminate={someSelected}
                                      disabled={row.requests.length === 0 || busy}
                                      onChange={() => toggleAllForSo(row)}
                                      inputProps={{
                                        'aria-label': `Select all pending invoices for ${row.salesOfficerName}`,
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell>Invoice</TableCell>
                                  <TableCell>Retailer</TableCell>
                                  <TableCell align="right">Amount</TableCell>
                                  <TableCell>Approved</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {row.requests.map((r) => {
                                  const checked = selectedIds.includes(r.id);
                                  return (
                                    <TableRow key={r.id} hover selected={checked}>
                                      <TableCell padding="checkbox">
                                        <Checkbox
                                          size="small"
                                          checked={checked}
                                          disabled={busy}
                                          onChange={() => toggleRequest(row.salesOfficerId, r.id)}
                                          inputProps={{
                                            'aria-label': `Select invoice ${r.invoiceNumber || r.orderId}`,
                                          }}
                                        />
                                      </TableCell>
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
                                        {formatCurrency(requestAmount(r))}
                                      </TableCell>
                                      <TableCell>{formatRequestDate(r)}</TableCell>
                                    </TableRow>
                                  );
                                })}
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
