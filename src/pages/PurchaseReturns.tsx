import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  IconButton,
  TextField,
  InputAdornment,
  Pagination,
  Chip,
  Autocomplete,
} from '@mui/material';
import { Search, Add, Visibility, FileDownload } from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { usePurchaseReturns } from '../hooks/usePurchaseReturns';
import { useVendors } from '../hooks/useVendors';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';
import { exportPurchaseReturnItemList } from '../utils/purchaseReturnVendorListExport';
import {
  itemReturnOutcome,
  purchaseReturnFulfillmentLabel,
  purchaseReturnOutcomeLabel,
} from '../utils/purchaseReturnFulfillment';
import type { PurchaseReturn, Vendor } from '../types';

const ROWS_PER_PAGE = 15;

function formatExpiry(expiryDate: Date | unknown | undefined): string {
  if (!expiryDate) return '';
  const d =
    expiryDate instanceof Date
      ? expiryDate
      : typeof (expiryDate as { toDate?: () => Date }).toDate === 'function'
        ? (expiryDate as { toDate: () => Date }).toDate()
        : new Date(expiryDate as string | number);
  if (!Number.isFinite(d.getTime())) return '';
  return format(d, 'MM/yy');
}

function formatReturnDate(value: Date | unknown): string {
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isFinite(d.getTime()) ? format(d, 'dd MMM yyyy') : '';
}

function flattenReturnItems(rows: PurchaseReturn[]) {
  return rows.flatMap((ret) =>
    (ret.items || []).map((item) => ({
      returnNumber: ret.returnNumber,
      returnDate: formatReturnDate(ret.returnDate),
      vendorName: ret.vendorName,
      medicineName: item.medicineName,
      batchNumber: item.batchNumber,
      expiry: formatExpiry(item.expiryDate),
      quantity: item.quantity,
      purchasePrice: Number(item.purchasePrice) || 0,
      totalAmount: Number(item.totalAmount) || 0,
      status: purchaseReturnOutcomeLabel(itemReturnOutcome(item, ret)),
    }))
  );
}

function statusChipColor(
  label: string
): 'default' | 'warning' | 'info' | 'success' | 'error' {
  if (label === 'Pending') return 'warning';
  if (label === 'Partial') return 'info';
  if (label === 'Not returned') return 'error';
  return 'success';
}

export const PurchaseReturnsPage: React.FC = () => {
  const navigate = useNavigate();
  const { alert } = useAppDialog();
  const { data: returns, isLoading } = usePurchaseReturns();
  const { data: vendors } = useVendors();
  const [searchTerm, setSearchTerm] = useState('');
  const [vendorFilter, setVendorFilter] = useState<Vendor | null>(null);
  const [page, setPage] = useState(1);
  const { sortKey, sortDirection, requestSort } = useTableSort('returnDate', 'desc');

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let rows = returns ?? [];
    if (vendorFilter?.id) {
      rows = rows.filter((r) => r.vendorId === vendorFilter.id);
    }
    if (term) {
      rows = rows.filter(
        (r) =>
          r.returnNumber.toLowerCase().includes(term) ||
          r.vendorName.toLowerCase().includes(term) ||
          r.items.some(
            (it) =>
              it.medicineName.toLowerCase().includes(term) ||
              it.batchNumber.toLowerCase().includes(term)
          )
      );
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'returnNumber':
          cmp = compareAsc(a.returnNumber, b.returnNumber);
          break;
        case 'vendorName':
          cmp = compareAsc(a.vendorName, b.vendorName);
          break;
        case 'items':
          cmp = compareAsc(a.items.length, b.items.length);
          break;
        case 'totalAmount':
          cmp = compareAsc(a.totalAmount, b.totalAmount);
          break;
        case 'returnDate':
        default:
          cmp = compareAsc(toTimeMs(a.returnDate), toTimeMs(b.returnDate));
          break;
      }
      return applyDirection(cmp, sortDirection);
    });
    return sorted;
  }, [returns, searchTerm, vendorFilter, sortKey, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const pageRows = filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  const handleExport = () => {
    const lines = flattenReturnItems(filtered);
    if (!lines.length) {
      void alert('No items to export for the current filters');
      return;
    }
    exportPurchaseReturnItemList(
      lines,
      vendorFilter?.vendorName
        ? `purchase-return-items-${vendorFilter.vendorName.replace(/\s+/g, '-')}`
        : 'purchase-return-items'
    );
  };

  if (isLoading) return <Loading message="Loading purchase returns..." />;

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Purchase returns' }]} />
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5">Purchase Returns</Typography>
          <Typography variant="body2" color="text.secondary">
            Export the item list (all vendors or one vendor). Mark items returned on the
            return to deduct stock.
          </Typography>
        </Box>
        <Box display="flex" gap={1}>
          <Button
            variant="outlined"
            startIcon={<FileDownload />}
            onClick={handleExport}
            disabled={!filtered.length}
          >
            Export items
          </Button>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => navigate('/purchase-returns/new')}
          >
            Create return
          </Button>
        </Box>
      </Box>

      <Box display="flex" gap={2} mb={2} flexWrap="wrap" alignItems="center">
        <TextField
          size="small"
          placeholder="Search return no., vendor, medicine, batch…"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
          sx={{ flex: '1 1 280px', maxWidth: 480 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search />
              </InputAdornment>
            ),
          }}
        />
        <Autocomplete
          size="small"
          sx={{ minWidth: 260, flex: '0 1 280px' }}
          options={vendors || []}
          getOptionLabel={(v) => v.vendorName || v.id}
          value={vendorFilter}
          onChange={(_, v) => {
            setVendorFilter(v);
            setPage(1);
          }}
          renderInput={(params) => (
            <TextField {...params} label="Vendor" placeholder="All vendors" />
          )}
        />
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <SortableTableHeadCell
                columnId="returnNumber"
                label="Return no."
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="returnDate"
                label="Date"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="vendorName"
                label="Vendor"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="items"
                label="Items"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
                align="right"
              />
              <SortableTableHeadCell
                columnId="totalAmount"
                label="Total"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
                align="right"
              />
              <TableCell>Status</TableCell>
              <TableCell align="center">View</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body2" color="textSecondary" sx={{ py: 4 }}>
                    No purchase returns yet. Create one to return stock to a vendor.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => {
                const d =
                  row.returnDate instanceof Date
                    ? row.returnDate
                    : new Date(row.returnDate);
                return (
                  <TableRow key={row.id} hover>
                    <TableCell>{row.returnNumber}</TableCell>
                    <TableCell>
                      {Number.isFinite(d.getTime()) ? format(d, 'dd MMM yyyy') : '—'}
                    </TableCell>
                    <TableCell>{row.vendorName}</TableCell>
                    <TableCell align="right">{row.items.length}</TableCell>
                    <TableCell align="right">
                      ₹{(row.totalAmount || 0).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={purchaseReturnFulfillmentLabel(row)}
                        color={statusChipColor(purchaseReturnFulfillmentLabel(row))}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => navigate(`/purchase-returns/${row.id}`)}
                        aria-label="View"
                      >
                        <Visibility fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {pageCount > 1 && (
        <Box display="flex" justifyContent="center" mt={2}>
          <Pagination
            count={pageCount}
            page={page}
            onChange={(_, p) => setPage(p)}
            color="primary"
          />
        </Box>
      )}
    </Box>
  );
};
