import React, { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  IconButton,
  Link,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { ExpandLess, ExpandMore, FileDownload, Refresh } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endOfDay, format, startOfDay, startOfMonth } from 'date-fns';
import * as XLSX from 'xlsx';
import { auth } from '../services/firebase';
import {
  backfillSoCashCollectionFields,
  getSoCashRequests,
  groupUnremittedBySo,
  isSoCashRemitted,
  remittanceSoCash,
  soCashRecordDate,
  type SoCashBagRow,
  type SoCashStatusFilter,
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

const formatRemittedDate = (r: PaymentRequest) => {
  const d = soCashRecordDate(r);
  return d && isSoCashRemitted(r) ? format(d, 'dd MMM yyyy') : '—';
};

const safeFilePart = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'so';

const toInputDate = (d: Date) => format(d, 'yyyy-MM-dd');

function parseRange(fromDate: string, toDate: string): { fromMs?: number; toMs?: number } | null {
  if (!fromDate && !toDate) return {};
  if (!fromDate || !toDate) return null;
  const fromMs = startOfDay(new Date(`${fromDate}T00:00:00`)).getTime();
  const toMs = endOfDay(new Date(`${toDate}T00:00:00`)).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) return null;
  return { fromMs, toMs };
}

function exportSoCashRows(
  rows: SoCashBagRow[],
  filename: string,
  sheetName: string
) {
  const exportRows = rows.flatMap((so) => so.requests.map((r) => ({ so, r })));
  const excelData: (string | number)[][] = [
    [
      'Sales officer',
      'Sales officer ID',
      'Status',
      'Invoice',
      'Order ID',
      'Retailer',
      'Amount',
      'Approved',
      'Remitted',
      'Payment request ID',
    ],
    ...exportRows.map(({ so, r }) => [
      so.salesOfficerName,
      so.salesOfficerId,
      isSoCashRemitted(r) ? 'Remitted' : 'Unremitted',
      r.invoiceNumber || r.orderId,
      r.orderId,
      r.retailerName || r.retailerId,
      requestAmount(r),
      formatRequestDate(r),
      formatRemittedDate(r),
      r.id,
    ]),
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [
    { wch: 24 },
    { wch: 28 },
    { wch: 12 },
    { wch: 18 },
    { wch: 22 },
    { wch: 28 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export const SoCashPage: React.FC = () => {
  const { alert, confirm } = useAppDialog();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SoCashStatusFilter>('unremitted');
  const [fromDate, setFromDate] = useState(toInputDate(startOfMonth(new Date())));
  const [toDate, setToDate] = useState(toInputDate(new Date()));
  const [expandedSoId, setExpandedSoId] = useState<string | null>(null);
  const [notesBySo, setNotesBySo] = useState<Record<string, string>>({});
  const [selectedBySo, setSelectedBySo] = useState<Record<string, string[]>>({});

  const range = useMemo(() => parseRange(fromDate, toDate), [fromDate, toDate]);
  const rangeInvalid = Boolean(fromDate || toDate) && range == null;

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['so-cash', tab, range?.fromMs ?? null, range?.toMs ?? null],
    queryFn: () =>
      getSoCashRequests({
        status: tab,
        fromMs: range?.fromMs,
        toMs: range?.toMs,
      }),
    enabled: !rangeInvalid,
  });

  const rows = useMemo(() => groupUnremittedBySo(data ?? []), [data]);
  const totalAmount = useMemo(
    () =>
      rows.reduce(
        (sum, r) => sum + (tab === 'remitted' ? r.remittedAmount : r.unremittedAmount),
        0
      ),
    [rows, tab]
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
      await queryClient.invalidateQueries({ queryKey: ['so-cash'] });
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
      await queryClient.invalidateQueries({ queryKey: ['so-cash'] });
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

  const handleExport = async (row?: SoCashBagRow, both = false) => {
    if (rangeInvalid) {
      await alert('Select a valid From and To date.', { severity: 'warning' });
      return;
    }
    if (both) {
      const all = await getSoCashRequests({
        status: 'all',
        fromMs: range?.fromMs,
        toMs: range?.toMs,
      });
      const grouped = groupUnremittedBySo(all);
      if (grouped.length === 0) {
        await alert('No remitted or unremitted records in this date range', {
          severity: 'warning',
        });
        return;
      }
      exportSoCashRows(
        grouped,
        `so-cash-all-${fromDate || 'start'}-${toDate || 'end'}-${istDateStampCompact()}.xlsx`,
        'SO cash'
      );
      return;
    }
    const source = row ? [row] : rows;
    if (source.every((so) => so.requests.length === 0)) {
      await alert('No records to export', { severity: 'warning' });
      return;
    }
    const stamp = istDateStampCompact();
    const filename = row
      ? `so-cash-${tab}-${safeFilePart(row.salesOfficerName || row.salesOfficerId)}-${stamp}.xlsx`
      : `so-cash-${tab}-${fromDate || 'all'}-${toDate || 'all'}-${stamp}.xlsx`;
    exportSoCashRows(source, filename, tab === 'remitted' ? 'Remitted' : 'Unremitted');
  };

  const busy = remitMutation.isPending || backfillMutation.isPending;
  const isRemittedTab = tab === 'remitted';

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
            disabled={rows.length === 0 || rangeInvalid}
          >
            Export this tab
          </Button>
          <Button
            variant="contained"
            startIcon={<FileDownload />}
            onClick={() => void handleExport(undefined, true)}
            disabled={rangeInvalid}
          >
            Export remitted + unremitted
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
        Cash collected by sales officers. Unremitted is cash still with the SO. Remitted is cash
        already handed to the office. Date range filters approved date (unremitted) or remitted
        date. Export remitted + unremitted uses the same dates.
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
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
          >
            All dates
          </Button>
        </Box>
        {rangeInvalid ? (
          <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
            From must be on or before To.
          </Typography>
        ) : null}
        <Typography variant="subtitle1" sx={{ mt: 2 }}>
          {isRemittedTab ? 'Total remitted' : 'Total unremitted'}:{' '}
          <Typography component="span" fontWeight={700}>
            {formatCurrency(totalAmount)}
          </Typography>
          {' · '}
          {rows.length} sales officer{rows.length === 1 ? '' : 's'}
        </Typography>
      </Paper>

      <Tabs
        value={tab}
        onChange={(_, v: SoCashStatusFilter) => {
          setTab(v);
          setExpandedSoId(null);
        }}
        sx={{ mb: 2 }}
      >
        <Tab value="unremitted" label="Unremitted" />
        <Tab value="remitted" label="Remitted" />
      </Tabs>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={48} />
              <TableCell>Sales officer</TableCell>
              <TableCell align="right">{isRemittedTab ? 'Remitted' : 'Unremitted'}</TableCell>
              <TableCell align="right">Requests</TableCell>
              {!isRemittedTab ? <TableCell>Notes</TableCell> : null}
              <TableCell align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isRemittedTab ? 5 : 6} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    {isRemittedTab
                      ? 'No remitted SO cash in this date range.'
                      : 'No unremitted SO cash in this date range.'}
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
                        {formatCurrency(isRemittedTab ? row.remittedAmount : row.unremittedAmount)}
                        {!isRemittedTab && someSelected && (
                          <Typography variant="caption" color="primary" display="block">
                            {formatCurrency(selectedAmount)} selected
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">{row.requestCount}</TableCell>
                      {!isRemittedTab ? (
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
                      ) : null}
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
                          {!isRemittedTab ? (
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => handleRemit(row)}
                              disabled={busy}
                            >
                              {remitLabel}
                            </Button>
                          ) : null}
                        </Box>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell
                        colSpan={isRemittedTab ? 5 : 6}
                        sx={{ py: 0, borderBottom: open ? undefined : 'none' }}
                      >
                        <Collapse in={open} timeout="auto" unmountOnExit>
                          <Box sx={{ py: 1.5, px: 1 }}>
                            {!isRemittedTab ? (
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                {selectedIds.length > 0
                                  ? `${selectedIds.length} invoice(s) selected · ${formatCurrency(selectedAmount)}`
                                  : 'Tick invoices to remit individually. Leave none ticked to remit all.'}
                              </Typography>
                            ) : null}
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  {!isRemittedTab ? (
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
                                  ) : null}
                                  <TableCell>Invoice</TableCell>
                                  <TableCell>Retailer</TableCell>
                                  <TableCell align="right">Amount</TableCell>
                                  <TableCell>Approved</TableCell>
                                  {isRemittedTab ? <TableCell>Remitted</TableCell> : null}
                                  {isRemittedTab ? <TableCell>Status</TableCell> : null}
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {row.requests.map((r) => {
                                  const checked = selectedIds.includes(r.id);
                                  return (
                                    <TableRow key={r.id} hover selected={checked}>
                                      {!isRemittedTab ? (
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
                                      ) : null}
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
                                      {isRemittedTab ? (
                                        <TableCell>{formatRemittedDate(r)}</TableCell>
                                      ) : null}
                                      {isRemittedTab ? (
                                        <TableCell>
                                          <Chip size="small" label="Remitted" color="success" />
                                        </TableCell>
                                      ) : null}
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
