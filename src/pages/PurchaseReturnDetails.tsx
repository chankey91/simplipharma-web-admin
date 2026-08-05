import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Divider,
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate, useParams } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { usePurchaseReturn } from '../hooks/usePurchaseReturns';

function formatExpiry(expiryDate: Date | unknown | undefined): string {
  if (!expiryDate) return '—';
  const d =
    expiryDate instanceof Date
      ? expiryDate
      : typeof (expiryDate as { toDate?: () => Date }).toDate === 'function'
        ? (expiryDate as { toDate: () => Date }).toDate()
        : new Date(expiryDate as string | number);
  if (!Number.isFinite(d.getTime())) return '—';
  return format(d, 'MM/yy');
}

export const PurchaseReturnDetailsPage: React.FC = () => {
  const { returnId } = useParams<{ returnId: string }>();
  const navigate = useNavigate();
  const { data: purchaseReturn, isLoading } = usePurchaseReturn(returnId || '');

  if (isLoading) return <Loading message="Loading purchase return..." />;
  if (!purchaseReturn) {
    return (
      <Box>
        <Typography>Purchase return not found</Typography>
        <Button onClick={() => navigate('/purchase-returns')}>Back</Button>
      </Box>
    );
  }

  const returnDate =
    purchaseReturn.returnDate instanceof Date
      ? purchaseReturn.returnDate
      : new Date(purchaseReturn.returnDate);

  return (
    <Box>
      <Breadcrumbs
        items={[
          { label: 'Purchase returns', path: '/purchase-returns' },
          { label: purchaseReturn.returnNumber },
        ]}
      />
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">Purchase Return {purchaseReturn.returnNumber}</Typography>
        <Button startIcon={<ArrowBack />} onClick={() => navigate('/purchase-returns')}>
          Back
        </Button>
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Details
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Vendor
            </Typography>
            <Typography variant="body1" sx={{ mb: 2 }}>
              {purchaseReturn.vendorName}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Return date
            </Typography>
            <Typography variant="body1" sx={{ mb: 2 }}>
              {Number.isFinite(returnDate.getTime())
                ? format(returnDate, 'dd MMM yyyy')
                : '—'}
            </Typography>
            {purchaseReturn.reason ? (
              <>
                <Typography variant="body2" color="textSecondary">
                  Reason
                </Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>
                  {purchaseReturn.reason}
                </Typography>
              </>
            ) : null}
            {purchaseReturn.notes ? (
              <>
                <Typography variant="body2" color="textSecondary">
                  Notes
                </Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>
                  {purchaseReturn.notes}
                </Typography>
              </>
            ) : null}
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Subtotal</Typography>
              <Typography>₹{(purchaseReturn.subTotal || 0).toFixed(2)}</Typography>
            </Box>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Tax</Typography>
              <Typography>₹{(purchaseReturn.taxAmount || 0).toFixed(2)}</Typography>
            </Box>
            <Box display="flex" justifyContent="space-between">
              <Typography variant="subtitle1" fontWeight="medium">
                Total
              </Typography>
              <Typography variant="subtitle1" fontWeight="medium">
                ₹{(purchaseReturn.totalAmount || 0).toFixed(2)}
              </Typography>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Items
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Medicine</TableCell>
                    <TableCell>Batch</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="right">GST%</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {purchaseReturn.items.map((item, index) => (
                    <TableRow key={`${item.medicineId}-${item.batchNumber}-${index}`}>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {item.medicineName}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          Exp: {formatExpiry(item.expiryDate)}
                        </Typography>
                      </TableCell>
                      <TableCell>{item.batchNumber}</TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                      <TableCell align="right">
                        ₹{(item.purchasePrice || 0).toFixed(2)}
                      </TableCell>
                      <TableCell align="right">
                        {item.gstRate != null ? `${item.gstRate}%` : '—'}
                      </TableCell>
                      <TableCell align="right">
                        ₹{(item.totalAmount || 0).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
