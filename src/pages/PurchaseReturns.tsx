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
} from '@mui/material';
import { Search, Add, Visibility } from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { usePurchaseReturns } from '../hooks/usePurchaseReturns';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';

const ROWS_PER_PAGE = 15;

export const PurchaseReturnsPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: returns, isLoading } = usePurchaseReturns();
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const { sortKey, sortDirection, requestSort } = useTableSort('returnDate', 'desc');

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let rows = returns ?? [];
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
  }, [returns, searchTerm, sortKey, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const pageRows = filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  if (isLoading) return <Loading message="Loading purchase returns..." />;

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Purchase returns' }]} />
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">Purchase Returns</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => navigate('/purchase-returns/new')}
        >
          Create return
        </Button>
      </Box>

      <TextField
        fullWidth
        size="small"
        placeholder="Search return no., vendor, medicine, batch…"
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          setPage(1);
        }}
        sx={{ mb: 2, maxWidth: 480 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search />
            </InputAdornment>
          ),
        }}
      />

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
              <TableCell align="center">View</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
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
