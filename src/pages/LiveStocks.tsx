import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Chip,
  LinearProgress,
} from '@mui/material';
import { UploadFile } from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllVendors } from '../services/vendors';
import {
  deleteLiveStockUpload,
  listLiveStockOffers,
  listLiveStockUploads,
  uploadLiveStockFile,
  type LiveStockUpload,
} from '../services/liveStock';
import { useAppDialog } from '../context/AppDialogProvider';
import { Loading } from '../components/Loading';

function statusColor(status: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (status === 'ready') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'extracting' || status === 'uploaded') return 'info';
  return 'default';
}

export const LiveStocksPage: React.FC = () => {
  const { alert, confirm } = useAppDialog();
  const queryClient = useQueryClient();
  const [vendorId, setVendorId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [selected, setSelected] = useState<LiveStockUpload | null>(null);
  const [filter, setFilter] = useState('');

  const vendorsQuery = useQuery({ queryKey: ['vendors'], queryFn: getAllVendors });
  const uploadsQuery = useQuery({ queryKey: ['liveStockUploads'], queryFn: listLiveStockUploads });
  const offersQuery = useQuery({
    queryKey: ['liveStockOffers', selected?.id],
    queryFn: () => listLiveStockOffers(selected!.id),
    enabled: Boolean(selected?.id) && selected?.status === 'ready',
  });

  const vendors = useMemo(
    () => (vendorsQuery.data || []).filter((vendor) => vendor.isActive !== false),
    [vendorsQuery.data]
  );

  const visibleOffers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = offersQuery.data || [];
    if (!q) return rows;
    return rows.filter((row) =>
      `${row.productName} ${row.manufacturer || ''} ${row.pack || ''}`.toLowerCase().includes(q)
    );
  }, [offersQuery.data, filter]);

  const loadFile = async () => {
    const vendor = vendors.find((item) => item.id === vendorId);
    if (!vendor) {
      await alert('Choose the vendor this stock file belongs to.', { severity: 'warning' });
      return;
    }
    if (!file) {
      await alert('Choose a CSV, Excel, or PDF file.', { severity: 'warning' });
      return;
    }
    setBusy(true);
    try {
      const result = await uploadLiveStockFile({
        vendorId: vendor.id,
        vendorName: vendor.vendorName,
        file,
      });
      setFile(null);
      await queryClient.invalidateQueries({ queryKey: ['liveStockUploads'] });
      await alert(result.message || `Loaded ${result.rowCount} rows.`, { severity: 'success' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not load this stock file';
      await alert(message, { severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const removeUpload = async (upload: LiveStockUpload) => {
    const ok = await confirm(
      `Delete ${upload.vendorName}'s stock file ${upload.fileName}? Products from this file are removed from live stock. A newer file for the same vendor is kept.`,
      { title: 'Delete stock list', confirmLabel: 'Delete', destructive: true }
    );
    if (!ok) return;
    setDeletingId(upload.id);
    try {
      await deleteLiveStockUpload(upload.id);
      if (selected?.id === upload.id) setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ['liveStockUploads'] });
      await queryClient.invalidateQueries({ queryKey: ['liveStockOffers', upload.id] });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not delete this stock list';
      await alert(message, { severity: 'error' });
    } finally {
      setDeletingId('');
    }
  };

  if (vendorsQuery.isLoading || uploadsQuery.isLoading) return <Loading message="Loading live stock..." />;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Live stock
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Upload each vendor&apos;s stock file. The latest file replaces that vendor&apos;s previous
        stock. Purchase lists then mark P1, P2, and P3 from price, scheme, and available quantity.
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            select
            label="Vendor"
            value={vendorId}
            onChange={(event) => setVendorId(event.target.value)}
            sx={{ minWidth: 280 }}
            size="small"
          >
            {vendors.map((vendor) => (
              <MenuItem key={vendor.id} value={vendor.id}>
                {vendor.vendorName}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="outlined" component="label" startIcon={<UploadFile />}>
            {file ? file.name : 'CSV, Excel, or PDF'}
            <input
              hidden
              type="file"
              accept=".csv,.xlsx,.xls,.pdf,text/csv,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => void loadFile()}>
            {busy ? 'Reading file…' : 'Load stock'}
          </Button>
        </Box>
        {busy ? <LinearProgress sx={{ mt: 2 }} /> : null}
      </Paper>

      <TableContainer component={Paper} sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Vendor</TableCell>
              <TableCell>File</TableCell>
              <TableCell>Rows</TableCell>
              <TableCell>Status</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(uploadsQuery.data || []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>No stock files loaded yet.</TableCell>
              </TableRow>
            ) : (
              (uploadsQuery.data || []).map((upload) => (
                <TableRow key={upload.id} selected={selected?.id === upload.id} hover>
                  <TableCell>{upload.vendorName}</TableCell>
                  <TableCell>{upload.fileName}</TableCell>
                  <TableCell>{upload.rowCount ?? '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={upload.status} color={statusColor(upload.status)} />
                    {upload.error ? (
                      <Typography variant="caption" display="block" color="error">
                        {upload.error}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setSelected(upload)} disabled={upload.status !== 'ready'}>
                      View
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      sx={{ ml: 1 }}
                      disabled={Boolean(deletingId)}
                      onClick={() => void removeUpload(upload)}
                    >
                      {deletingId === upload.id ? 'Deleting…' : 'Delete'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {selected ? (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 1 }}>
            <Typography variant="subtitle1">
              {selected.vendorName} · {selected.fileName}
            </Typography>
            <TextField
              size="small"
              label="Find product"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </Box>
          {offersQuery.isLoading ? <LinearProgress /> : null}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell>Pack</TableCell>
                  <TableCell align="right">Stock</TableCell>
                  <TableCell align="right">Rate</TableCell>
                  <TableCell>Scheme</TableCell>
                  <TableCell align="right">Effective</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleOffers.slice(0, 400).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.productName}
                      {row.manufacturer ? (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {row.manufacturer}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>{row.pack || '—'}</TableCell>
                    <TableCell align="right">{row.stockQty}</TableCell>
                    <TableCell align="right">{row.rate ?? '—'}</TableCell>
                    <TableCell>{row.scheme || '—'}</TableCell>
                    <TableCell align="right">{row.effectiveRate ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {visibleOffers.length > 400 ? (
            <Typography variant="caption" color="text.secondary">
              Showing the first 400 matches.
            </Typography>
          ) : null}
        </Paper>
      ) : null}
    </Box>
  );
};
