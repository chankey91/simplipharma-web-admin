import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Link as MuiLink,
  LinearProgress,
} from '@mui/material';
import { Visibility, OpenInNew, ShoppingBag } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useSearchParams } from 'react-router-dom';
import { Loading } from '../components/Loading';
import {
  getPurchaseLists,
  getPurchaseListItems,
  publishPurchaseListNet,
  type PurchaseList,
  type PurchaseListItem,
} from '../services/purchaseLists';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';
import { useQueryClient } from '@tanstack/react-query';
import { Refresh } from '@mui/icons-material';

function toDate(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const d = (value as { toDate: () => Date }).toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  return null;
}

function statusColor(status: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'confirmed':
      return 'success';
    case 'open':
      return 'info';
    case 'superseded':
      return 'default';
    case 'found':
      return 'success';
    case 'partial':
      return 'warning';
    case 'not_found':
      return 'error';
    default:
      return 'default';
  }
}

export const PurchaseListsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkId = searchParams.get('list');
  const queryClient = useQueryClient();
  const { alert } = useAppDialog();
  const { data: lists, isLoading, error } = useQuery({
    queryKey: ['purchaseLists'],
    queryFn: getPurchaseLists,
  });
  const { sortKey, sortDirection, requestSort } = useTableSort('publishedAt', 'desc');
  const [detailList, setDetailList] = useState<PurchaseList | null>(null);
  const [runningNow, setRunningNow] = useState(false);

  const handleRunNow = async () => {
    setRunningNow(true);
    try {
      const result = await publishPurchaseListNet();
      queryClient.invalidateQueries({ queryKey: ['purchaseLists'] });
      const eliminated = result.eliminatedCount ?? 0;
      const reduced = result.reducedCount ?? 0;
      if (result.itemCount === 0) {
        await alert(result.message || 'Nothing to publish — all need is covered or no pending orders.', {
          severity: 'info',
        });
      } else {
        await alert(
          result.message ||
            `Published ${result.itemCount} medicines.` +
              (eliminated || reduced
                ? ` Eliminated ${eliminated} covered; reduced ${reduced} partially covered.`
                : ''),
          { severity: 'success' }
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to run purchase job';
      await alert(message, { severity: 'error' });
    } finally {
      setRunningNow(false);
    }
  };

  useEffect(() => {
    if (!deepLinkId || !lists?.length) return;
    const match = lists.find((l) => l.id === deepLinkId);
    if (match) {
      setDetailList(match);
      setSearchParams({}, { replace: true });
    }
  }, [deepLinkId, lists, setSearchParams]);

  const sorted = useMemo(() => {
    const list = [...(lists || [])];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'fromDate':
          return applyDirection(compareAsc(a.fromDate, b.fromDate), sortDirection);
        case 'status':
          return applyDirection(compareAsc(a.status, b.status), sortDirection);
        case 'itemCount':
          return applyDirection(compareAsc(a.itemCount ?? 0, b.itemCount ?? 0), sortDirection);
        default: {
          const ta = toDate(a.confirmedAt)?.getTime() ?? toDate(a.publishedAt)?.getTime() ?? 0;
          const tb = toDate(b.confirmedAt)?.getTime() ?? toDate(b.publishedAt)?.getTime() ?? 0;
          return applyDirection(compareAsc(ta, tb), sortDirection);
        }
      }
    });
    return list;
  }, [lists, sortKey, sortDirection]);

  if (isLoading) return <Loading message="Loading purchase lists..." />;
  if (error) return <Typography color="error">Failed to load purchase lists</Typography>;

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={1} mb={1}>
        <ShoppingBag color="primary" />
        <Typography variant="h4">Purchase lists</Typography>
      </Box>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
          Auto-published daily at 12:00 and 15:00 IST. Same-day runs merge into the open list
          (increase need, keep found qty, reopen submitted manufacturer groups when more stock is
          needed).
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<Refresh />}
          disabled={runningNow}
          onClick={() => void handleRunNow()}
          sx={{ flexShrink: 0, ml: 2 }}
        >
          {runningNow ? 'Running…' : 'Run purchase job now'}
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <SortableTableHeadCell
                columnId="fromDate"
                label="Date range"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="status"
                label="Status"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="itemCount"
                label="Items"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="publishedAt"
                label="Published / Confirmed"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    No purchase lists yet. Publish one from Orders → Product Summary.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((row) => {
                const published = toDate(row.publishedAt);
                const confirmed = toDate(row.confirmedAt);
                return (
                  <TableRow key={row.id} hover>
                    <TableCell>
                      {row.fromDate} → {row.toDate}
                      {row.source ? (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {row.source}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={row.status} color={statusColor(row.status)} />
                    </TableCell>
                    <TableCell>{row.itemCount ?? '—'}</TableCell>
                    <TableCell>
                      {published ? format(published, 'dd MMM yyyy HH:mm') : '—'}
                      {confirmed ? (
                        <Typography variant="caption" display="block" color="text.secondary">
                          Confirmed {format(confirmed, 'dd MMM yyyy HH:mm')}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        color="primary"
                        aria-label="View"
                        onClick={() => setDetailList(row)}
                      >
                        <Visibility />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <PurchaseListDetailDialog
        list={detailList}
        onClose={() => setDetailList(null)}
      />
    </Box>
  );
};

const PurchaseListDetailDialog: React.FC<{
  list: PurchaseList | null;
  onClose: () => void;
}> = ({ list, onClose }) => {
  const open = Boolean(list);
  const { data: items, isLoading } = useQuery({
    queryKey: ['purchaseListItems', list?.id],
    queryFn: () => getPurchaseListItems(list!.id),
    enabled: open && Boolean(list?.id),
  });

  const summary = useMemo(() => {
    const rows = items || [];
    let need = 0;
    let found = 0;
    const byStatus = { pending: 0, found: 0, partial: 0, not_found: 0 };
    for (const item of rows) {
      need += item.totalQty || 0;
      found += item.foundQty ?? 0;
      const s = item.status || 'pending';
      if (s in byStatus) byStatus[s as keyof typeof byStatus] += 1;
    }
    return { need, found, byStatus, count: rows.length };
  }, [items]);

  const grouped = useMemo(() => {
    const map = new Map<string, PurchaseListItem[]>();
    for (const item of [...(items || [])].sort((a, b) => {
      const m = (a.manufacturer || '').localeCompare(b.manufacturer || '');
      if (m !== 0) return m;
      return (a.medicineName || '').localeCompare(b.medicineName || '');
    })) {
      const key = item.manufacturer || 'N/A';
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Purchase list {list ? `${list.fromDate} → ${list.toDate}` : ''}
      </DialogTitle>
      <DialogContent dividers>
        {list ? (
          <Box sx={{ mb: 2 }}>
            <Chip size="small" label={list.status} color={statusColor(list.status)} sx={{ mr: 1 }} />
            <Typography variant="body2" color="text.secondary" component="span">
              {summary.count} lines · {summary.found}/{summary.need} strips found · Found{' '}
              {summary.byStatus.found} · Partial {summary.byStatus.partial} · Not found{' '}
              {summary.byStatus.not_found}
            </Typography>
            {list.invoiceFileUrl ? (
              <Box mt={1}>
                <MuiLink href={list.invoiceFileUrl} target="_blank" rel="noopener noreferrer">
                  View attached invoice
                  {list.invoiceFileName ? ` (${list.invoiceFileName})` : ''}{' '}
                  <OpenInNew sx={{ fontSize: 14, verticalAlign: 'middle' }} />
                </MuiLink>
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                No invoice attached
              </Typography>
            )}
          </Box>
        ) : null}

        {isLoading ? <LinearProgress /> : null}

        {grouped.map(([manufacturer, rows]) => (
          <Box key={manufacturer} sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="primary" sx={{ mb: 0.5 }}>
              {manufacturer}
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Medicine</TableCell>
                    <TableCell align="right">Need</TableCell>
                    <TableCell align="right">Found</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.medicineName}</TableCell>
                      <TableCell align="right">{item.totalQty}</TableCell>
                      <TableCell align="right">{item.foundQty ?? '—'}</TableCell>
                      <TableCell>
                        <Chip size="small" label={item.status} color={statusColor(item.status)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
