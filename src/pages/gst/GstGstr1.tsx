import React, { useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { FileDownload } from '@mui/icons-material';
import { GstWorkspace } from '../../components/gst/GstWorkspace';
import { Loading } from '../../components/Loading';
import { useGstPeriodParam } from '../../hooks/useGstPeriod';
import { useGstr1Export, useGstPeriodRecord, useLockGstPeriod } from '../../hooks/useGst';
import { useAuth } from '../../context/AuthContext';
import { useAppDialog } from '../../context/AppDialogProvider';
import { downloadGstr1Json } from '../../utils/gstr1Json';
import { buildGstr1Export } from '../../services/gstGstr1';
import { gstr1GoldenErrors } from '../../utils/gstr1Golden';

export const GstGstr1Page: React.FC = () => {
  const { date, meta } = useGstPeriodParam();
  const { canWrite } = useAuth();
  const { alert, confirm } = useAppDialog();
  const exportQuery = useGstr1Export(date, true, 'original');
  const periodQuery = useGstPeriodRecord(date);
  const lockMutation = useLockGstPeriod(date);
  const writable = canWrite('gst');
  const hasPriorExport = Boolean(periodQuery.data?.outwardFingerprints?.length);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const errors = gstr1GoldenErrors();
    if (errors.length) console.error('[GSTR-1 golden]', errors);
  }, []);

  const handleDownload = async (mode: 'original' | 'amendment') => {
    try {
      const result = mode === 'original' ? exportQuery.data : await buildGstr1Export(date, 'amendment');
      if (!result) return;
      if (result.summary.errors.length) {
        await alert(result.summary.errors.join('\n'), { severity: 'error' });
        return;
      }
      if (mode === 'original' && !result.summary.documentCount) {
        await alert('Nothing to export. Backfill this period first.', { severity: 'warning' });
        return;
      }
      downloadGstr1Json(result);
      if (mode === 'original' && writable) {
        const ok = await confirm(
          'JSON downloaded. Lock this period so backfill cannot change the books, and save a fingerprint for later amendments?'
        );
        if (ok) {
          await lockMutation.mutateAsync({
            fingerprints: result.fingerprints,
            filename: result.filename,
            payloadHash: result.payloadHash,
            byteLength: result.byteLength,
          });
        }
      }
      await alert(
        `Downloaded ${result.filename}. Upload on gst.gov.in → Returns → GSTR-1 → Prepare Offline.`,
        { severity: 'success' }
      );
    } catch (err) {
      await alert(err instanceof Error ? err.message : 'Download failed', { severity: 'error' });
    }
  };

  if (exportQuery.isLoading) {
    return (
      <GstWorkspace>
        <Loading message="Building GSTR-1…" />
      </GstWorkspace>
    );
  }

  const summary = exportQuery.data?.summary;
  const register = exportQuery.data?.register || [];

  return (
    <GstWorkspace>
      <Typography variant="h5" gutterBottom>
        GSTR-1 JSON — {meta.label}
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Offline GSTN file (version GST3.2.1) with B2B/B2CL/B2CS/CDNR/CDNUR, HSN, and document
        series. Mixed GST rates on one invoice emit one itm per rate. It does not file the return.
        Confirm the file in the GST portal offline tool before upload.
      </Alert>
      {exportQuery.error ? (
        <Alert severity="error">
          {exportQuery.error instanceof Error ? exportQuery.error.message : 'Export failed'}
        </Alert>
      ) : (
        <>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {summary?.b2b ?? 0} B2B · {summary?.b2cl ?? 0} B2CL · {summary?.b2cs ?? 0} B2CS rows ·{' '}
              {summary?.cdnr ?? 0} CDNR · {summary?.cdnur ?? 0} CDNUR · {summary?.hsn ?? 0} HSN
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
              GSTIN {summary?.gstin} · fp {summary?.fp} · {summary?.documentCount ?? 0} snapshotted
              document(s)
              {exportQuery.data?.payloadHash
                ? ` · SHA-256 ${exportQuery.data.payloadHash.slice(0, 12)}…`
                : ''}
              {exportQuery.data?.byteLength
                ? ` · ${(exportQuery.data.byteLength / 1024).toFixed(1)} KB`
                : ''}
            </Typography>
            {periodQuery.data?.gstr1PayloadHash ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                Last locked export hash {periodQuery.data.gstr1PayloadHash}
                {periodQuery.data.gstr1Arn ? ` · ARN ${periodQuery.data.gstr1Arn}` : ''}
              </Typography>
            ) : null}
            {(summary?.errors || []).length ? (
              <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-line' }}>
                {summary!.errors.join('\n')}
              </Alert>
            ) : null}
            {(summary?.warnings || []).length ? (
              <Alert severity="warning" sx={{ mb: 2, whiteSpace: 'pre-line' }}>
                {summary!.warnings.slice(0, 10).join('\n')}
              </Alert>
            ) : null}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                startIcon={<FileDownload />}
                onClick={() => void handleDownload('original')}
                disabled={!summary || Boolean(summary.errors.length)}
              >
                Download GSTR-1 JSON
              </Button>
              <Button
                variant="outlined"
                disabled={!hasPriorExport}
                onClick={() => void handleDownload('amendment')}
              >
                Download amendment JSON
              </Button>
            </Box>
          </Paper>
          <Paper>
            <Typography variant="subtitle1" sx={{ px: 2, pt: 2 }}>
              Invoice register
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Number</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Party</TableCell>
                  <TableCell>Rates</TableCell>
                  <TableCell align="right">Taxable</TableCell>
                  <TableCell align="right">Tax</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {register.slice(0, 400).map((row) => (
                  <TableRow key={`${row.kind}-${row.number}-${row.date}`}>
                    <TableCell>{row.number}</TableCell>
                    <TableCell>{row.date}</TableCell>
                    <TableCell>{row.invoiceType}</TableCell>
                    <TableCell>{row.party}</TableCell>
                    <TableCell>{row.rates}</TableCell>
                    <TableCell align="right">{row.taxable.toFixed(2)}</TableCell>
                    <TableCell align="right">{row.tax.toFixed(2)}</TableCell>
                    <TableCell align="right">{row.total.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {!register.length ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Typography color="text.secondary">No snapshotted outward documents.</Typography>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
            {register.length > 400 ? (
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1, display: 'block' }}>
                Showing 400 of {register.length} documents.
              </Typography>
            ) : null}
          </Paper>
        </>
      )}
    </GstWorkspace>
  );
};
