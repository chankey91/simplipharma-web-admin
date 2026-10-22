import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
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
import { useGstSlabReport } from '../../hooks/useGst';
import { downloadGstSlabExcel } from '../../utils/gstSlabReport';

function money(value: number) {
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function slabLabel(rt: number) {
  return `${rt}%`;
}

export const GstSlabReportPage: React.FC = () => {
  const { date, meta } = useGstPeriodParam();
  const reportQuery = useGstSlabReport(date);
  const report = reportQuery.data;

  if (reportQuery.isLoading) {
    return (
      <GstWorkspace>
        <Loading message="Building GST slab sales…" />
      </GstWorkspace>
    );
  }

  return (
    <GstWorkspace>
      <Typography variant="h5" gutterBottom>
        Sales by GST slab — {meta.label}
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Taxable sales in this quarter, split by GST rate. Mixed-rate invoices are split across slabs.
        Credit notes reduce the slab; debit notes add. Backfill this period first if documents are
        missing a GST snapshot.
      </Alert>
      {reportQuery.error ? (
        <Alert severity="error">
          {reportQuery.error instanceof Error ? reportQuery.error.message : 'Could not build report'}
        </Alert>
      ) : (
        <>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    Net taxable
                  </Typography>
                  <Typography variant="h6">{money(report?.totals.taxable ?? 0)}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    Tax
                  </Typography>
                  <Typography variant="h6">{money(report?.totals.tax ?? 0)}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    Invoice total
                  </Typography>
                  <Typography variant="h6">{money(report?.totals.total ?? 0)}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    Invoices
                  </Typography>
                  <Typography variant="h6">{report?.invoiceCount ?? 0}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {report?.documentCount ?? 0} outward documents
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
          {report?.skippedNoSnapshot ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {report.skippedNoSnapshot} document(s) have no GST snapshot and were left out. Backfill
              this period from Overview first.
            </Alert>
          ) : null}
          <Paper sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, pt: 2 }}>
              <Typography variant="subtitle1">GST slab</Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<FileDownload />}
                disabled={!report?.rows.length}
                onClick={() => report && downloadGstSlabExcel(report)}
              >
                Download Excel
              </Button>
            </Box>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>GST %</TableCell>
                  <TableCell align="right">Invoices</TableCell>
                  <TableCell align="right">CN</TableCell>
                  <TableCell align="right">DN</TableCell>
                  <TableCell align="right">Taxable</TableCell>
                  <TableCell align="right">B2B</TableCell>
                  <TableCell align="right">B2C</TableCell>
                  <TableCell align="right">CGST</TableCell>
                  <TableCell align="right">SGST</TableCell>
                  <TableCell align="right">IGST</TableCell>
                  <TableCell align="right">Tax</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(report?.rows || []).map((row) => (
                  <TableRow key={row.rt}>
                    <TableCell>{slabLabel(row.rt)}</TableCell>
                    <TableCell align="right">{row.invoices}</TableCell>
                    <TableCell align="right">{row.creditNotes}</TableCell>
                    <TableCell align="right">{row.debitNotes}</TableCell>
                    <TableCell align="right">{money(row.taxable)}</TableCell>
                    <TableCell align="right">{money(row.b2bTaxable)}</TableCell>
                    <TableCell align="right">{money(row.b2cTaxable)}</TableCell>
                    <TableCell align="right">{money(row.cgst)}</TableCell>
                    <TableCell align="right">{money(row.sgst)}</TableCell>
                    <TableCell align="right">{money(row.igst)}</TableCell>
                    <TableCell align="right">{money(row.tax)}</TableCell>
                    <TableCell align="right">{money(row.total)}</TableCell>
                  </TableRow>
                ))}
                {report?.rows.length ? (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {report.totals.invoices}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {report.totals.creditNotes}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {report.totals.debitNotes}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {money(report.totals.taxable)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {money(report.totals.b2bTaxable)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {money(report.totals.b2cTaxable)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {money(report.totals.cgst)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {money(report.totals.sgst)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {money(report.totals.igst)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {money(report.totals.tax)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {money(report.totals.total)}
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableCell colSpan={12}>
                      <Typography color="text.secondary">
                        No snapshotted sales in this quarter.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}
    </GstWorkspace>
  );
};
