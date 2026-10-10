import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Card,
  CardContent,
  Link,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  ArrowBack,
  Print,
  Search,
  Delete,
  QrCode,
  Edit,
} from '@mui/icons-material';
import { usePurchaseInvoice, useUpdatePurchaseInvoiceWithStock, useVendorLastPurchases, useDeletePurchaseInvoice } from '../hooks/usePurchaseInvoices';
import { useVendor } from '../hooks/useVendors';
import { format } from 'date-fns';
import { formatPurchaseSchemeLabel } from '../utils/purchaseSchemeLabel';
import { Loading } from '../components/Loading';
import { RetailerLastSchemeHint } from '../components/RetailerLastSchemeHint';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { generatePurchaseInvoice } from '../utils/invoice';
import {
  purchaseLineAmounts,
  purchaseLineUnitPrice,
  sumPurchaseInvoiceFromItems,
} from '../utils/purchaseInvoiceTotals';
import { PurchaseInvoiceItem } from '../types';
import { useAppDialog } from '../context/AppDialogProvider';
import { useAuth } from '../context/AuthContext';
import { setStockBatchNonReturnable, setStockBatchNrxDrug } from '../services/inventory';
import { purchaseItemStockBatchNumber } from '../utils/purchaseInvoiceBatch';

export const PurchaseInvoiceDetailsPage: React.FC = () => {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { data: invoice, isLoading } = usePurchaseInvoice(invoiceId || '');
  const { data: vendor } = useVendor(invoice?.vendorId || '');
  const updateInvoiceMutation = useUpdatePurchaseInvoiceWithStock();
  const deleteInvoiceMutation = useDeletePurchaseInvoice();
  const { canWrite } = useAuth();
  const canEditPurchases = canWrite('purchases');
  const { lastPurchaseByMedicineId } = useVendorLastPurchases(
    undefined,
    invoice?.id,
    { enabled: true }
  );
  const { alert, confirm, prompt } = useAppDialog();
  const [items, setItems] = useState<PurchaseInvoiceItem[]>([]);
  const [itemDialog, setItemDialog] = useState<{ open: boolean; itemIndex: number | null }>({
    open: false,
    itemIndex: null,
  });
  const [currentItem, setCurrentItem] = useState<{
    medicineName: string;
    batchNumber: string;
    receivedBatchNumber: string;
    quantity: string;
    freeQuantity: string;
    schemePaidQty: string;
    schemeFreeQty: string;
    expiryDate: string;
    mrp: string;
    standardDiscount: string;
    purchasePrice: string;
    gstRate: string;
    discountPercentage: string;
    nonReturnable: boolean;
    nrxDrug: boolean;
  }>({
    medicineName: '',
    batchNumber: '',
    receivedBatchNumber: '',
    quantity: '',
    freeQuantity: '',
    schemePaidQty: '',
    schemeFreeQty: '',
    expiryDate: '',
    mrp: '',
    standardDiscount: '',
    purchasePrice: '',
    gstRate: '',
    discountPercentage: '',
    nonReturnable: false,
    nrxDrug: false,
  });

  useEffect(() => {
    if (invoice?.items) {
      setItems(invoice.items);
    }
  }, [invoice]);

  const toMonthYearInput = (dateValue?: Date | any): string => {
    if (!dateValue) return '';
    const d = dateValue instanceof Date ? dateValue : dateValue?.toDate?.() || new Date(dateValue);
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    return format(d, 'MM/yyyy');
  };

  const parseDateFromMonthYearInput = (value: string): Date | undefined => {
    if (!value) return undefined;
    const [month, year] = value.split('/').map(Number);
    if (!year || !month || month < 1 || month > 12) return undefined;
    return new Date(year, month - 1, 1);
  };

  const parseNumber = (value: string): number => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };

  const calculateTotals = (invoiceItems: PurchaseInvoiceItem[], extraDiscount: unknown = 0) =>
    sumPurchaseInvoiceFromItems(invoiceItems, extraDiscount);

  const handleEditItem = (index: number) => {
    const item = items[index];
    setCurrentItem({
      medicineName: item.medicineName || '',
      batchNumber: item.batchNumber || '',
      receivedBatchNumber: item.receivedBatchNumber || '',
      quantity: String(item.quantity ?? ''),
      freeQuantity: item.freeQuantity !== undefined ? String(item.freeQuantity) : '',
      schemePaidQty: item.schemePaidQty !== undefined ? String(item.schemePaidQty) : '',
      schemeFreeQty: item.schemeFreeQty !== undefined ? String(item.schemeFreeQty) : '',
      expiryDate: toMonthYearInput(item.expiryDate),
      mrp: item.mrp !== undefined ? String(item.mrp) : '',
      standardDiscount: item.standardDiscount !== undefined ? String(item.standardDiscount) : '',
      purchasePrice: String(item.purchasePrice ?? ''),
      gstRate: item.gstRate !== undefined ? String(item.gstRate) : '',
      discountPercentage: item.discountPercentage !== undefined ? String(item.discountPercentage) : '',
      nonReturnable: item.nonReturnable === true,
      nrxDrug: item.nrxDrug === true,
    });
    setItemDialog({ open: true, itemIndex: index });
  };

  const persistItems = async (updatedItems: PurchaseInvoiceItem[]) => {
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    const { subTotal, totalDiscount, totalTax, additionalDiscount, grandTotal } = calculateTotals(
      updatedItems,
      invoice.additionalDiscount
    );
    const result = await updateInvoiceMutation.mutateAsync({
      invoiceId: invoice.id,
      invoiceData: {
        items: updatedItems,
        subTotal,
        taxAmount: totalTax,
        discount: totalDiscount > 0 ? totalDiscount : 0,
        additionalDiscount: additionalDiscount > 0 ? additionalDiscount : 0,
        totalAmount: grandTotal,
      },
    });
    setItems(updatedItems);
    if (result.stockSyncErrors.length > 0) {
      await alert(
        `Item saved. Stock note:\n${result.stockSyncErrors.slice(0, 5).join('\n')}`,
        { severity: 'warning' }
      );
    }
  };

  const handleDeleteItem = async (index: number) => {
    const updatedItems = items.filter((_, i) => i !== index);
    if (updatedItems.length === 0) {
      await alert('Invoice must have at least one item.', { severity: 'warning' });
      return;
    }
    try {
      await persistItems(updatedItems);
    } catch (error: any) {
      await alert(error?.message || 'Failed to delete item', { severity: 'error' });
    }
  };

  const handleDeleteInvoice = async () => {
    if (!invoice) return;
    const ok = await confirm(
      `Delete purchase bill #${invoice.invoiceNumber}? Stock added from this bill will be removed from inventory. Units already sold cannot be fully reverted. This cannot be undone.`,
      { destructive: true }
    );
    if (!ok) return;
    try {
      const result = await deleteInvoiceMutation.mutateAsync(invoice.id);
      if (result.stockSyncErrors.length > 0) {
        await alert(
          `Bill deleted. Some stock could not be fully reverted:\n${result.stockSyncErrors.slice(0, 5).join('\n')}`,
          { severity: 'warning' }
        );
      } else {
        await alert('Purchase bill deleted and stock reverted.', { severity: 'success' });
      }
      navigate('/purchases');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to delete purchase bill';
      await alert(message, { severity: 'error' });
    }
  };

  const handleSaveItem = async () => {
    if (itemDialog.itemIndex === null) return;
    if (!currentItem.batchNumber || !currentItem.quantity || !currentItem.purchasePrice || !currentItem.expiryDate) {
      await alert('Please fill batch, quantity, expiry and purchase price.', { severity: 'warning' });
      return;
    }

    const oldItem = items[itemDialog.itemIndex];
    const quantity = parseNumber(currentItem.quantity);
    const freeQuantity = currentItem.freeQuantity ? parseNumber(currentItem.freeQuantity) : undefined;
    const mrp = currentItem.mrp ? parseNumber(currentItem.mrp) : undefined;
    const standardDiscount = currentItem.standardDiscount ? parseNumber(currentItem.standardDiscount) : undefined;
    const purchasePrice = parseNumber(currentItem.purchasePrice);
    const gstRate = currentItem.gstRate ? parseNumber(currentItem.gstRate) : undefined;
    const discountPercentage = currentItem.discountPercentage
      ? parseNumber(currentItem.discountPercentage)
      : undefined;
    const spRaw = currentItem.schemePaidQty ? Math.floor(parseNumber(currentItem.schemePaidQty)) : NaN;
    const sfRaw = currentItem.schemeFreeQty ? Math.floor(parseNumber(currentItem.schemeFreeQty)) : NaN;
    const schemePaidQty =
      !isNaN(spRaw) && !isNaN(sfRaw) && spRaw > 0 && sfRaw > 0 ? spRaw : undefined;
    const schemeFreeQty = schemePaidQty != null ? sfRaw : undefined;
    const expiryDate = parseDateFromMonthYearInput(currentItem.expiryDate);

    const totalAmount = purchaseLineAmounts({
      purchasePrice,
      quantity,
      discountPercentage,
      gstRate,
    }).total;
    const receivedBatchNumber = String(currentItem.receivedBatchNumber || '').trim();
    const updatedItem: PurchaseInvoiceItem = {
      medicineId: oldItem.medicineId,
      medicineName: currentItem.medicineName || oldItem.medicineName,
      batchNumber: currentItem.batchNumber,
      ...(receivedBatchNumber ? { receivedBatchNumber } : {}),
      quantity,
      purchasePrice,
      unitPrice: purchasePrice,
      totalAmount,
      expiryDate: expiryDate || oldItem.expiryDate,
      ...(oldItem.mfgDate ? { mfgDate: oldItem.mfgDate } : {}),
      ...(freeQuantity !== undefined ? { freeQuantity } : {}),
      ...(schemePaidQty != null && schemeFreeQty != null ? { schemePaidQty, schemeFreeQty } : {}),
      ...(mrp !== undefined ? { mrp } : {}),
      ...(standardDiscount !== undefined ? { standardDiscount } : {}),
      ...(gstRate !== undefined ? { gstRate } : {}),
      ...(discountPercentage !== undefined ? { discountPercentage } : {}),
      ...(oldItem.qrCode ? { qrCode: oldItem.qrCode } : {}),
      ...(currentItem.nonReturnable === true ? { nonReturnable: true } : {}),
      ...(currentItem.nrxDrug === true ? { nrxDrug: true } : {}),
    };

    const updatedItems = [...items];
    updatedItems[itemDialog.itemIndex] = updatedItem;

    try {
      await persistItems(updatedItems);
      const stockBatch = purchaseItemStockBatchNumber(updatedItem);
      if (updatedItem.medicineId && stockBatch) {
        try {
          await setStockBatchNonReturnable(
            updatedItem.medicineId,
            stockBatch,
            updatedItem.nonReturnable === true
          );
          await setStockBatchNrxDrug(
            updatedItem.medicineId,
            stockBatch,
            updatedItem.nrxDrug === true
          );
        } catch (e) {
          console.warn('Failed to sync batch flags to stock', e);
        }
      }
      setItemDialog({ open: false, itemIndex: null });
    } catch (error: any) {
      await alert(error?.message || 'Failed to update item', { severity: 'error' });
    }
  };

  const {
    subTotal: recalculatedSubTotal,
    totalDiscount: recalculatedDiscount,
    totalTax: recalculatedTaxAmount,
    additionalDiscount: recalculatedAdditionalDiscount,
    roundoff,
    grandTotal,
  } =
    useMemo(
      () => calculateTotals(items, invoice?.additionalDiscount),
      [items, invoice?.additionalDiscount]
    );

  if (isLoading) return <Loading message="Loading invoice..." />;
  if (!invoice) return <Typography>Invoice not found</Typography>;

  const displaySubTotal = recalculatedSubTotal > 0 ? recalculatedSubTotal : invoice.subTotal;
  const displayDiscount = recalculatedDiscount > 0 ? recalculatedDiscount : (invoice.discount || 0);
  const displayTaxAmount = recalculatedTaxAmount > 0 ? recalculatedTaxAmount : invoice.taxAmount;
  const displayAdditionalDiscount =
    recalculatedAdditionalDiscount > 0
      ? recalculatedAdditionalDiscount
      : invoice.additionalDiscount || 0;
  const paidAmount = invoice.paidAmount ?? 0;
  const dueAmount = Math.max(0, grandTotal - paidAmount);

  const invoiceDateLabel = format(
    invoice.invoiceDate instanceof Date ? invoice.invoiceDate : new Date(invoice.invoiceDate),
    'dd MMM yyyy'
  );
  const vendorGstin = invoice.vendorGstin || vendor?.gstNumber || '';
  const vendorPhone = vendor?.phoneNumber || '';
  const vendorEmail = vendor?.email || '';
  const vendorAddress = vendor?.address || '';

  return (
    <Box>
      <Box display="flex" alignItems="center" mb={1} gap={1} flexWrap="wrap">
        <IconButton size="small" onClick={() => navigate('/purchases')} aria-label="Back to purchase invoices">
          <ArrowBack fontSize="small" />
        </IconButton>
        <Box>
          <Breadcrumbs
            items={[
              { label: 'Purchase invoices', path: '/purchases' },
              { label: `#${invoice.invoiceNumber}` },
            ]}
            sx={{ mb: 0 }}
          />
          <Typography variant="h6" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            Purchase invoice #{invoice.invoiceNumber}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<Edit fontSize="small" />}
          onClick={() => navigate(`/purchases/${invoice.id}/edit`)}
        >
          Edit
        </Button>
        {canEditPurchases && (
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<Delete fontSize="small" />}
            onClick={() => void handleDeleteInvoice()}
            disabled={deleteInvoiceMutation.isPending}
          >
            {deleteInvoiceMutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        )}
        <Button
          size="small"
          variant="outlined"
          startIcon={<Print fontSize="small" />}
          onClick={() => {
            generatePurchaseInvoice(invoice).catch(async (err) => {
              console.error('Error generating invoice:', err);
              await alert('Failed to generate invoice. Please try again.', { severity: 'error' });
            });
          }}
        >
          Print
        </Button>
      </Box>

      <Card sx={{ mb: 1, p: 1 }}>
        <CardContent sx={{ p: '8px !important', '&:last-child': { pb: '8px' } }}>
          <Box display="flex" alignItems="center" flexWrap="wrap" gap={2}>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mr: 1 }}>
              Vendor information:
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
              <strong>Vendor:</strong> {invoice.vendorName || 'N/A'}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
              <strong>GSTIN:</strong> {vendorGstin || 'N/A'}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
              <strong>Vendor bill:</strong> {invoice.vendorInvoiceNumber || invoice.invoiceNumber}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
              <strong>Date:</strong> {invoiceDateLabel}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
              <strong>Contact:</strong>{' '}
              {vendorPhone ? (
                <Link href={`tel:${vendorPhone}`} underline="hover">
                  {vendorPhone}
                </Link>
              ) : (
                'N/A'
              )}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
              <strong>Email:</strong> {vendorEmail || 'N/A'}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
              <strong>Address:</strong> {vendorAddress || 'N/A'}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
              <strong>Payment:</strong>{' '}
              <Chip
                size="small"
                label={`${invoice.paymentStatus || 'Unpaid'}${invoice.paymentMethod ? ` · ${invoice.paymentMethod}` : ''}`}
                color={
                  invoice.paymentStatus === 'Paid'
                    ? 'success'
                    : invoice.paymentStatus === 'Partial'
                      ? 'warning'
                      : 'error'
                }
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
            </Typography>
          </Box>
        </CardContent>
      </Card>

      <Paper sx={{ p: 1.5, mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          Invoice items
        </Typography>
        <TableContainer>
          <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Medicine</TableCell>
                    <TableCell>Invoice Batch</TableCell>
                    <TableCell>Received Batch</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">Free Qty</TableCell>
                    <TableCell align="center">Scheme</TableCell>
                    <TableCell align="center">NR / NRX</TableCell>
                    <TableCell align="right">Total Qty</TableCell>
                    <TableCell align="right">MRP</TableCell>
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">GST %</TableCell>
                    <TableCell align="right">Disc %</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="center">QR Code</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item, index) => {
                    const mrp = item.mrp || 0;
                    const line = purchaseLineAmounts(item);
                    const purchasePrice = line.unitPrice || purchaseLineUnitPrice(item);
                    const total = line.total;
                    
                    return (
                      <TableRow key={index}>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">{item.medicineName}</Typography>
                          <Typography variant="caption" color="textSecondary">
                            {item.mfgDate && (
                              <>MFG: {format(item.mfgDate instanceof Date ? item.mfgDate : item.mfgDate.toDate(), 'MM/yyyy')} | </>
                            )}
                            Exp: {item.expiryDate ? format(item.expiryDate instanceof Date ? item.expiryDate : item.expiryDate.toDate(), 'MM/yyyy') : 'N/A'}
                          </Typography>
                        </TableCell>
                        <TableCell>{item.batchNumber}</TableCell>
                        <TableCell>
                          {item.receivedBatchNumber?.trim() ? (
                            item.receivedBatchNumber
                          ) : (
                            <Typography variant="caption" color="textSecondary">
                              —
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">{item.quantity}</TableCell>
                        <TableCell align="right">
                          {item.freeQuantity !== undefined && item.freeQuantity !== null && item.freeQuantity > 0 ? item.freeQuantity : '-'}
                        </TableCell>
                        <TableCell align="center">
                          <Box display="flex" alignItems="center" justifyContent="center" gap={0.5}>
                            <Typography variant="body2" component="span">
                              {formatPurchaseSchemeLabel(item.schemePaidQty, item.schemeFreeQty)}
                            </Typography>
                            {item.medicineId ? (
                              <RetailerLastSchemeHint
                                lastScheme={lastPurchaseByMedicineId.get(item.medicineId)}
                                contextLabel="Previous purchase (same item · any vendor)"
                                emptyHint="No prior purchase for this item"
                                subjectLabel="this item"
                              />
                            ) : null}
                          </Box>
                        </TableCell>
                        <TableCell align="center">
                          <Box display="flex" gap={0.5} justifyContent="center" flexWrap="wrap">
                            {item.nonReturnable === true ? (
                              <Chip size="small" label="NR" color="warning" variant="outlined" title="Non-returnable" />
                            ) : null}
                            {item.nrxDrug === true ? (
                              <Chip size="small" label="NRX" color="error" variant="outlined" title="NRX drug" />
                            ) : null}
                            {item.nonReturnable !== true && item.nrxDrug !== true ? (
                              <Typography variant="caption" color="textSecondary">—</Typography>
                            ) : null}
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight="medium">
                            {item.quantity + (item.freeQuantity || 0)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {mrp > 0 ? `₹${mrp.toFixed(2)}` : '-'}
                        </TableCell>
                        <TableCell align="right">₹{purchasePrice.toFixed(2)}</TableCell>
                        <TableCell align="right">
                          {item.gstRate !== undefined ? `${item.gstRate}%` : '5%'}
                        </TableCell>
                        <TableCell align="right">
                          {item.discountPercentage !== undefined ? `${item.discountPercentage}%` : '0%'}
                        </TableCell>
                        <TableCell align="right">₹{total.toFixed(2)}</TableCell>
                        <TableCell align="center">
                          {item.qrCode && item.qrCode.trim() !== '' ? (
                            <IconButton 
                              size="small" 
                              onClick={() => {
                                // Open QR code in popup
                                const newWindow = window.open();
                                if (newWindow) {
                                  newWindow.document.write(`
                                    <html>
                                      <head><title>QR Code - ${item.medicineName}</title></head>
                                      <body style="text-align: center; padding: 20px;">
                                        <h2>${item.medicineName}</h2>
                                        <img src="${item.qrCode}" alt="QR Code" style="max-width: 400px; margin: 20px 0;" />
                                        <br/>
                                        <button onclick="window.print()" style="padding: 10px 20px; font-size: 16px;">Print / Download</button>
                                      </body>
                                    </html>
                                  `);
                                }
                              }}
                              color="primary"
                              title="View QR Code"
                            >
                              <QrCode />
                            </IconButton>
                          ) : (
                            <Typography variant="caption" color="textSecondary">-</Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          <IconButton size="small" onClick={() => handleEditItem(index)}>
                            <Search />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteItem(index)}
                            disabled={updateInvoiceMutation.isPending}
                          >
                            <Delete />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>

            <Box
              display="flex"
              justifyContent="flex-end"
              alignItems="baseline"
              gap={2.5}
              flexWrap="wrap"
              sx={{ mt: 1.5, px: 0.5 }}
            >
              <Typography variant="caption" color="text.secondary">
                Subtotal ₹{displaySubTotal.toFixed(2)}
              </Typography>
              {displayDiscount > 0 && (
                <Typography variant="caption" color="text.secondary">
                  Discount −₹{displayDiscount.toFixed(2)}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                Tax ₹{displayTaxAmount.toFixed(2)}
              </Typography>
              {displayAdditionalDiscount > 0 && (
                <Typography variant="caption" color="text.secondary">
                  Additional discount −₹{displayAdditionalDiscount.toFixed(2)}
                </Typography>
              )}
              {Math.abs(roundoff) > 0.01 && (
                <Typography variant="caption" color="text.secondary">
                  Round off {roundoff > 0 ? '+' : ''}₹{roundoff.toFixed(2)}
                </Typography>
              )}
              <Typography variant="body2" fontWeight={600}>
                Total ₹{grandTotal.toFixed(2)}
              </Typography>
            </Box>

            <Box
              display="flex"
              justifyContent="flex-end"
              alignItems="center"
              gap={1.5}
              flexWrap="wrap"
              sx={{ mt: 1, px: 0.5 }}
            >
              <Typography variant="caption" color="text.secondary">
                Paid ₹{paidAmount.toFixed(2)}
              </Typography>
              <Typography variant="caption" color={dueAmount > 0 ? 'error.main' : 'success.main'} fontWeight={600}>
                Due ₹{dueAmount.toFixed(2)}
              </Typography>
              {invoice.transactionId ? (
                <Typography variant="caption" color="text.secondary">
                  Txn {invoice.transactionId}
                </Typography>
              ) : null}
            </Box>

            {invoice.notes ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, px: 0.5 }}>
                Notes: {invoice.notes}
              </Typography>
            ) : null}
          </Paper>

      <Dialog
        open={itemDialog.open}
        disableEscapeKeyDown
        onClose={(_event, reason) => {
          if (reason === 'backdropClick') return;
          setItemDialog({ open: false, itemIndex: null });
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Edit Item - {currentItem.medicineName || (itemDialog.itemIndex !== null ? items[itemDialog.itemIndex]?.medicineName : '')}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Invoice Batch Number"
                value={currentItem.batchNumber}
                onChange={(e) => setCurrentItem({ ...currentItem, batchNumber: e.target.value })}
                helperText="Batch as printed on the vendor bill"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Received Batch Number"
                value={currentItem.receivedBatchNumber}
                onChange={(e) =>
                  setCurrentItem({ ...currentItem, receivedBatchNumber: e.target.value })
                }
                helperText="Physical batch on packs if different (used for stock)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Quantity"
                type="number"
                required
                value={currentItem.quantity}
                onChange={(e) => setCurrentItem({ ...currentItem, quantity: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Free quantity (this bill)"
                type="number"
                helperText="Extra strips/units free on this invoice (stock)"
                value={currentItem.freeQuantity}
                onChange={(e) => setCurrentItem({ ...currentItem, freeQuantity: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Expiry Date"
                required
                placeholder="MM/YYYY"
                value={currentItem.expiryDate}
                onChange={(e) => setCurrentItem({ ...currentItem, expiryDate: e.target.value })}
                helperText="Format: MM/YYYY (e.g., 12/2025)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="MRP"
                type="number"
                value={currentItem.mrp}
                onChange={(e) => setCurrentItem({ ...currentItem, mrp: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Standard Discount (%)"
                type="number"
                value={currentItem.standardDiscount}
                onChange={(e) => setCurrentItem({ ...currentItem, standardDiscount: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Purchase Price"
                type="number"
                value={currentItem.purchasePrice}
                onChange={(e) => setCurrentItem({ ...currentItem, purchasePrice: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="GST Rate (%)"
                type="number"
                value={currentItem.gstRate}
                onChange={(e) => setCurrentItem({ ...currentItem, gstRate: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Discount Percentage (%)"
                type="number"
                value={currentItem.discountPercentage}
                onChange={(e) => setCurrentItem({ ...currentItem, discountPercentage: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                <Typography variant="caption" color="text.secondary">
                  Previous purchase for this item (scheme, discount, rate)
                </Typography>
                {itemDialog.itemIndex != null && items[itemDialog.itemIndex]?.medicineId ? (
                  <RetailerLastSchemeHint
                    lastScheme={lastPurchaseByMedicineId.get(items[itemDialog.itemIndex].medicineId)}
                    contextLabel="Previous purchase (same item · any vendor)"
                    emptyHint="No prior purchase for this item"
                    subjectLabel="this item"
                  />
                ) : null}
              </Box>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Scheme - pay for (qty)"
                type="number"
                value={currentItem.schemePaidQty}
                onChange={(e) => setCurrentItem({ ...currentItem, schemePaidQty: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Scheme - get free (qty)"
                type="number"
                value={currentItem.schemeFreeQty}
                onChange={(e) => setCurrentItem({ ...currentItem, schemeFreeQty: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={currentItem.nonReturnable === true}
                    onChange={(e) =>
                      setCurrentItem({ ...currentItem, nonReturnable: e.target.checked })
                    }
                  />
                }
                label="Non-returnable (retailer cannot return this batch)"
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={currentItem.nrxDrug === true}
                    onChange={(e) =>
                      setCurrentItem({ ...currentItem, nrxDrug: e.target.checked })
                    }
                  />
                }
                label="NRX drug (Schedule H / restricted)"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemDialog({ open: false, itemIndex: null })}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveItem}
            disabled={updateInvoiceMutation.isPending}
          >
            {updateInvoiceMutation.isPending ? <CircularProgress size={20} /> : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

