import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
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
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { Loading } from '../../components/Loading';
import { GstWorkspace } from '../../components/gst/GstWorkspace';
import {
  useApplyGstBackfill,
  useCompanyGstSettings,
  useGstHealthReport,
  useGstPeriodRecord,
  usePatchPartyGstin,
  usePreviewGstBackfill,
} from '../../hooks/useGst';
import { useGstPeriodParam } from '../../hooks/useGstPeriod';
import { periodIsLocked } from '../../utils/gstPeriod';
import { gstinHelperText, isValidGstinFormat } from '../../utils/gstin';
import { useAuth } from '../../context/AuthContext';
import { useAppDialog } from '../../context/AppDialogProvider';
import type { GstException } from '../../types/gst';

const severityColor = (severity: string): 'error' | 'warning' | 'info' | 'default' => {
  if (severity === 'error') return 'error';
  if (severity === 'warning') return 'warning';
  if (severity === 'info') return 'info';
  return 'default';
};

export const GstDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const { alert, confirm } = useAppDialog();
  const { date, meta } = useGstPeriodParam();
  const period = meta;
  const writable = canWrite('gst');
  const { data: settings, isLoading: settingsLoading } = useCompanyGstSettings();
  const { data: report, isLoading: reportLoading, error } = useGstHealthReport(date);
  const periodRecord = useGstPeriodRecord(date);
  const locked = periodIsLocked(periodRecord.data?.status);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const previewQuery = usePreviewGstBackfill(date, backfillOpen);
  const applyMutation = useApplyGstBackfill(date);
  const patchGstinMutation = usePatchPartyGstin();
  const [gstinEdit, setGstinEdit] = useState<GstException | null>(null);
  const [gstinValue, setGstinValue] = useState('');

  const handleExceptionAction = (row: GstException) => {
    if (row.actionKind === 'backfill') {
      setBackfillOpen(true);
      return;
    }
    if (row.actionKind === 'editGstin') {
      setGstinEdit(row);
      setGstinValue('');
      return;
    }
    if (row.actionPath) navigate(row.actionPath);
  };

  const handleSaveGstin = async () => {
    if (!gstinEdit) return;
    try {
      await patchGstinMutation.mutateAsync({
        documentType: gstinEdit.documentType === 'vendor' ? 'vendor' : 'store',
        documentId: gstinEdit.documentId,
        gstin: gstinValue,
      });
      setGstinEdit(null);
      await alert('GSTIN saved.', { severity: 'success' });
    } catch (err) {
      await alert(err instanceof Error ? err.message : 'Could not save GSTIN', { severity: 'error' });
    }
  };

  const handleApplyBackfill = async () => {
    const preview = previewQuery.data;
    if (!preview || preview.total === 0) return;
    const ok = await confirm(
      `Write GST snapshots on ${preview.total} document(s) for ${preview.periodLabel}?\n\n` +
        `Invoice numbers and rupee totals will not change. This only adds a gst snapshot so GSTR-1 can include them.`
    );
    if (!ok) return;
    try {
      const result = await applyMutation.mutateAsync();
      setBackfillOpen(false);
      const parts = [`Updated ${result.updated} document(s)`];
      if (result.skipped) parts.push(`skipped ${result.skipped} already snapshotted`);
      if (result.failed) parts.push(`${result.failed} failed`);
      await alert(
        parts.join(', ') + '.' + (result.firstError ? `\n\nFirst error: ${result.firstError}` : ''),
        { severity: result.failed ? 'warning' : 'success' }
      );
    } catch (err) {
      await alert(err instanceof Error ? err.message : 'Backfill failed', { severity: 'error' });
    }
  };

  if (settingsLoading || reportLoading) {
    return <Loading message="Loading GST workspace..." />;
  }

  const legacyTotal =
    (report?.legacyInvoicesThisPeriod ?? 0) +
    (report?.legacyCreditNotesThisPeriod ?? 0) +
    (report?.legacyDebitNotesThisPeriod ?? 0) +
    (report?.legacyPurchaseInvoicesThisPeriod ?? 0);

  return (
    <GstWorkspace>
    <Box>
      <Breadcrumbs items={[{ label: 'GST' }]} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3, gap: 2 }}>
        <Box>
          <Typography variant="h4" gutterBottom>
            GST
          </Typography>
          <Typography color="text.secondary">
            Exception queue and backfill for {period.label}. GSTR-1 / GSTR-3B / ITC / e-invoice are in
            the tabs above. Issued amounts are not rewritten.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
          {legacyTotal > 0 ? (
            <Button
              variant="contained"
              onClick={() => setBackfillOpen(true)}
              disabled={!writable || locked}
            >
              Process this period
            </Button>
          ) : null}
        </Box>
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        Snapshots classify invoices for GSTN JSON. They do not rewrite previously issued amounts or
        file the return. Upload JSON on gst.gov.in.
      </Alert>

      {error ? (
        <Alert severity="error" sx={{ mb: 3 }}>
          Could not load GST health: {error instanceof Error ? error.message : String(error)}
        </Alert>
      ) : null}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Company GSTIN
              </Typography>
              <Typography variant="h6">{settings?.gstin || '—'}</Typography>
              <Typography variant="body2" color="text.secondary">
                {settings?.legalName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {settings?.state} ({settings?.stateCode}) · {settings?.filingFrequency}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                This month — invoiced orders
              </Typography>
              <Typography variant="h6">{report?.invoicedThisPeriod ?? 0}</Typography>
              <Typography variant="body2" color="text.secondary">
                {report?.snapshotsThisPeriod ?? 0} with GST snapshot ·{' '}
                {report?.legacyInvoicesThisPeriod ?? 0} legacy
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Master-data exceptions
              </Typography>
              <Typography variant="h6">
                {(report?.storesInvalidGstin ?? 0) + (report?.vendorsInvalidGstin ?? 0)} invalid
                GSTIN
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {report?.storesMissingGstin ?? 0} stores without GSTIN ·{' '}
                {report?.medicinesMissingHsn ?? 0} medicines without HSN
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Exception queue
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Use Action to edit the store/vendor, open inventory, or backfill issued documents for this
          month.
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Severity</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Ref</TableCell>
                <TableCell>Message</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(report?.exceptions || []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Chip size="small" label={row.severity} color={severityColor(row.severity)} />
                  </TableCell>
                  <TableCell>{row.documentType}</TableCell>
                  <TableCell>{row.documentNumber || row.documentId}</TableCell>
                  <TableCell>{row.message}</TableCell>
                  <TableCell align="right">
                    {row.actionLabel ? (
                      <Button
                        size="small"
                        variant={row.actionKind === 'backfill' ? 'contained' : 'outlined'}
                        onClick={() => handleExceptionAction(row)}
                        disabled={(row.actionKind === 'backfill' || row.actionKind === 'editGstin') && !writable}
                      >
                        {row.actionLabel}
                      </Button>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!report?.exceptions?.length ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography color="text.secondary">No exceptions in this scan.</Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={backfillOpen} onClose={() => setBackfillOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Backfill GST snapshots — {period.label}</DialogTitle>
        <DialogContent>
          {previewQuery.isLoading ? (
            <Typography sx={{ py: 2 }}>Building preview…</Typography>
          ) : previewQuery.error ? (
            <Alert severity="error">
              {previewQuery.error instanceof Error
                ? previewQuery.error.message
                : 'Could not preview backfill'}
            </Alert>
          ) : (
            <>
              <Alert severity="warning" sx={{ mb: 2 }}>
                Faithful to issued bills: CGST/SGST split of the existing tax, place of supply =
                company state. Invoice numbers and totals are not changed.
              </Alert>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {previewQuery.data?.orders ?? 0} sales invoices · {previewQuery.data?.creditNotes ?? 0}{' '}
                credit notes · {previewQuery.data?.debitNotes ?? 0} debit notes ·{' '}
                {previewQuery.data?.purchaseInvoices ?? 0} purchase invoices
              </Typography>
              {(previewQuery.data?.samples || []).length > 0 ? (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Number</TableCell>
                        <TableCell>Party</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell align="right">Tax</TableCell>
                        <TableCell align="right">CGST</TableCell>
                        <TableCell align="right">SGST</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {previewQuery.data!.samples.map((row) => (
                        <TableRow key={`${row.collection}-${row.documentId}`}>
                          <TableCell>{row.number}</TableCell>
                          <TableCell>{row.party}</TableCell>
                          <TableCell>{row.invoiceType}</TableCell>
                          <TableCell align="right">{row.taxAmount.toFixed(2)}</TableCell>
                          <TableCell align="right">{row.cgst.toFixed(2)}</TableCell>
                          <TableCell align="right">{row.sgst.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography color="text.secondary">Nothing to backfill in this month.</Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBackfillOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleApplyBackfill()}
            disabled={
              !writable ||
              applyMutation.isPending ||
              locked ||
              !previewQuery.data ||
              previewQuery.data.total === 0
            }
          >
            {applyMutation.isPending ? 'Writing…' : `Apply to ${previewQuery.data?.total ?? 0} documents`}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(gstinEdit)} onClose={() => setGstinEdit(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {gstinEdit?.documentType === 'vendor' ? 'Vendor GSTIN' : 'Store GSTIN'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {gstinEdit?.message}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label="GSTIN"
            value={gstinValue}
            onChange={(e) => setGstinValue(e.target.value.toUpperCase())}
            helperText={gstinHelperText(gstinValue)}
            error={Boolean(gstinValue.trim()) && !isValidGstinFormat(gstinValue)}
            inputProps={{ maxLength: 15 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGstinEdit(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleSaveGstin()}
            disabled={
              !writable ||
              patchGstinMutation.isPending ||
              (gstinEdit?.documentType === 'vendor'
                ? !isValidGstinFormat(gstinValue)
                : Boolean(gstinValue.trim()) && !isValidGstinFormat(gstinValue))
            }
          >
            {patchGstinMutation.isPending ? 'Saving…' : 'Save GSTIN'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
    </GstWorkspace>
  );
};
