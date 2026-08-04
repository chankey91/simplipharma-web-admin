import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Pagination,
  Grid,
  Chip,
} from '@mui/material';
import { Search, Download, Place } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { getVisitLogs, type SoVisitLog } from '../services/visitLogs';
import { useSalesOfficers } from '../hooks/useSalesOfficers';
import { useStores } from '../hooks/useStores';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { useTableSort } from '../hooks/useTableSort';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import {
  getTodayDateStringIST,
  istDayEndExclusiveMs,
  istDayStartMs,
  istDateStampCompact,
} from '../utils/dateTime';
import { useAppDialog } from '../context/AppDialogProvider';
import {
  formatDistanceMeters,
  haversineDistanceMeters,
  visitDistanceStatus,
} from '../utils/geoDistance';
import type { User } from '../types';

function getDefaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return getTodayDateStringIST(d);
}

export const SoVisitsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { alert } = useAppDialog();
  const { data: salesOfficers = [] } = useSalesOfficers();
  const { data: stores = [] } = useStores();

  const [fromDate, setFromDate] = useState(() => getDefaultFromDate());
  const [toDate, setToDate] = useState(() => getTodayDateStringIST());
  const [soFilter, setSoFilter] = useState(() => searchParams.get('so') || '');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const rowsPerPage = 25;

  const { sortKey, sortDirection, requestSort } = useTableSort('visitedAt', 'desc');

  const soNameById = useMemo(() => {
    const m: Record<string, string> = {};
    salesOfficers.forEach((so) => {
      m[so.id] = so.displayName || so.email || so.id;
    });
    return m;
  }, [salesOfficers]);

  const storeById = useMemo(() => {
    const m = new Map<string, User>();
    stores.forEach((s) => m.set(s.id, s));
    return m;
  }, [stores]);

  const storeNameById = useMemo(() => {
    const m: Record<string, string> = {};
    stores.forEach((s) => {
      m[s.id] = s.shopName || s.displayName || s.email || s.id;
    });
    return m;
  }, [stores]);

  const distanceForVisit = (v: SoVisitLog): number | null => {
    if (v.latitude == null || v.longitude == null) return null;
    const store = storeById.get(v.retailerId);
    const slat = store?.location?.latitude;
    const slng = store?.location?.longitude;
    if (slat == null || slng == null) return null;
    return haversineDistanceMeters(
      { latitude: v.latitude, longitude: v.longitude },
      { latitude: slat, longitude: slng }
    );
  };

  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  const queryKeyBounds = useMemo(() => {
    if (dateRangeInvalid) return null;
    return {
      fromMs: fromDate ? istDayStartMs(fromDate) : undefined,
      toMsExclusive: toDate ? istDayEndExclusiveMs(toDate) : undefined,
      salesOfficerId: soFilter || undefined,
    };
  }, [fromDate, toDate, soFilter, dateRangeInvalid]);

  const { data: visits = [], isLoading } = useQuery({
    queryKey: ['soVisitLogs', queryKeyBounds],
    queryFn: () =>
      getVisitLogs({
        salesOfficerId: queryKeyBounds?.salesOfficerId,
        fromMs: queryKeyBounds?.fromMs,
        toMsExclusive: queryKeyBounds?.toMsExclusive,
        limitCount: 1000,
      }),
    enabled: queryKeyBounds != null,
  });

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    let list = visits;
    if (q) {
      list = list.filter((v) => {
        const so = (soNameById[v.salesOfficerId] || v.salesOfficerId || '').toLowerCase();
        const store =
          (storeNameById[v.retailerId] || v.retailerName || v.retailerId || '').toLowerCase();
        const note = (v.note || '').toLowerCase();
        return so.includes(q) || store.includes(q) || note.includes(q);
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'visitedAt':
          return applyDirection(compareAsc(toTimeMs(a.visitedAt), toTimeMs(b.visitedAt)), sortDirection);
        case 'salesOfficer':
          return applyDirection(
            compareAsc(
              soNameById[a.salesOfficerId] || a.salesOfficerId,
              soNameById[b.salesOfficerId] || b.salesOfficerId
            ),
            sortDirection
          );
        case 'store':
          return applyDirection(
            compareAsc(
              storeNameById[a.retailerId] || a.retailerName || a.retailerId,
              storeNameById[b.retailerId] || b.retailerName || b.retailerId
            ),
            sortDirection
          );
        default:
          return applyDirection(compareAsc(toTimeMs(a.visitedAt), toTimeMs(b.visitedAt)), 'desc');
      }
    });
    return sorted;
  }, [visits, searchTerm, sortKey, sortDirection, soNameById, storeNameById]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * rowsPerPage, pageSafe * rowsPerPage);

  const handleSoFilterChange = (value: string) => {
    setSoFilter(value);
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (value) next.set('so', value);
    else next.delete('so');
    setSearchParams(next, { replace: true });
  };

  const handleExport = async () => {
    if (filtered.length === 0) {
      await alert('No visits to export', { severity: 'warning' });
      return;
    }
    const rows: (string | number)[][] = [
      [
        'Visited At',
        'Sales Officer',
        'Store',
        'Retailer ID',
        'Note',
        'Visit Lat',
        'Visit Lng',
        'Distance to store',
        'Status',
      ],
      ...filtered.map((v) => {
        const dist = distanceForVisit(v);
        const status = visitDistanceStatus(dist);
        return [
          format(v.visitedAt, 'dd MMM yyyy HH:mm'),
          soNameById[v.salesOfficerId] || v.salesOfficerId,
          storeNameById[v.retailerId] || v.retailerName || v.retailerId,
          v.retailerId,
          v.note || '',
          v.latitude ?? '',
          v.longitude ?? '',
          formatDistanceMeters(dist),
          status === 'ok' ? 'Near store' : status === 'far' ? 'Far from store' : 'No GPS / no store geo',
        ];
      }),
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'SO Visits');
    XLSX.writeFile(wb, `so-visits-${istDateStampCompact()}.xlsx`);
  };

  const storeLabel = (v: SoVisitLog) =>
    storeNameById[v.retailerId] || v.retailerName || v.retailerId || '—';

  if (isLoading) return <Loading message="Loading SO visits..." />;

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Home', path: '/' }, { label: 'SO visits' }]} />
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box display="flex" alignItems="center" gap={1}>
          <Place color="primary" />
          <Typography variant="h4">SO Visits</Typography>
        </Box>
        <Button variant="outlined" startIcon={<Download />} onClick={handleExport}>
          Export Excel
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Visits logged by Sales Officers from the mobile app. Distance compares visit GPS to the
        store&apos;s saved location (soft check ~500 m).
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              size="small"
              label="From"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              size="small"
              label="To"
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Sales Officer</InputLabel>
              <Select
                label="Sales Officer"
                value={soFilter}
                onChange={(e) => handleSoFilterChange(String(e.target.value))}
              >
                <MenuItem value="">All officers</MenuItem>
                {salesOfficers.map((so) => (
                  <MenuItem key={so.id} value={so.id}>
                    {so.displayName || so.email}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search store, SO, note…"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
        </Grid>
        {dateRangeInvalid && (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            From date must be on or before To date.
          </Typography>
        )}
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <SortableTableHeadCell
                columnId="visitedAt"
                label="Visited"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="salesOfficer"
                label="Sales Officer"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="store"
                label="Store"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <TableCell>Location check</TableCell>
              <TableCell>Note</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    No visits found for the selected filters.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((v) => {
                const dist = distanceForVisit(v);
                const status = visitDistanceStatus(dist);
                return (
                <TableRow key={v.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {format(v.visitedAt, 'dd MMM yyyy HH:mm')}
                  </TableCell>
                  <TableCell>{soNameById[v.salesOfficerId] || v.salesOfficerId || '—'}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      sx={{ textTransform: 'none', justifyContent: 'flex-start', p: 0, minWidth: 0 }}
                      onClick={() => navigate(`/stores`)}
                      title={v.retailerId}
                    >
                      {storeLabel(v)}
                    </Button>
                  </TableCell>
                  <TableCell>
                    {status === 'unknown' ? (
                      <Typography variant="caption" color="text.secondary">
                        {v.latitude == null
                          ? 'No visit GPS'
                          : 'No store geo-tag'}
                      </Typography>
                    ) : (
                      <Chip
                        size="small"
                        label={`${formatDistanceMeters(dist)} · ${status === 'ok' ? 'Near' : 'Far'}`}
                        color={status === 'ok' ? 'success' : 'warning'}
                        variant="outlined"
                        title={
                          v.latitude != null && v.longitude != null
                            ? `${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}`
                            : undefined
                        }
                      />
                    )}
                  </TableCell>
                  <TableCell>{v.note || '—'}</TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {filtered.length > 0 && (
        <Box display="flex" justifyContent="center" mt={2}>
          <Pagination
            count={totalPages}
            page={pageSafe}
            onChange={(_, p) => setPage(p)}
            color="primary"
            showFirstButton
            showLastButton
          />
        </Box>
      )}
    </Box>
  );
};
