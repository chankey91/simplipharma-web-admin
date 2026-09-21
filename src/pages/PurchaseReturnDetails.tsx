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
  Chip,
} from '@mui/material';
import { ArrowBack, FileDownload } from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate, useParams } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import {
  usePurchaseReturn,
  useUpdatePurchaseReturnItemOutcomes,
} from '../hooks/usePurchaseReturns';
import { useAuth } from '../context/AuthContext';
import { useAppDialog } from '../context/AppDialogProvider';
import { exportPurchaseReturnItemList } from '../utils/purchaseReturnVendorListExport';
import {
  isLegacyPurchaseReturn,
  itemReturnOutcome,
  purchaseReturnFulfillmentLabel,
  purchaseReturnOutcomeLabel,
} from '../utils/purchaseReturnFulfillment';
import type { PurchaseReturnOutcome } from '../utils/purchaseReturnFulfillment';

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

function outcomeChipColor(
  outcome: PurchaseReturnOutcome
): 'warning' | 'success' | 'error' {
  if (outcome === 'returned') return 'success';
  if (outcome === 'not_returned') return 'error';
  return 'warning';
}

export const PurchaseReturnDetailsPage: React.FC = () => {
  const { returnId } = useParams<{ returnId: string }>();
  const navigate = useNavigate();
  const { alert, confirm } = useAppDialog();
  const { canWrite } = useAuth();
  const canEdit = canWrite('purchases');
  const { data: purchaseReturn, isLoading } = usePurchaseReturn(returnId || '');
  const updateOutcomes = useUpdatePurchaseReturnItemOutcomes();

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
  const legacy = isLegacyPurchaseReturn(purchaseReturn);
  const statusLabel = purchaseReturnFulfillmentLabel(purchaseReturn);
  const pendingIndexes = purchaseReturn.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => itemReturnOutcome(item, purchaseReturn) === 'pending')
    .map(({ index }) => index);

  const handleExport = () => {
    exportPurchaseReturnItemList(
      purchaseReturn.items.map((item) => ({
        returnNumber: purchaseReturn.returnNumber,
        returnDate: Number.isFinite(returnDate.getTime())
          ? format(returnDate, 'dd MMM yyyy')
          : '',
        vendorName: purchaseReturn.vendorName,
        medicineName: item.medicineName,
        batchNumber: item.batchNumber,
        expiry: formatExpiry(item.expiryDate) === '—' ? '' : formatExpiry(item.expiryDate),
        quantity: item.quantity,
        purchasePrice: Number(item.purchasePrice) || 0,
        totalAmount: Number(item.totalAmount) || 0,
        status: purchaseReturnOutcomeLabel(itemReturnOutcome(item, purchaseReturn)),
      })),
      `purchase-return-${purchaseReturn.returnNumber}`
    );
  };

  const applyOutcomes = async (
    updates: Array<{ index: number; outcome: 'returned' | 'not_returned' }>,
    message: string
  ) => {
    if (!canEdit) {
      await alert('You do not have permission to update purchase returns', {
        severity: 'error',
      });
      return;
    }
    const ok = await confirm(message);
    if (!ok) return;
    try {
      await updateOutcomes.mutateAsync({ returnId: purchaseReturn.id, updates });
    } catch (e: unknown) {
      await alert(e instanceof Error ? e.message : 'Failed to update return status', {
        severity: 'error',
      });
    }
  };

  return (
    <Box>
      <Breadcrumbs
        items={[
          { label: 'Purchase returns', path: '/purchase-returns' },
          { label: purchaseReturn.returnNumber },
        ]}
      />
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} gap={2}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <Typography variant="h5">Purchase Return {purchaseReturn.returnNumber}</Typography>
          <Chip
            size="small"
            label={statusLabel}
            color={
              statusLabel === 'Pending'
                ? 'warning'
                : statusLabel === 'Partial'
                  ? 'info'
                  : statusLabel === 'Not returned'
                    ? 'error'
                    : 'success'
            }
          />
        </Box>
        <Box display="flex" gap={1}>
          <Button startIcon={<FileDownload />} onClick={handleExport}>
            Export items
          </Button>
          <Button startIcon={<ArrowBack />} onClick={() => navigate('/purchase-returns')}>
            Back
          </Button>
        </Box>
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
            {!legacy && pendingIndexes.length > 0 && canEdit ? (
              <Button
                fullWidth
                variant="contained"
                sx={{ mt: 2 }}
                disabled={updateOutcomes.isPending}
                onClick={() =>
                  void applyOutcomes(
                    pendingIndexes.map((index) => ({ index, outcome: 'returned' })),
                    `Mark ${pendingIndexes.length} pending item(s) as returned? Stock will be deducted.`
                  )
                }
              >
                Mark all pending as returned
              </Button>
            ) : null}
            {legacy ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
                Created before return tracking. Stock was deducted when this return was saved.
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
                Stock is deducted only when an item is marked returned.
              </Typography>
            )}
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
                    <TableCell>Status</TableCell>
                    {!legacy && canEdit ? <TableCell align="right">Track</TableCell> : null}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {purchaseReturn.items.map((item, index) => {
                    const outcome = itemReturnOutcome(item, purchaseReturn);
                    return (
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
                        <TableCell>
                          <Chip
                            size="small"
                            label={purchaseReturnOutcomeLabel(outcome)}
                            color={outcomeChipColor(outcome)}
                          />
                        </TableCell>
                        {!legacy && canEdit ? (
                          <TableCell align="right">
                            {outcome === 'returned' ? (
                              <Typography variant="caption" color="text.secondary">
                                Stock updated
                              </Typography>
                            ) : (
                              <Box display="flex" gap={0.5} justifyContent="flex-end">
                                <Button
                                  size="small"
                                  variant="contained"
                                  disabled={updateOutcomes.isPending}
                                  onClick={() =>
                                    void applyOutcomes(
                                      [{ index, outcome: 'returned' }],
                                      `Mark ${item.medicineName} (${item.batchNumber}) as returned? Stock will be deducted.`
                                    )
                                  }
                                >
                                  Returned
                                </Button>
                                {outcome === 'pending' ? (
                                  <Button
                                    size="small"
                                    color="inherit"
                                    disabled={updateOutcomes.isPending}
                                    onClick={() =>
                                      void applyOutcomes(
                                        [{ index, outcome: 'not_returned' }],
                                        `Mark ${item.medicineName} (${item.batchNumber}) as not returned? Stock stays in inventory.`
                                      )
                                    }
                                  >
                                    Not returned
                                  </Button>
                                ) : null}
                              </Box>
                            )}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
