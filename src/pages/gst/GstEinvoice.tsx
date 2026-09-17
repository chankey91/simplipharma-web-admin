import React from 'react';
import { Alert, Button, Paper, Typography } from '@mui/material';
import { FileDownload } from '@mui/icons-material';
import { GstWorkspace } from '../../components/gst/GstWorkspace';
import { Loading } from '../../components/Loading';
import { useGstPeriodParam } from '../../hooks/useGstPeriod';
import { useCompanyGstSettings, useEinvoiceExport } from '../../hooks/useGst';
import { useAppDialog } from '../../context/AppDialogProvider';
import { downloadEinvoiceJson } from '../../utils/einvoiceJson';

export const GstEinvoicePage: React.FC = () => {
  const { date, meta } = useGstPeriodParam();
  const { alert } = useAppDialog();
  const settingsQuery = useCompanyGstSettings();
  const exportQuery = useEinvoiceExport(date, true);
  const enabled = settingsQuery.data?.einvoiceEnabled === true;

  const handleDownload = async () => {
    const result = exportQuery.data;
    if (!result) return;
    if (!result.summary.count) {
      await alert('No B2B invoices with a GST snapshot in this period.', { severity: 'warning' });
      return;
    }
    downloadEinvoiceJson(result);
    await alert(
      `Downloaded ${result.filename}. This is IRP JSON for the NIC / e-invoice bulk tool. It does not generate an IRN — that needs NIC credentials.`,
      { severity: 'success' }
    );
  };

  if (exportQuery.isLoading || settingsQuery.isLoading) {
    return (
      <GstWorkspace>
        <Loading message="Building e-invoice JSON…" />
      </GstWorkspace>
    );
  }

  return (
    <GstWorkspace>
      <Typography variant="h5" gutterBottom>
        E-invoice (IRP) — {meta.label}
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        NIC does not issue IRNs from this app. Enable e-invoice in GST settings, then download IRP
        JSON for B2B invoices and upload it in the NIC e-invoice bulk / taxpayer tool. E-way bill is
        not generated here.
      </Alert>
      {!enabled ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          E-invoice is off in company GST settings. Turn it on only if your turnover requires IRN.
        </Alert>
      ) : null}
      {exportQuery.error ? (
        <Alert severity="error">
          {exportQuery.error instanceof Error ? exportQuery.error.message : 'Export failed'}
        </Alert>
      ) : (
        <Paper sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {exportQuery.data?.summary.count ?? 0} B2B invoice(s) ·{' '}
            {exportQuery.data?.summary.skipped ?? 0} skipped (not B2B)
          </Typography>
          {(exportQuery.data?.summary.warnings || []).length ? (
            <Alert severity="warning" sx={{ mb: 2, whiteSpace: 'pre-line' }}>
              {exportQuery.data!.summary.warnings.join('\n')}
            </Alert>
          ) : null}
          <Button
            variant="contained"
            startIcon={<FileDownload />}
            disabled={!enabled || !exportQuery.data?.summary.count}
            onClick={() => void handleDownload()}
          >
            Download IRP JSON
          </Button>
        </Paper>
      )}
    </GstWorkspace>
  );
};
