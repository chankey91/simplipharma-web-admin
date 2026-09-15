import React, { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { GstWorkspace } from '../../components/gst/GstWorkspace';
import { Loading } from '../../components/Loading';
import { useGstPeriodParam } from '../../hooks/useGstPeriod';
import { useGstItcBooks, useReconcileGstr2b } from '../../hooks/useGst';
import { FileDownload } from '@mui/icons-material';
import * as XLSX from 'xlsx';
import { itcEligibleTotal, type Gst2bMatchRow } from '../../utils/gstr2bMatch';

const statusColor = (status: string): 'success' | 'warning' | 'error' | 'default' => {
  if (status === 'matched') return 'success';
  if (status === 'amount_mismatch') return 'warning';
  if (status === 'portal_only') return 'error';
  return 'default';
};

export const GstItcPage: React.FC = () => {
  const { date, meta } = useGstPeriodParam();
  const booksQuery = useGstItcBooks(date);
  const reconcile = useReconcileGstr2b(date);
  const fileRef = useRef<HTMLInputElement>(null);
  const [matches, setMatches] = useState<Gst2bMatchRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setParseError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      const result = await reconcile.mutateAsync(json);
      setMatches(result.rows);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Could not read GSTR-2B JSON');
    }
  };

  if (booksQuery.isLoading) {
    return (
      <GstWorkspace>
        <Loading message="Loading purchase books…" />
      </GstWorkspace>
    );
  }

  const books = booksQuery.data || [];
  const itc = itcEligibleTotal(books);
  const rows: Gst2bMatchRow[] =
    matches ||
    books.map((book) => ({
      status: 'books_only',
      books: book,
      message: book.hasSnapshot
        ? `${book.vendorInvoiceNumber || book.invoiceNumber} in books — upload GSTR-2B to match`
        : `${book.invoiceNumber} has no GST snapshot`,
    }));

  const handleExcel = () => {
    const sheetRows = rows.map((row) => ({
      Status: row.status,
      Vendor: row.books?.vendorName || '',
      GSTIN: row.books?.vendorGstin || row.portal?.ctin || '',
      Invoice: row.books?.vendorInvoiceNumber || row.books?.invoiceNumber || row.portal?.inum || '',
      Taxable: row.books?.taxableValue ?? row.portal?.txval ?? 0,
      CGST: row.books?.cgst ?? row.portal?.camt ?? 0,
      SGST: row.books?.sgst ?? row.portal?.samt ?? 0,
      IGST: row.books?.igst ?? row.portal?.iamt ?? 0,
      Message: row.message,
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheetRows), 'ITC');
    XLSX.writeFile(book, `ITC_${meta.param}.xlsx`);
  };

  return (
    <GstWorkspace>
      <Typography variant="h5" gutterBottom>
        ITC / GSTR-2B — {meta.label}
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        The GST portal issues GSTR-2B. Download that JSON from gst.gov.in and upload it here to match
        against purchase invoices. Live GSP pull is not connected. ITC below is from our inward
        snapshots with a valid vendor GSTIN.
      </Alert>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="body2">
          {books.length} purchase invoice(s) · eligible ITC CGST {itc.cgst.toFixed(2)} · SGST{' '}
          {itc.sgst.toFixed(2)} · IGST {itc.igst.toFixed(2)}
        </Typography>
        <Box sx={{ mt: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          <Button variant="contained" onClick={() => fileRef.current?.click()} disabled={reconcile.isPending}>
            {reconcile.isPending ? 'Matching…' : 'Upload GSTR-2B JSON'}
          </Button>
          <Button variant="outlined" startIcon={<FileDownload />} onClick={handleExcel} disabled={!rows.length}>
            Download ITC Excel
          </Button>
        </Box>
        {parseError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {parseError}
          </Alert>
        ) : null}
      </Paper>
      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Vendor / GSTIN</TableCell>
              <TableCell>Invoice</TableCell>
              <TableCell align="right">Taxable</TableCell>
              <TableCell>Message</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={row.books?.id || row.portal?.inum || String(idx)}>
                <TableCell>
                  <Chip size="small" label={row.status.replace(/_/g, ' ')} color={statusColor(row.status)} />
                </TableCell>
                <TableCell>
                  {row.books?.vendorName || row.portal?.ctin || '—'}
                  <Typography variant="caption" display="block">
                    {row.books?.vendorGstin || row.portal?.ctin}
                  </Typography>
                </TableCell>
                <TableCell>{row.books?.vendorInvoiceNumber || row.books?.invoiceNumber || row.portal?.inum}</TableCell>
                <TableCell align="right">
                  {(row.books?.taxableValue ?? row.portal?.txval ?? 0).toFixed(2)}
                </TableCell>
                <TableCell>{row.message}</TableCell>
              </TableRow>
            ))}
            {!rows.length ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography color="text.secondary">No purchase invoices in this period.</Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
    </GstWorkspace>
  );
};
