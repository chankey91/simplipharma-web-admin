import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  Grid,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { FileDownload, KeyboardArrowDown, KeyboardArrowUp } from '@mui/icons-material';
import { GstWorkspace } from '../../components/gst/GstWorkspace';
import { Loading } from '../../components/Loading';
import { useGstPeriodParam } from '../../hooks/useGstPeriod';
import { useGstSlabReport } from '../../hooks/useGst';
import { downloadGstSlabExcel, linesForSlab, type GstSlabLineDetail } from '../../utils/gstSlabReport';

function money(value: number) {
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function slabLabel(rt: number) {
  return `${rt}%`;
}

function kindLabel(kind: GstSlabLineDetail['kind']) {
  if (kind === 'credit_note') return 'CN';
  if (kind === 'debit_note') return 'DN';
  return 'INV';
}

const SlabLines: React.FC<{ lines: GstSlabLineDetail[] }> = ({ lines }) => {
  if (!lines.length) {
    return (
      <Typography color="text.secondary" sx={{ py: 1 }}>
        No invoice lines on this slab.
      </Typography>
    );
  }
  return (
    <Box sx={{ maxHeight: 360, overflow: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Type</TableCell>
            <TableCell>Number</TableCell>
            <TableCell>Date</TableCell>
            <TableCell>Party</TableCell>
            <TableCell>Product</TableCell>
            <TableCell>HSN</TableCell>
            <TableCell align="right">Qty</TableCell>
            <TableCell align="right">Taxable</TableCell>
            <TableCell align="right">Tax</TableCell>
            <TableCell align="right">Total</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.map((line, index) => (
            <TableRow key={`${line.kind}-${line.number}-${line.productName}-${index}`}>
              <TableCell>{kindLabel(line.kind)}</TableCell>
              <TableCell>{line.number}</TableCell>
              <TableCell>{line.date}</TableCell>
              <TableCell>{line.party}</TableCell>
              <TableCell>{line.productName}</TableCell>
              <TableCell>{line.hsn || '—'}</TableCell>
              <TableCell align="right">{line.qty}</TableCell>
              <TableCell align="right">{money(line.taxable)}</TableCell>
              <TableCell align="right">{money(line.tax)}</TableCell>
              <TableCell align="right">{money(line.total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};

export const GstSlabReportPage: React.FC = () => {
  const { date, meta } = useGstPeriodParam();
  const reportQuery = useGstSlabReport(date);
  const report = reportQuery.data;
  const [openRt, setOpenRt] = useState<number | null>(null);
  const openLines = useMemo(
    () => (report && openRt != null ? linesForSlab(report.lines, openRt) : []),
    [report, openRt]
  );

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
        Taxable sales in this quarter, split by GST rate. Click a GST % row for invoice number,
        product, and amounts. Download Excel for the summary plus a line sheet. Credit notes reduce
        the slab; debit notes add.
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
                  <TableCell width={48} />
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
                  <TableCell width={56} />
                </TableRow>
              </TableHead>
              <TableBody>
                {(report?.rows || []).map((row) => {
                  const open = openRt === row.rt;
                  return (
                    <React.Fragment key={row.rt}>
                      <TableRow
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => setOpenRt(open ? null : row.rt)}
                      >
                        <TableCell>
                          <IconButton size="small" aria-label={open ? 'Hide lines' : 'Show lines'}>
                            {open ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
                          </IconButton>
                        </TableCell>
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
                        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                          <Tooltip title={`Download ${slabLabel(row.rt)} lines`}>
                            <span>
                              <IconButton
                                size="small"
                                disabled={!report}
                                onClick={() => report && downloadGstSlabExcel(report, row.rt)}
                              >
                                <FileDownload fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={14} sx={{ py: 0, borderBottom: open ? undefined : 0 }}>
                          <Collapse in={open} timeout="auto" unmountOnExit>
                            <Box sx={{ py: 1.5 }}>
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                {openLines.length} line(s) at {slabLabel(row.rt)}
                              </Typography>
                              <SlabLines lines={openLines} />
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
                {report?.rows.length ? (
                  <TableRow>
                    <TableCell />
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
                    <TableCell />
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableCell colSpan={14}>
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
