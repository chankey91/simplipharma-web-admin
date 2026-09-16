import React from 'react';
import {
  Alert,
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
import { useGstr3bExport, useMarkGstPeriodStatus } from '../../hooks/useGst';
import { useAuth } from '../../context/AuthContext';
import { useAppDialog } from '../../context/AppDialogProvider';
import { downloadGstr3bJson } from '../../utils/gstr3bJson';
import type { Gstr3bBucket } from '../../utils/gstr3bJson';

function money(value?: number) {
  return (value ?? 0).toFixed(2);
}

function GridRow({
  label,
  bucket,
  txOnly,
}: {
  label: string;
  bucket?: Gstr3bBucket;
  txOnly?: boolean;
}) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell align="right">{money(bucket?.txval)}</TableCell>
      <TableCell align="right">{txOnly ? '—' : money(bucket?.iamt)}</TableCell>
      <TableCell align="right">{txOnly ? '—' : money(bucket?.camt)}</TableCell>
      <TableCell align="right">{txOnly ? '—' : money(bucket?.samt)}</TableCell>
      <TableCell align="right">{txOnly ? '—' : money(bucket?.csamt)}</TableCell>
    </TableRow>
  );
}

export const GstGstr3bPage: React.FC = () => {
  const { date, meta } = useGstPeriodParam();
  const { canWrite } = useAuth();
  const { alert, confirm, prompt } = useAppDialog();
  const exportQuery = useGstr3bExport(date, true);
  const markStatus = useMarkGstPeriodStatus(date);

  const handleDownload = async () => {
    const result = exportQuery.data;
    if (!result) return;
    downloadGstr3bJson(result);
    if (canWrite('gst')) {
      const ok = await confirm('Mark GSTR-3B as filed after you upload and file it on the GST portal?');
      if (ok) {
        const arn = await prompt('GST portal ARN (optional)', {
          placeholder: 'ARN',
          confirmLabel: 'Save',
        });
        if (arn !== null) {
          try {
            await markStatus.mutateAsync({ status: 'gstr3b_filed', arn: arn.trim() || undefined });
          } catch (err) {
            await alert(err instanceof Error ? err.message : 'Could not update period status', {
              severity: 'warning',
            });
          }
        }
      }
    }
    await alert(
      `Downloaded ${result.filename}. Upload on gst.gov.in → Returns → GSTR-3B. This does not file.`,
      { severity: 'success' }
    );
  };

  if (exportQuery.isLoading) {
    return (
      <GstWorkspace>
        <Loading message="Building GSTR-3B…" />
      </GstWorkspace>
    );
  }

  const summary = exportQuery.data?.summary;
  const empty = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };

  return (
    <GstWorkspace>
      <Typography variant="h5" gutterBottom>
        GSTR-3B JSON — {meta.label}
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Table 3.1 below is the worksheet for your CA. Monthly tax payable (outward net of notes) and
        ITC from purchase invoices with valid vendor GSTIN. Reverse charge, imports, and ISD stay at
        zero. Filing stays on the GST portal.
      </Alert>
      {exportQuery.error ? (
        <Alert severity="error">
          {exportQuery.error instanceof Error ? exportQuery.error.message : 'Export failed'}
        </Alert>
      ) : (
        <>
          <Paper sx={{ mb: 2 }}>
            <Typography variant="subtitle1" sx={{ px: 2, pt: 2 }}>
              3.1 Details of outward supplies
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Nature</TableCell>
                  <TableCell align="right">Taxable</TableCell>
                  <TableCell align="right">IGST</TableCell>
                  <TableCell align="right">CGST</TableCell>
                  <TableCell align="right">SGST</TableCell>
                  <TableCell align="right">Cess</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <GridRow label="(a) Outward taxable supplies" bucket={summary?.outward} />
                <GridRow label="(b) Zero rated" bucket={empty} />
                <GridRow label="(c) Nil / exempt" bucket={empty} />
                <GridRow label="(d) Reverse charge inward" bucket={empty} />
                <GridRow label="(e) Non-GST outward" bucket={empty} txOnly />
              </TableBody>
            </Table>
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              ITC (OTH) taxable {money(summary?.itc.txval)} · CGST {money(summary?.itc.camt)} · SGST{' '}
              {money(summary?.itc.samt)} · IGST {money(summary?.itc.iamt)} · {summary?.outwardCount ?? 0}{' '}
              outward / {summary?.inwardCount ?? 0} inward documents
            </Typography>
            {(summary?.warnings || []).length ? (
              <Alert severity="warning" sx={{ mb: 2, whiteSpace: 'pre-line' }}>
                {summary!.warnings.slice(0, 10).join('\n')}
              </Alert>
            ) : null}
            <Button
              variant="contained"
              startIcon={<FileDownload />}
              onClick={() => void handleDownload()}
              disabled={!summary}
            >
              Download GSTR-3B JSON
            </Button>
          </Paper>
        </>
      )}
    </GstWorkspace>
  );
};
