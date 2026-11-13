import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Grid,
  Card,
  CardContent,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { format } from 'date-fns';
import { useOrdersInDateRange } from '../hooks/useOrders';
import { useStores } from '../hooks/useStores';
import { Loading } from '../components/Loading';
import { IstDateField } from '../components/IstDateField';
import { getTodayDateStringIST, istDateRangeBounds } from '../utils/dateTime';
import { buildRetailerDiscountSales } from '../utils/retailerDiscountSales';

const formatCurrency = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const RetailerDiscountSalesPage: React.FC = () => {
  const today = getTodayDateStringIST();
  const [fromDate, setFromDate] = useState(`${today.slice(0, 8)}01`);
  const [toDate, setToDate] = useState(today);
  const [search, setSearch] = useState('');

  const rangeOk = Boolean(fromDate && toDate && fromDate <= toDate);
  const { startMs, endMsExclusive } = useMemo(
    () => (rangeOk ? istDateRangeBounds(fromDate, toDate) : { startMs: 0, endMsExclusive: 0 }),
    [fromDate, toDate, rangeOk]
  );
  const { data: orders, isLoading: ordersLoading } = useOrdersInDateRange(startMs, endMsExclusive, {
    enabled: rangeOk,
  });
  const { data: stores, isLoading: storesLoading } = useStores();

  const groups = useMemo(
    () => buildRetailerDiscountSales(orders ?? [], stores ?? []),
    [orders, stores]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.displayName.toLowerCase().includes(q) ||
        g.storeCode.toLowerCase().includes(q) ||
        g.invoices.some((invoice) =>
          invoice.invoiceLabel.toLowerCase().includes(q) ||
          invoice.lines.some((l) => l.medicineName.toLowerCase().includes(q))
        )
    );
  }, [groups, search]);

  const totals = useMemo(
    () => ({
      retailers: filtered.length,
      lines: filtered.reduce((s, g) => s + g.lineCount, 0),
      discount: filtered.reduce((s, g) => s + g.discountAmount, 0),
      amount: filtered.reduce((s, g) => s + g.lineAmount, 0),
    }),
    [filtered]
  );

  if (ordersLoading || storesLoading) {
    return <Loading message="Loading discounted sales..." />;
  }

  return (
    <Box>
      <Box mb={2}>
        <Typography variant="h4" gutterBottom>
          Discounted sales
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Sold items where the retailer invoice discount is above zero. Lines with no discount are left out.
          Pending and cancelled orders are not included.
        </Typography>
      </Box>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box display="flex" flexWrap="wrap" gap={2} alignItems="center">
          <IstDateField label="From" value={fromDate} onChange={setFromDate} />
          <IstDateField label="To" value={toDate} onChange={setToDate} />
          <TextField
            size="small"
            label="Shop, code, or item"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 240 }}
          />
        </Box>
        {!rangeOk && (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            From date must be on or before To date.
          </Typography>
        )}
      </Paper>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" variant="subtitle2">Retailers</Typography>
              <Typography variant="h5">{totals.retailers}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" variant="subtitle2">Discounted items</Typography>
              <Typography variant="h5">{totals.lines}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" variant="subtitle2">Discount given</Typography>
              <Typography variant="h5">{formatCurrency(totals.discount)}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {filtered.length === 0 ? (
        <Paper sx={{ p: 3 }}>
          <Typography color="text.secondary">No discounted sale items in this date range.</Typography>
        </Paper>
      ) : (
        filtered.map((group) => (
          <Accordion key={group.retailerId} disableGutters sx={{ mb: 1, '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} width="100%" pr={1}>
                <Box>
                  <Typography fontWeight={600}>{group.displayName}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {group.storeCode} · {group.invoiceCount} invoice{group.invoiceCount === 1 ? '' : 's'} · {group.lineCount} item{group.lineCount === 1 ? '' : 's'}
                  </Typography>
                </Box>
                <Box textAlign="right">
                  <Typography variant="body2">Discount {formatCurrency(group.discountAmount)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Sale after discount {formatCurrency(group.lineAmount)}
                  </Typography>
                </Box>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {group.invoices.map((invoice) => (
                <Accordion key={invoice.orderId} disableGutters sx={{ boxShadow: 'none', border: '1px solid', borderColor: 'divider', mb: 1 }}>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} width="100%" pr={1}>
                      <Box>
                        <Typography fontWeight={600}>{invoice.invoiceLabel}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {format(invoice.orderDate, 'dd MMM yyyy')} · {invoice.lineCount} item{invoice.lineCount === 1 ? '' : 's'}
                        </Typography>
                      </Box>
                      <Box textAlign="right">
                        <Typography variant="body2">Discount {formatCurrency(invoice.discountAmount)}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Sale after discount {formatCurrency(invoice.lineAmount)}
                        </Typography>
                      </Box>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Item</TableCell>
                          <TableCell align="right">Qty</TableCell>
                          <TableCell align="right">Discount %</TableCell>
                          <TableCell align="right">Discount</TableCell>
                          <TableCell align="right">Amount</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {invoice.lines.map((line, index) => (
                          <TableRow key={`${invoice.orderId}-${index}`}>
                            <TableCell>
                              {line.medicineName}
                              {line.offerTitle ? (
                                <Typography variant="caption" display="block" color="text.secondary">
                                  {line.offerTitle}
                                </Typography>
                              ) : null}
                            </TableCell>
                            <TableCell align="right">{line.quantity}</TableCell>
                            <TableCell align="right">{line.discountPct}%</TableCell>
                            <TableCell align="right">{formatCurrency(line.discountAmount)}</TableCell>
                            <TableCell align="right">{formatCurrency(line.lineAmount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionDetails>
                </Accordion>
              ))}
            </AccordionDetails>
          </Accordion>
        ))
      )}
    </Box>
  );
};
