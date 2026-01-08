import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  TextField,
  Divider,
  Stepper,
  Step,
  StepLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
} from '@mui/material';
import {
  ArrowBack,
  QrCodeScanner,
  CheckCircle,
  LocalShipping,
  Cancel,
  Print,
  Receipt,
  Edit,
} from '@mui/icons-material';
import { useOrder, useUpdateOrderStatus, useFulfillOrder, useUpdateOrderDispatch, useMarkOrderDelivered, useCancelOrder, useUpdatePaymentStatus } from '../hooks/useOrders';
import { useMedicines, useCreateMedicine } from '../hooks/useInventory';
import { format } from 'date-fns';
import { auth } from '../services/firebase';
import { Loading } from '../components/Loading';
import { QRCodeScanner } from '../components/BarcodeScanner';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { OrderStatus } from '../types';
import { generateOrderInvoice } from '../utils/invoice';

const statusSteps: OrderStatus[] = ['Pending', 'Order Fulfillment', 'In Transit', 'Delivered'];

export const OrderDetailsPage: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { data: order, isLoading } = useOrder(orderId || '');
  const { data: medicines } = useMedicines();
  
  const fulfillOrderMutation = useFulfillOrder();
  const dispatchOrderMutation = useUpdateOrderDispatch();
  const deliverOrderMutation = useMarkOrderDelivered();
  const cancelOrderMutation = useCancelOrder();
  const updatePaymentStatusMutation = useUpdatePaymentStatus();
  
  const [activeStep, setActiveStep] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanningItemIndex, setScanningItemIndex] = useState<number | null>(null);
  const [manualEntryDialog, setManualEntryDialog] = useState<{ open: boolean; itemIndex: number }>({
    open: false,
    itemIndex: -1,
  });
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; action: string; title: string; message: string }>({
    open: false,
    action: '',
    title: '',
    message: ''
  });
  const [selectedBatch, setSelectedBatch] = useState<string>('');
  const [addMedicineDialog, setAddMedicineDialog] = useState(false);
  const [newMedicineData, setNewMedicineData] = useState({
    name: '',
    code: '',
    category: '',
    manufacturer: '',
    mrp: '',
  });
  
  const createMedicineMutation = useCreateMedicine();
  
  const [fulfillmentData, setFulfillmentData] = useState({
    taxPercentage: 5,
    medicines: [] as any[]
  });

  const [cancelReason, setCancelReason] = useState('');
  const [partialPaymentAmount, setPartialPaymentAmount] = useState<string>('');
  const [dispatchInfo, setDispatchInfo] = useState({
    trackingNumber: '',
    courierName: '',
    notes: ''
  });
  const [manualQRCodeInput, setManualQRCodeInput] = useState('');

  useEffect(() => {
    if (order) {
      const stepIndex = statusSteps.indexOf(order.status as OrderStatus);
      setActiveStep(stepIndex >= 0 ? stepIndex : 0);
      
      if (order.medicines && Array.isArray(order.medicines) && order.medicines.length > 0) {
        setFulfillmentData(prev => ({
          ...prev,
          medicines: order.medicines.map(m => ({ 
            ...m, 
            medicineId: m.medicineId, // Ensure medicineId exists
            verified: !!m.batchNumber, // Auto-verify if batch already assigned
            scannedQRCode: '',
            batchExpiryDate: m.expiryDate // Use expiryDate from OrderMedicine
          }))
        }));
      } else {
        // Initialize with empty array if no medicines
        setFulfillmentData(prev => ({
          ...prev,
          medicines: []
        }));
      }
      
      // Initialize partial payment amount if order has partial payment
      if (order.paymentStatus === 'Partial' && order.paidAmount !== undefined) {
        setPartialPaymentAmount(order.paidAmount.toFixed(2));
      } else if (order.paymentStatus !== 'Partial') {
        setPartialPaymentAmount('');
      }
    }
  }, [order]);

  if (isLoading) return <Loading message="Loading order details..." />;
  if (!order) return <Alert severity="error">Order not found</Alert>;

  const handleAction = (action: string) => {
    switch (action) {
      case 'fulfill':
        setConfirmDialog({
          open: true,
          action: 'fulfill',
          title: 'Confirm Fulfillment',
          message: 'Are you sure you want to mark this order as fulfilled? This will generate the tax invoice.'
        });
        break;
      case 'dispatch':
        setConfirmDialog({
          open: true,
          action: 'dispatch',
          title: 'Confirm Dispatch',
          message: 'Are you sure you want to dispatch this order?'
        });
        break;
      case 'deliver':
        setConfirmDialog({
          open: true,
          action: 'deliver',
          title: 'Confirm Delivery',
          message: 'Are you sure you want to mark this order as delivered?'
        });
        break;
      case 'cancel':
        setConfirmDialog({
          open: true,
          action: 'cancel',
          title: 'Cancel Order',
          message: 'Please provide a reason for cancelling this order.'
        });
        break;
    }
  };

  const executeAction = async () => {
    const user = auth.currentUser;
    if (!user) {
      alert('You must be logged in to perform this action');
      return;
    }

    try {
      if (confirmDialog.action === 'fulfill') {
        const subTotal = fulfillmentData.medicines.reduce((sum, m) => sum + (m.price * m.quantity), 0);
        const taxAmount = (subTotal * fulfillmentData.taxPercentage) / 100;
        const totalAmount = subTotal + taxAmount;
        
        await fulfillOrderMutation.mutateAsync({
          orderId: order.id,
          fulfilledBy: user.uid,
          fulfillmentData: {
            medicines: fulfillmentData.medicines,
            subTotal,
            taxPercentage: fulfillmentData.taxPercentage,
            taxAmount,
            totalAmount
          }
        });
        alert('Order fulfilled successfully!');
      } else if (confirmDialog.action === 'dispatch') {
        await dispatchOrderMutation.mutateAsync({
          orderId: order.id,
          dispatchData: {
            status: 'In Transit',
            dispatchDate: new Date(),
            dispatchedBy: user.uid,
            trackingNumber: dispatchInfo.trackingNumber,
            courierName: dispatchInfo.courierName,
            dispatchNotes: dispatchInfo.notes
          }
        });
        alert('Order dispatched successfully!');
      } else if (confirmDialog.action === 'deliver') {
        await deliverOrderMutation.mutateAsync({
          orderId: order.id,
          deliveredBy: user.uid
        });
        alert('Order marked as delivered successfully!');
      } else if (confirmDialog.action === 'cancel') {
        if (!cancelReason.trim()) {
          alert('Please provide a cancellation reason');
          return;
        }
        await cancelOrderMutation.mutateAsync({
          orderId: order.id,
          cancelledBy: user.uid,
          reason: cancelReason
        });
        alert('Order cancelled successfully!');
      }
      setConfirmDialog({ ...confirmDialog, open: false });
    } catch (error: any) {
      console.error('Action failed:', error);
      alert(`Failed to ${confirmDialog.action} order: ${error.message || 'Unknown error'}`);
    }
  };

  const handleScan = (qrCode: string) => {
    if (scanningItemIndex !== null) {
      const item = fulfillmentData.medicines[scanningItemIndex];
      if (!item || !item.medicineId) {
        alert('Invalid item selected');
        setScannerOpen(false);
        setScanningItemIndex(null);
        return;
      }
      const medicine = medicines?.find(m => 
        m.barcode === qrCode || 
        m.code === qrCode ||
        m.id === item.medicineId
      );
      
      if (medicine && medicine.id === item.medicineId) {
        // Try to find batch from QR code
        // QR code format: {medicineCode}-{batchNumber}
        let foundBatch = null;
        if (medicine.stockBatches && medicine.stockBatches.length > 0) {
          // Extract batch number from QR code if format matches
          const batchMatch = qrCode.match(/-(.+)$/);
          if (batchMatch) {
            const batchNumber = batchMatch[1];
            foundBatch = medicine.stockBatches.find(b => b.batchNumber === batchNumber);
          }
          
          // If not found by format, try to match by checking if barcode contains batch number
          if (!foundBatch) {
            foundBatch = medicine.stockBatches.find(b => 
              qrCode.includes(b.batchNumber) || b.batchNumber.includes(qrCode)
            );
          }
          
          // If still not found, use first available batch
          if (!foundBatch && medicine.stockBatches.length > 0) {
            foundBatch = medicine.stockBatches[0];
          }
        }
        
        const newMedicines = [...fulfillmentData.medicines];
        newMedicines[scanningItemIndex].verified = true;
        newMedicines[scanningItemIndex].scannedQRCode = qrCode;
        if (foundBatch) {
          newMedicines[scanningItemIndex].batchNumber = foundBatch.batchNumber;
          newMedicines[scanningItemIndex].batchExpiryDate = foundBatch.expiryDate;
          // Store MRP from batch
          if (foundBatch.mrp && foundBatch.mrp > 0) {
            newMedicines[scanningItemIndex].mrp = foundBatch.mrp;
          } else {
            newMedicines[scanningItemIndex].mrp = undefined;
          }
          // Set price from batch purchasePrice if available, otherwise keep original order price
          if (foundBatch.purchasePrice && foundBatch.purchasePrice > 0) {
            newMedicines[scanningItemIndex].price = foundBatch.purchasePrice;
          } else if (!newMedicines[scanningItemIndex].price || newMedicines[scanningItemIndex].price === 0) {
            // If no batch purchasePrice, use original order price
            newMedicines[scanningItemIndex].price = item.price || 0;
          }
        }
        setFulfillmentData({ ...fulfillmentData, medicines: newMedicines });
      } else {
        alert('QR code does not match this medicine!');
      }
      setScannerOpen(false);
      setScanningItemIndex(null);
    }
  };

  const handleManualEntry = () => {
    if (manualEntryDialog.itemIndex >= 0) {
      const item = fulfillmentData.medicines[manualEntryDialog.itemIndex];
      if (!item || !item.medicineId) {
        alert('Invalid item selected');
        return;
      }
      const medicine = medicines?.find(m => m.id === item.medicineId);
      
      if (medicine) {
        const newMedicines = [...fulfillmentData.medicines];
        const itemIndex = manualEntryDialog.itemIndex;
        
        // If QR code entered, try to find batch from QR code
        if (manualQRCodeInput) {
          // Try to find batch from QR code
          let foundBatch = null;
          if (medicine.stockBatches && medicine.stockBatches.length > 0) {
            const batchMatch = manualQRCodeInput.match(/-(.+)$/);
            if (batchMatch) {
              const batchNumber = batchMatch[1];
              foundBatch = medicine.stockBatches.find(b => b.batchNumber === batchNumber);
            }
            if (!foundBatch) {
              foundBatch = medicine.stockBatches.find(b => 
                manualQRCodeInput.includes(b.batchNumber) || b.batchNumber.includes(manualQRCodeInput)
              );
            }
          }
          
          newMedicines[itemIndex].verified = true;
          newMedicines[itemIndex].scannedQRCode = manualQRCodeInput;
          if (foundBatch) {
            newMedicines[itemIndex].batchNumber = foundBatch.batchNumber;
            newMedicines[itemIndex].batchExpiryDate = foundBatch.expiryDate;
            // Store MRP from batch
            if (foundBatch.mrp && foundBatch.mrp > 0) {
              newMedicines[itemIndex].mrp = foundBatch.mrp;
            } else {
              newMedicines[itemIndex].mrp = undefined;
            }
            // Set price from batch purchasePrice if available, otherwise keep original order price
            if (foundBatch.purchasePrice && foundBatch.purchasePrice > 0) {
              newMedicines[itemIndex].price = foundBatch.purchasePrice;
            } else if (!newMedicines[itemIndex].price || newMedicines[itemIndex].price === 0) {
              // If no batch purchasePrice, use original order price
              newMedicines[itemIndex].price = item.price || 0;
            }
          }
        } else if (selectedBatch && medicine.stockBatches) {
          // Use selected batch
          const batch = medicine.stockBatches.find(b => b.batchNumber === selectedBatch);
          if (batch) {
            newMedicines[itemIndex].verified = true;
            newMedicines[itemIndex].batchNumber = batch.batchNumber;
            newMedicines[itemIndex].batchExpiryDate = batch.expiryDate;
            // Store MRP from batch
            if (batch.mrp && batch.mrp > 0) {
              newMedicines[itemIndex].mrp = batch.mrp;
            } else {
              newMedicines[itemIndex].mrp = undefined;
            }
            // Set price from batch purchasePrice if available, otherwise keep original order price
            if (batch.purchasePrice && batch.purchasePrice > 0) {
              newMedicines[itemIndex].price = batch.purchasePrice;
            } else if (!newMedicines[itemIndex].price || newMedicines[itemIndex].price === 0) {
              // If no batch purchasePrice, use original order price
              newMedicines[itemIndex].price = item.price || 0;
            }
          }
        } else {
          // Mark as verified without batch
          newMedicines[itemIndex].verified = true;
        }
        
        setFulfillmentData({ ...fulfillmentData, medicines: newMedicines });
      }
      
      setManualEntryDialog({ open: false, itemIndex: -1 });
      setManualQRCodeInput('');
      setSelectedBatch('');
    }
  };

  const toggleVerify = (index: number) => {
    if (index < 0 || index >= fulfillmentData.medicines.length) {
      console.error('Invalid index for toggleVerify:', index);
      return;
    }
    const newMedicines = [...fulfillmentData.medicines];
    if (newMedicines[index]) {
      newMedicines[index].verified = !newMedicines[index].verified;
      setFulfillmentData({ ...fulfillmentData, medicines: newMedicines });
    }
  };

  const handleAddMedicineToMaster = async () => {
    if (!newMedicineData.name || !newMedicineData.manufacturer || !newMedicineData.category) {
      alert('Please fill all required fields');
      return;
    }

    try {
      await createMedicineMutation.mutateAsync({
        name: newMedicineData.name,
        code: newMedicineData.code || undefined,
        category: newMedicineData.category,
        manufacturer: newMedicineData.manufacturer,
        stock: 0,
        currentStock: 0,
        price: 0,
        mrp: newMedicineData.mrp ? parseFloat(newMedicineData.mrp) : undefined,
      });
      
      setAddMedicineDialog(false);
      setNewMedicineData({ name: '', code: '', category: '', manufacturer: '', mrp: '' });
      alert('Medicine added to master data successfully!');
    } catch (error: any) {
      alert(error.message || 'Failed to add medicine');
    }
  };

  // Check if all items have batches assigned
  const allBatchesAssigned = fulfillmentData.medicines.length > 0 && 
    fulfillmentData.medicines.every(m => m.batchNumber);
  
  // Calculate subtotal and total from fulfillmentData.medicines to reflect updated prices after batch selection
  // Calculate from items that have batches assigned (incremental update)
  const subTotal = fulfillmentData.medicines.length > 0
    ? fulfillmentData.medicines
        .filter(m => m.batchNumber) // Only include items with batches assigned
        .reduce((sum, m) => sum + ((m.price || 0) * (m.quantity || 0)), 0)
    : 0;
    const taxPercentage = order.taxPercentage || fulfillmentData.taxPercentage || 5;
  const taxAmount = subTotal > 0 ? (subTotal * taxPercentage) / 100 : 0;
  const calculatedTotal = subTotal + taxAmount;
  
  // Calculate round off
  const roundoff = calculatedTotal > 0 ? (Math.round(calculatedTotal) - calculatedTotal) : 0;
  const grandTotal = calculatedTotal > 0 ? Math.round(calculatedTotal) : 0;

  return (
    <Box>
      <Breadcrumbs items={[
        { label: 'Orders', path: '/orders' },
        { label: `Order #${order.id.substring(0, 8)}` }
      ]} />
      <Box display="flex" alignItems="center" mb={3}>
        <IconButton onClick={() => navigate('/orders')} sx={{ mr: 2 }}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h4">Order #{order.id.substring(0, 8)}</Typography>
        <Box sx={{ flexGrow: 1 }} />
        {order.status !== 'Cancelled' && order.status !== 'In Transit' && order.status !== 'Delivered' && (
          <Button
            variant="outlined"
            color="error"
            startIcon={<Cancel />}
            onClick={() => handleAction('cancel')}
            sx={{ mr: 2 }}
          >
            Cancel Order
          </Button>
        )}
        <Button 
          variant="outlined" 
          startIcon={<Print />}
          onClick={() => {
            // Check if all items have batches assigned
            const allBatchesAssigned = fulfillmentData.medicines.length > 0 && 
              fulfillmentData.medicines.every(m => m.batchNumber);
            
            if (!allBatchesAssigned && order.status === 'Pending') {
              alert('Please assign batches to all items before generating invoice');
              return;
            }
            
            // Create order object with updated prices from fulfillmentData
            // Also include batch MFG date if available
            const invoiceOrder = {
              ...order,
              medicines: fulfillmentData.medicines.length > 0 
                ? fulfillmentData.medicines.map(m => {
                    // Find batch MFG date from medicine data
                    let mfgDate = undefined;
                    if (m.batchNumber && medicines) {
                      const medicine = medicines.find(med => med.id === m.medicineId);
                      if (medicine?.stockBatches) {
                        const batch = medicine.stockBatches.find(b => b.batchNumber === m.batchNumber);
                        if (batch?.mfgDate) {
                          mfgDate = batch.mfgDate;
                        }
                      }
                    }
                    return {
                      ...m,
                      batchNumber: m.batchNumber,
                      expiryDate: m.batchExpiryDate || m.expiryDate,
                      mfgDate: mfgDate
                    };
                  })
                : order.medicines,
              subTotal: subTotal,
              taxAmount: taxAmount,
              taxPercentage: taxPercentage,
              totalAmount: grandTotal
            };
            
            try {
              generateOrderInvoice(invoiceOrder).catch(err => {
                console.error('Error generating invoice:', err);
                alert('Failed to generate invoice. Please try again.');
              });
            } catch (error) {
              console.error('Error generating invoice:', error);
              alert('Failed to generate invoice. Please try again.');
            }
          }}
        >
          Print Invoice
        </Button>
      </Box>

      {/* Timeline Stepper */}
      <Paper sx={{ p: 4, mb: 3 }}>
        <Stepper activeStep={activeStep} alternativeLabel>
          {statusSteps.map((label) => (
            <Step key={label}>
              <StepLabel error={order.status === 'Cancelled' && label === order.status}>
                {label}
                {order.timeline?.find(t => t.status === label) && (
                  <Typography variant="caption" display="block">
                    {format(order.timeline.find(t => t.status === label)!.timestamp, 'MMM dd, HH:mm')}
                  </Typography>
                )}
              </StepLabel>
            </Step>
          ))}
        </Stepper>
      </Paper>

      <Grid container spacing={3}>
        {/* Order Items & Fulfillment */}
        <Grid item xs={12} md={9} sx={{ maxWidth: '72%', flexBasis: '72%', flexGrow: 0 }}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Order Items</Typography>
            </Box>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Medicine</TableCell>
                    <TableCell>Batch</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">Free Qty</TableCell>
                    <TableCell align="right">Total Qty</TableCell>
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">MRP</TableCell>
                    <TableCell align="right">GST %</TableCell>
                    <TableCell align="right">Disc %</TableCell>
                    <TableCell align="right">Total</TableCell>
                    {order.status === 'Pending' && <TableCell align="center">Actions</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fulfillmentData.medicines.map((item, index) => {
                    if (!item || !item.medicineId) {
                      return null; // Skip invalid items
                    }
                    return (
                    <TableRow key={item.medicineId || index} sx={{ bgcolor: item.verified ? 'rgba(76, 175, 80, 0.08)' : 'inherit' }}>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">{item.name || 'Unknown'}</Typography>
                        <Typography variant="caption" color="textSecondary">
                          {item.batchExpiryDate && (
                            <>
                              Exp: {format(
                                item.batchExpiryDate instanceof Date 
                                  ? item.batchExpiryDate 
                                  : item.batchExpiryDate.toDate(),
                                'MM/yyyy'
                              )}
                            </>
                          )}
                          {item.scannedQRCode && (
                            <>
                              {item.batchExpiryDate && ' | '}
                              Scanned: {item.scannedQRCode}
                            </>
                          )}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {item.batchNumber || (
                          <Typography variant="caption" color="textSecondary">Not assigned</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">{item.quantity || 0}</TableCell>
                      <TableCell align="right">
                        {item.freeQuantity !== undefined && item.freeQuantity !== null && item.freeQuantity > 0 ? item.freeQuantity : '-'}
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight="medium">
                          {(item.quantity || 0) + (item.freeQuantity || 0)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {item.batchNumber ? (
                          <>₹{(item.price || 0).toFixed(2)}</>
                        ) : (
                          <Typography variant="caption" color="textSecondary">Enter batch</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {item.mrp ? (
                          <>₹{(item.mrp || 0).toFixed(2)}</>
                        ) : (
                          <Typography variant="caption" color="textSecondary">-</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {item.gstRate !== undefined ? `${item.gstRate}%` : '-'}
                      </TableCell>
                      <TableCell align="right">
                        {item.discountPercentage !== undefined ? `${item.discountPercentage}%` : '-'}
                      </TableCell>
                      <TableCell align="right">
                        {item.batchNumber ? (
                          <>₹{((item.price || 0) * (item.quantity || 0)).toFixed(2)}</>
                        ) : (
                          <Typography variant="caption" color="textSecondary">-</Typography>
                        )}
                      </TableCell>
                      {order.status === 'Pending' && (
                        <TableCell align="center">
                          <Box display="flex" gap={0.5} justifyContent="center">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => {
                                setScanningItemIndex(index);
                                setScannerOpen(true);
                              }}
                              title="Scan QR Code"
                            >
                              <QrCodeScanner fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              color="secondary"
                              onClick={() => {
                                const currentItem = fulfillmentData.medicines[index];
                                if (!currentItem || !currentItem.medicineId) {
                                  alert('Invalid item');
                                  return;
                                }
                                const medicine = medicines?.find(m => m.id === currentItem.medicineId);
                                const firstBatch = medicine?.stockBatches?.find(b => b.quantity > 0);
                                setSelectedBatch(firstBatch?.batchNumber || '');
                                setManualEntryDialog({ open: true, itemIndex: index });
                              }}
                              title="Manual Entry"
                            >
                              <Edit fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => toggleVerify(index)}
                              color={item.verified ? 'success' : 'default'}
                              title="Mark Verified"
                            >
                              <CheckCircle fontSize="small" />
                            </IconButton>
                          </Box>
                        </TableCell>
                      )}
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>

            {fulfillmentData.medicines.length > 0 && fulfillmentData.medicines.every(m => m.batchNumber) && (
              <>
                <Divider sx={{ my: 3 }} />

                <Box sx={{ width: '100%', maxWidth: 300, ml: 'auto' }}>
                  <Box display="flex" justifyContent="space-between" mb={1}>
                    <Typography color="textSecondary">Subtotal:</Typography>
                    <Typography>₹{subTotal.toFixed(2)}</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography color="textSecondary">Tax ({taxPercentage}%):</Typography>
                    <Typography>₹{taxAmount.toFixed(2)}</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" mb={1}>
                    <Typography variant="h6">Total:</Typography>
                    <Typography variant="h6">₹{totalAmount.toFixed(2)}</Typography>
                  </Box>
                </Box>
              </>
            )}

            {order.status === 'Pending' && (
              <Box display="flex" justifyContent="flex-end" mt={3}>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<Receipt />}
                  onClick={() => handleAction('fulfill')}
                  disabled={!fulfillmentData.medicines.every(m => m.verified)}
                >
                  Generate Invoice & Fulfill
                </Button>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Invoice Details */}
        <Grid item xs={12} md={3} sx={{ maxWidth: '28%', flexBasis: '28%', flexGrow: 0 }}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>Invoice Details</Typography>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Order ID:</Typography>
              <Typography fontWeight="medium">#{order.id.substring(0, 8)}</Typography>
            </Box>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Date:</Typography>
              <Typography>
                {format(order.orderDate instanceof Date ? order.orderDate : new Date(order.orderDate), 'MMM dd, yyyy')}
              </Typography>
            </Box>
            <Box display="flex" justifyContent="space-between" mb={2}>
              <Typography color="textSecondary">Retailer:</Typography>
              <Typography fontWeight="medium">{order.retailerEmail || order.retailerName || 'N/A'}</Typography>
            </Box>
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Subtotal:</Typography>
              <Typography>₹{subTotal.toFixed(2)}</Typography>
            </Box>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Tax ({taxPercentage}%):</Typography>
              <Typography>₹{taxAmount.toFixed(2)}</Typography>
            </Box>
            {Math.abs(roundoff) > 0.01 && (
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="textSecondary">Round Off:</Typography>
                <Typography>{roundoff > 0 ? '+' : ''}₹{roundoff.toFixed(2)}</Typography>
              </Box>
            )}
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between" mb={2}>
              <Typography variant="h6">Total:</Typography>
              <Typography variant="h6">₹{grandTotal.toFixed(2)}</Typography>
            </Box>
            <Chip
              label={order.paymentStatus || 'Unpaid'}
              color={
                order.paymentStatus === 'Paid' ? 'success' :
                order.paymentStatus === 'Partial' ? 'warning' : 'error'
              }
              sx={{ width: '100%', mb: 2 }}
            />
          </Paper>
        </Grid>

        {/* Timeline History */}
        <Grid item xs={12} md={9} sx={{ maxWidth: '72%', flexBasis: '72%', flexGrow: 0 }}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>Order History</Typography>
            {order.timeline?.map((event, index) => (
              <Box key={index} sx={{ mb: 2, display: 'flex' }}>
                <Box sx={{ minWidth: 120 }}>
                  <Typography variant="caption" color="textSecondary">
                    {format(event.timestamp, 'MMM dd, HH:mm')}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" fontWeight="bold">{event.status}</Typography>
                  {event.note && <Typography variant="caption">{event.note}</Typography>}
                </Box>
              </Box>
            ))}
          </Paper>

          {/* Store Information */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Store Information</Typography>
              <Typography variant="body2" color="textSecondary">Retailer Email:</Typography>
              <Typography variant="body1" gutterBottom>{order.retailerEmail}</Typography>
              
              <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>Delivery Address:</Typography>
              <Typography variant="body1" gutterBottom>{order.deliveryAddress || 'No address provided'}</Typography>
              
              <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>Payment Status:</Typography>
              <FormControl fullWidth sx={{ mt: 1 }}>
                <Select
                  value={order.paymentStatus || 'Unpaid'}
                  onChange={(e) => {
                    const newStatus = e.target.value as 'Paid' | 'Unpaid' | 'Partial';
                    if (newStatus === 'Partial') {
                      // Initialize partial amount - use existing paidAmount if available, otherwise default to 50%
                      const defaultAmount = order.paidAmount !== undefined 
                        ? order.paidAmount 
                        : (order.totalAmount * 0.5);
                      setPartialPaymentAmount(defaultAmount.toFixed(2));
                      
                      // Immediately update payment status to Partial with default amount
                      updatePaymentStatusMutation.mutate({
                        orderId: order.id,
                        paymentStatus: 'Partial',
                        paidAmount: defaultAmount,
                        totalAmount: order.totalAmount,
                      });
                    } else {
                      // Update payment status immediately for Paid/Unpaid
                      updatePaymentStatusMutation.mutate({
                        orderId: order.id,
                        paymentStatus: newStatus,
                        paidAmount: newStatus === 'Paid' ? order.totalAmount : 0,
                        totalAmount: order.totalAmount,
                      });
                      setPartialPaymentAmount('');
                    }
                  }}
                  size="small"
                >
                  <MenuItem value="Unpaid">Unpaid</MenuItem>
                  <MenuItem value="Partial">Partial</MenuItem>
                  <MenuItem value="Paid">Paid</MenuItem>
                </Select>
              </FormControl>
              {order.paymentStatus === 'Partial' && (
                <Box sx={{ mt: 2 }}>
                  <TextField
                    fullWidth
                    label="Partial Payment Amount"
                    type="number"
                    value={partialPaymentAmount}
                    onChange={(e) => {
                      const value = e.target.value;
                      setPartialPaymentAmount(value);
                      const paidAmount = parseFloat(value) || 0;
                      const totalAmount = order.totalAmount || 0;
                      if (paidAmount > 0 && paidAmount <= totalAmount) {
                        updatePaymentStatusMutation.mutate({
                          orderId: order.id,
                          paymentStatus: 'Partial',
                          paidAmount: paidAmount,
                          totalAmount: totalAmount,
                        });
                      }
                    }}
                    InputProps={{ 
                      startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography>,
                      inputProps: { min: 0, max: order.totalAmount || 0, step: 0.01 }
                    }}
                    helperText={`Total Amount: ₹${(order.totalAmount || 0).toFixed(2)} | Due: ₹${((order.totalAmount || 0) - (parseFloat(partialPaymentAmount) || 0)).toFixed(2)}`}
                    size="small"
                  />
                </Box>
              )}
              {(order.paymentStatus === 'Partial' || order.paymentStatus === 'Paid') && order.paidAmount !== undefined && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="textSecondary">
                    Paid: ₹{order.paidAmount.toFixed(2)} | 
                    {order.dueAmount !== undefined && (
                      <> Due: ₹{order.dueAmount.toFixed(2)}</>
                    )}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Shipping Info */}
        <Grid item xs={12} md={4}>

          {order.status === 'Order Fulfillment' && (
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Shipping Details</Typography>
              <TextField
                fullWidth
                label="Courier Name"
                margin="normal"
                size="small"
                value={dispatchInfo.courierName}
                onChange={(e) => setDispatchInfo({ ...dispatchInfo, courierName: e.target.value })}
              />
              <TextField
                fullWidth
                label="Tracking Number"
                margin="normal"
                size="small"
                value={dispatchInfo.trackingNumber}
                onChange={(e) => setDispatchInfo({ ...dispatchInfo, trackingNumber: e.target.value })}
              />
              <TextField
                fullWidth
                label="Notes"
                margin="normal"
                multiline
                rows={2}
                size="small"
                value={dispatchInfo.notes}
                onChange={(e) => setDispatchInfo({ ...dispatchInfo, notes: e.target.value })}
              />
              <Button
                fullWidth
                variant="contained"
                sx={{ mt: 2 }}
                startIcon={<LocalShipping />}
                onClick={() => handleAction('dispatch')}
              >
                Dispatch Order
              </Button>
            </Paper>
          )}

          {order.status === 'In Transit' && (
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Shipping Information</Typography>
              <Typography variant="body2" color="textSecondary">Courier:</Typography>
              <Typography variant="body1" gutterBottom>{order.courierName}</Typography>
              
              <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>Tracking Number:</Typography>
              <Typography variant="body1" gutterBottom>{order.trackingNumber}</Typography>
              
              <Button
                fullWidth
                variant="contained"
                sx={{ mt: 2 }}
                startIcon={<CheckCircle />}
                onClick={() => handleAction('deliver')}
              >
                Mark as Delivered
              </Button>
            </Paper>
          )}

          {order.status === 'Cancelled' && (
            <Alert severity="error" sx={{ mb: 3 }}>
              <Typography variant="subtitle2">Order Cancelled</Typography>
              <Typography variant="body2">Reason: {order.cancelReason}</Typography>
            </Alert>
          )}
        </Grid>
      </Grid>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog({ ...confirmDialog, open: false })}>
        <DialogTitle>{confirmDialog.title}</DialogTitle>
        <DialogContent>
          <Typography>{confirmDialog.message}</Typography>
          {confirmDialog.action === 'cancel' && (
            <TextField
              fullWidth
              label="Cancellation Reason"
              margin="normal"
              multiline
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              required
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}>Cancel</Button>
          <Button
            variant="contained"
            color={confirmDialog.action === 'cancel' ? 'error' : 'primary'}
            onClick={executeAction}
            disabled={
              (confirmDialog.action === 'cancel' && !cancelReason) ||
              fulfillOrderMutation.isPending ||
              dispatchOrderMutation.isPending ||
              deliverOrderMutation.isPending ||
              cancelOrderMutation.isPending
            }
          >
            {confirmDialog.action === 'cancel' ? 'Confirm Cancellation' : 'Proceed'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manual Entry Dialog */}
      <Dialog open={manualEntryDialog.open} onClose={() => {
        setManualEntryDialog({ open: false, itemIndex: -1 });
        setManualQRCodeInput('');
        setSelectedBatch('');
      }} maxWidth="sm" fullWidth>
        <DialogTitle>
          Manual Entry - {fulfillmentData.medicines[manualEntryDialog.itemIndex]?.name}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <TextField
              fullWidth
              label="Enter QR Code/Code (Optional)"
              margin="normal"
              value={manualQRCodeInput}
              onChange={(e) => setManualQRCodeInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && (manualQRCodeInput || selectedBatch)) {
                  handleManualEntry();
                }
              }}
              autoFocus
              helperText="Enter QR code to auto-detect batch, or select batch manually below"
            />
            
            {(() => {
              const item = fulfillmentData.medicines[manualEntryDialog.itemIndex];
              if (!item || !item.medicineId) {
                return (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    Invalid item selected
                  </Alert>
                );
              }
              const medicine = medicines?.find(m => m.id === item.medicineId);
              
              if (!medicine) {
                return (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    Medicine not found in inventory. Please add it to master data first.
                  </Alert>
                );
              }
              
              const allBatches = medicine.stockBatches || [];
              const availableBatches = allBatches.filter(b => 
                b.quantity > 0 && 
                (!b.expiryDate || (b.expiryDate instanceof Date ? b.expiryDate : b.expiryDate.toDate()) > new Date())
              );
              
              if (allBatches.length === 0) {
                return (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    No batches available for this medicine. Please add stock first.
                  </Alert>
                );
              }
              
              return (
                <FormControl fullWidth margin="normal">
                  <InputLabel>Select Batch from Stock</InputLabel>
                  <Select
                    value={selectedBatch}
                    label="Select Batch from Stock"
                    onChange={(e) => setSelectedBatch(e.target.value)}
                    displayEmpty
                  >
                    <MenuItem value="">
                      <em>Select a batch</em>
                    </MenuItem>
                    {allBatches.map((batch) => {
                      const isAvailable = batch.quantity > 0 && 
                        (!batch.expiryDate || (batch.expiryDate instanceof Date ? batch.expiryDate : batch.expiryDate.toDate()) > new Date());
                      return (
                        <MenuItem key={batch.id} value={batch.batchNumber} disabled={!isAvailable}>
                          <Box>
                            <Typography variant="body2" fontWeight="medium">
                              Batch: {batch.batchNumber}
                            </Typography>
                            <Typography variant="caption" color={isAvailable ? "textSecondary" : "error"}>
                              Qty: {batch.quantity} | 
                              Expiry: {batch.expiryDate ? format(
                                batch.expiryDate instanceof Date ? batch.expiryDate : batch.expiryDate.toDate(),
                                'MMM yyyy'
                              ) : 'N/A'}
                              {!isAvailable && ' (Unavailable)'}
                            </Typography>
                          </Box>
                        </MenuItem>
                      );
                    })}
                  </Select>
                  {availableBatches.length === 0 && allBatches.length > 0 && (
                    <Typography variant="caption" color="warning.main" sx={{ mt: 1, display: 'block' }}>
                      All batches are either out of stock or expired. You can still select a batch manually.
                    </Typography>
                  )}
                </FormControl>
              );
            })()}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setManualEntryDialog({ open: false, itemIndex: -1 });
            setManualQRCodeInput('');
            setSelectedBatch('');
          }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleManualEntry}
          >
            {selectedBatch || manualQRCodeInput ? 'Verify & Assign Batch' : 'Verify Without Batch'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Medicine to Master Dialog */}
      <Dialog open={addMedicineDialog} onClose={() => setAddMedicineDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Medicine to Master Data</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Medicine Name"
                required
                value={newMedicineData.name}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Code"
                value={newMedicineData.code}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, code: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Category"
                required
                value={newMedicineData.category}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, category: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Manufacturer"
                required
                value={newMedicineData.manufacturer}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, manufacturer: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="MRP"
                type="number"
                value={newMedicineData.mrp}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, mrp: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddMedicineDialog(false)}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={handleAddMedicineToMaster}
            disabled={createMedicineMutation.isPending}
          >
            Add to Master
          </Button>
        </DialogActions>
      </Dialog>

      <QRCodeScanner
        open={scannerOpen}
        onClose={() => {
          setScannerOpen(false);
          setScanningItemIndex(null);
        }}
        onScan={handleScan}
      />
    </Box>
  );
};
