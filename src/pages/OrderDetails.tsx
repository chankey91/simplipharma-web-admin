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

  // Batch allocation dialog state
  const [batchAllocationDialog, setBatchAllocationDialog] = useState<{
    open: boolean;
    itemIndex: number;
    medicineId: string;
    requiredQuantity: number;
    allocatedQuantity: number;
  }>({
    open: false,
    itemIndex: -1,
    medicineId: '',
    requiredQuantity: 0,
    allocatedQuantity: 0,
  });

  const [batchAllocations, setBatchAllocations] = useState<Array<{
    batchNumber: string;
    quantity: number;
    availableQuantity: number;
    expiryDate?: Date | any;
    mrp?: number;
    purchasePrice?: number;
    gstRate?: number;
    discountPercentage?: number;
  }>>([]);

  const [cancelReason, setCancelReason] = useState('');
  const [partialPaymentAmount, setPartialPaymentAmount] = useState<string>('');
  const [dispatchInfo, setDispatchInfo] = useState({
    trackingNumber: '',
    courierName: '',
    notes: ''
  });
  const [manualQRCodeInput, setManualQRCodeInput] = useState('');

  useEffect(() => {
    if (order && medicines) {
      const stepIndex = statusSteps.indexOf(order.status as OrderStatus);
      setActiveStep(stepIndex >= 0 ? stepIndex : 0);
      
      if (order.medicines && Array.isArray(order.medicines) && order.medicines.length > 0) {
        setFulfillmentData(prev => ({
          ...prev,
          medicines: order.medicines.map(m => {
            // Preserve discountPercentage from batchAllocations or item itself
            let discountPct = m.discountPercentage;
            
            // Get medicine from inventory to fetch batch discountPercentage if needed
            const medicine = medicines.find(med => med.id === m.medicineId);
            
            // Preserve batchAllocations with discountPercentage from each allocation
            let batchAllocations = m.batchAllocations;
            if (batchAllocations && batchAllocations.length > 0) {
              // Ensure each allocation has discountPercentage from inventory batch if missing
              batchAllocations = batchAllocations.map(allocation => {
                // If allocation doesn't have discountPercentage, fetch it from inventory batch
                if (allocation.discountPercentage === undefined || allocation.discountPercentage === null) {
                  if (medicine && medicine.stockBatches) {
                    const batch = medicine.stockBatches.find(b => b.batchNumber === allocation.batchNumber);
                    if (batch && batch.discountPercentage !== undefined && batch.discountPercentage !== null) {
                      const batchDiscount = typeof batch.discountPercentage === 'number'
                        ? batch.discountPercentage
                        : parseFloat(String(batch.discountPercentage));
                      if (!isNaN(batchDiscount)) {
                        console.log(`[OrderDetails useEffect] Fetched discountPercentage ${batchDiscount}% from inventory for batch ${allocation.batchNumber}`);
                        return {
                          ...allocation,
                          discountPercentage: batchDiscount
                        };
                      }
                    }
                  }
                  // Fallback to item discountPercentage if batch doesn't have it
                  if (m.discountPercentage !== undefined && m.discountPercentage !== null) {
                    return {
                      ...allocation,
                      discountPercentage: typeof m.discountPercentage === 'number'
                        ? m.discountPercentage
                        : parseFloat(String(m.discountPercentage))
                    };
                  }
                }
                return allocation;
              });
              
              // Use discountPercentage from first batch allocation if available
              discountPct = batchAllocations[0]?.discountPercentage !== undefined
                ? batchAllocations[0].discountPercentage
                : m.discountPercentage;
            }
            
            return {
              ...m,
              medicineId: m.medicineId, // Ensure medicineId exists
              verified: !!m.batchNumber || !!(m.batchAllocations && m.batchAllocations.length > 0), // Auto-verify if batch already assigned
              scannedQRCode: '',
              batchExpiryDate: m.batchAllocations && m.batchAllocations.length > 0 
                ? m.batchAllocations[0].expiryDate 
                : m.expiryDate, // Use expiryDate from first batch allocation or OrderMedicine
              discountPercentage: discountPct, // Explicitly preserve discountPercentage
              batchAllocations: batchAllocations, // Preserve updated batchAllocations with discountPercentage
            };
          })
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
  }, [order, medicines]);

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
        // Calculate subtotal from items with batches assigned
        // Price is calculated from MRP: (MRP * 0.80) / (1 + GST/100)
        // Total Amount = Price * Quantity
        // Discount = Total Amount * discountPercentage / 100
        // Subtotal = Sum of (Total Amount - Discount)
        const itemsWithBatches = fulfillmentData.medicines.filter(
          m => m.batchNumber || (m.batchAllocations && m.batchAllocations.length > 0)
        );
        
        // Calculate subtotal: sum of all "Total" column values (Price * Quantity)
        const subTotal = itemsWithBatches.reduce((sum: number, item: any) => {
          // If item has batchAllocations, calculate from individual batch prices
          if (item.batchAllocations && item.batchAllocations.length > 0) {
            const itemTotal = item.batchAllocations.reduce((batchSum: number, allocation: any) => {
              // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
              const mrp = allocation.mrp || 0;
              const gstRate = allocation.gstRate || item.gstRate || 5;
              let purchasePrice = 0;
              if (mrp > 0) {
                const afterDiscount = mrp * 0.80; // Apply 20% discount
                purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
              } else {
                purchasePrice = allocation.purchasePrice || 0;
              }
              const qty = allocation.quantity || 0;
              return batchSum + (purchasePrice * qty); // Price * Quantity (matches "Total" column)
            }, 0);
            return sum + itemTotal;
          }
          // Otherwise use single batch price
          // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
          const mrp = item.mrp || 0;
          const gstRate = item.gstRate || 5;
          let purchasePrice = 0;
          if (mrp > 0) {
            const afterDiscount = mrp * 0.80; // Apply 20% discount
            purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
          } else {
            purchasePrice = item.price || 0;
          }
          const qty = item.quantity || 0;
          return sum + (purchasePrice * qty); // Price * Quantity (matches "Total" column)
        }, 0);
        
        // Calculate discount: sum of (Price * Quantity * discountPercentage / 100) for all items
        const totalDiscount = itemsWithBatches.reduce((sum: number, item: any) => {
          if (item.batchAllocations && item.batchAllocations.length > 0) {
            const itemDiscount = item.batchAllocations.reduce((batchSum: number, allocation: any) => {
              // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
              const mrp = allocation.mrp || 0;
              const gstRate = allocation.gstRate || item.gstRate || 5;
              let purchasePrice = 0;
              if (mrp > 0) {
                const afterDiscount = mrp * 0.80; // Apply 20% discount
                purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
              } else {
                purchasePrice = allocation.purchasePrice || 0;
              }
              const qty = allocation.quantity || 0;
              const totalAmount = purchasePrice * qty;
              const discountPct = allocation.discountPercentage !== undefined 
                ? allocation.discountPercentage 
                : (item.discountPercentage !== undefined ? item.discountPercentage : 0);
              const discount = (totalAmount * discountPct) / 100;
              return batchSum + discount;
            }, 0);
            return sum + itemDiscount;
          } else {
            // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
            const mrp = item.mrp || 0;
            const gstRate = item.gstRate || 5;
            let purchasePrice = 0;
            if (mrp > 0) {
              const afterDiscount = mrp * 0.80; // Apply 20% discount
              purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
            } else {
              purchasePrice = item.price || 0;
            }
            const qty = item.quantity || 0;
            const totalAmount = purchasePrice * qty;
            const discountPct = item.discountPercentage !== undefined ? item.discountPercentage : 0;
            const discount = (totalAmount * discountPct) / 100;
            return sum + discount;
          }
        }, 0);
        
        // Calculate tax amount on (Subtotal - Discount)
        const taxPercentage = order.taxPercentage || fulfillmentData.taxPercentage || 5;
        const amountAfterDiscount = subTotal - totalDiscount;
        const taxAmount = (amountAfterDiscount * taxPercentage) / 100;
        
        const calculatedTotal = subTotal - totalDiscount + taxAmount;
        const roundoff = Math.round(calculatedTotal) - calculatedTotal;
        const totalAmount = Math.round(calculatedTotal);
        
        // Debug: Log medicines before sending to ensure discountPercentage is present
        console.log('[OrderDetails] Fulfilling order with medicines:', fulfillmentData.medicines.map(m => ({
          name: m.name,
          batchNumber: m.batchNumber,
          discountPercentage: m.discountPercentage,
          batchAllocations: m.batchAllocations?.map((a: any) => ({
            batchNumber: a.batchNumber,
            discountPercentage: a.discountPercentage
          }))
        })));
        
        await fulfillOrderMutation.mutateAsync({
          orderId: order.id,
          fulfilledBy: user.uid,
          fulfillmentData: {
            medicines: fulfillmentData.medicines,
            subTotal,
            taxPercentage: taxPercentage,
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
          const gstRate = medicine.gstRate || 5;
          let calculatedPrice = 0;
          if (foundBatch.mrp && foundBatch.mrp > 0) {
            newMedicines[scanningItemIndex].mrp = foundBatch.mrp;
            // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
            const afterDiscount = foundBatch.mrp * 0.80; // 20% discount
            calculatedPrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
            newMedicines[scanningItemIndex].price = calculatedPrice;
          } else {
            newMedicines[scanningItemIndex].mrp = undefined;
            // If no MRP, use batch purchasePrice or original order price
            if (foundBatch.purchasePrice && foundBatch.purchasePrice > 0) {
              calculatedPrice = foundBatch.purchasePrice;
              newMedicines[scanningItemIndex].price = calculatedPrice;
            } else if (!newMedicines[scanningItemIndex].price || newMedicines[scanningItemIndex].price === 0) {
              calculatedPrice = item.price || 0;
              newMedicines[scanningItemIndex].price = calculatedPrice;
            } else {
              calculatedPrice = newMedicines[scanningItemIndex].price;
            }
          }
          // Copy discount percentage from batch
          const batchDiscountPercentage = foundBatch.discountPercentage !== undefined && foundBatch.discountPercentage !== null
            ? (typeof foundBatch.discountPercentage === 'number' ? foundBatch.discountPercentage : parseFloat(String(foundBatch.discountPercentage)))
            : undefined;
          
          if (batchDiscountPercentage !== undefined && !isNaN(batchDiscountPercentage)) {
            newMedicines[scanningItemIndex].discountPercentage = batchDiscountPercentage;
          }
          // Create batchAllocations entry to ensure discountPercentage is preserved
          newMedicines[scanningItemIndex].batchAllocations = [{
            batchNumber: foundBatch.batchNumber,
            quantity: item.quantity || 0,
            expiryDate: foundBatch.expiryDate,
            mrp: foundBatch.mrp,
            purchasePrice: calculatedPrice,
            gstRate: gstRate,
            discountPercentage: batchDiscountPercentage !== undefined && !isNaN(batchDiscountPercentage) ? batchDiscountPercentage : undefined,
          }];
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
            const gstRate = medicine.gstRate || 5;
            let calculatedPrice = 0;
            // Store MRP from batch
            if (foundBatch.mrp && foundBatch.mrp > 0) {
              newMedicines[itemIndex].mrp = foundBatch.mrp;
              // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
              const afterDiscount = foundBatch.mrp * 0.80; // 20% discount
              calculatedPrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
              newMedicines[itemIndex].price = calculatedPrice;
            } else {
              newMedicines[itemIndex].mrp = undefined;
              // Set price from batch purchasePrice if available, otherwise keep original order price
              if (foundBatch.purchasePrice && foundBatch.purchasePrice > 0) {
                calculatedPrice = foundBatch.purchasePrice;
                newMedicines[itemIndex].price = calculatedPrice;
              } else if (!newMedicines[itemIndex].price || newMedicines[itemIndex].price === 0) {
                // If no batch purchasePrice, use original order price
                calculatedPrice = item.price || 0;
                newMedicines[itemIndex].price = calculatedPrice;
              } else {
                calculatedPrice = newMedicines[itemIndex].price;
              }
            }
            // Copy discount percentage from batch - handle both number and string types
            const batchDiscountPercentage = foundBatch.discountPercentage !== undefined && foundBatch.discountPercentage !== null
              ? (typeof foundBatch.discountPercentage === 'number' ? foundBatch.discountPercentage : parseFloat(String(foundBatch.discountPercentage)))
              : undefined;
            
            if (batchDiscountPercentage !== undefined && !isNaN(batchDiscountPercentage)) {
              newMedicines[itemIndex].discountPercentage = batchDiscountPercentage;
            }
            // Create batchAllocations entry to ensure discountPercentage is preserved
            newMedicines[itemIndex].batchAllocations = [{
              batchNumber: foundBatch.batchNumber,
              quantity: item.quantity || 0,
              expiryDate: foundBatch.expiryDate,
              mrp: foundBatch.mrp,
              purchasePrice: calculatedPrice,
              gstRate: gstRate,
              discountPercentage: batchDiscountPercentage !== undefined && !isNaN(batchDiscountPercentage) ? batchDiscountPercentage : undefined,
            }];
          }
        } else if (selectedBatch && medicine.stockBatches) {
          // Use selected batch
          const batch = medicine.stockBatches.find(b => b.batchNumber === selectedBatch);
          if (batch) {
            newMedicines[itemIndex].verified = true;
            newMedicines[itemIndex].batchNumber = batch.batchNumber;
            newMedicines[itemIndex].batchExpiryDate = batch.expiryDate;
            const gstRate = medicine.gstRate || 5;
            let calculatedPrice = 0;
            // Store MRP from batch
            if (batch.mrp && batch.mrp > 0) {
              newMedicines[itemIndex].mrp = batch.mrp;
              // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
              const afterDiscount = batch.mrp * 0.80; // 20% discount
              calculatedPrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
              newMedicines[itemIndex].price = calculatedPrice;
            } else {
              newMedicines[itemIndex].mrp = undefined;
              // If no MRP, use batch purchasePrice or original order price
              if (batch.purchasePrice && batch.purchasePrice > 0) {
                calculatedPrice = batch.purchasePrice;
                newMedicines[itemIndex].price = calculatedPrice;
              } else if (!newMedicines[itemIndex].price || newMedicines[itemIndex].price === 0) {
                calculatedPrice = item.price || 0;
                newMedicines[itemIndex].price = calculatedPrice;
              } else {
                calculatedPrice = newMedicines[itemIndex].price;
              }
            }
            // Copy discount percentage from batch - handle both number and string types
            const batchDiscountPercentage = batch.discountPercentage !== undefined && batch.discountPercentage !== null
              ? (typeof batch.discountPercentage === 'number' ? batch.discountPercentage : parseFloat(String(batch.discountPercentage)))
              : undefined;
            
            if (batchDiscountPercentage !== undefined && !isNaN(batchDiscountPercentage)) {
              newMedicines[itemIndex].discountPercentage = batchDiscountPercentage;
            }
            // Create batchAllocations entry to ensure discountPercentage is preserved
            newMedicines[itemIndex].batchAllocations = [{
              batchNumber: batch.batchNumber,
              quantity: item.quantity || 0,
              expiryDate: batch.expiryDate,
              mrp: batch.mrp,
              purchasePrice: calculatedPrice,
              gstRate: gstRate,
              discountPercentage: batchDiscountPercentage !== undefined && !isNaN(batchDiscountPercentage) ? batchDiscountPercentage : undefined,
            }];
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

  // Function to open batch allocation dialog
  const handleAssignBatches = (itemIndex: number) => {
    const item = fulfillmentData.medicines[itemIndex];
    if (!item || !item.medicineId) {
      alert('Invalid item selected');
      return;
    }

    const medicine = medicines?.find(m => m.id === item.medicineId);
    if (!medicine || !medicine.stockBatches || medicine.stockBatches.length === 0) {
      alert('No batches available for this medicine');
      return;
    }

    // Initialize allocations from existing batchAllocations or single batchNumber
    const existingAllocations = item.batchAllocations || [];
    if (existingAllocations.length === 0 && item.batchNumber) {
      // Migrate from old single batch to new structure
      const existingBatch = medicine.stockBatches.find(b => b.batchNumber === item.batchNumber);
      if (existingBatch) {
        // Preserve discountPercentage - prefer from existingBatch, then from item
        const discountPct = existingBatch.discountPercentage !== undefined && existingBatch.discountPercentage !== null
          ? (typeof existingBatch.discountPercentage === 'number' ? existingBatch.discountPercentage : parseFloat(String(existingBatch.discountPercentage)))
          : (item.discountPercentage !== undefined && item.discountPercentage !== null
            ? (typeof item.discountPercentage === 'number' ? item.discountPercentage : parseFloat(String(item.discountPercentage)))
            : undefined);
        
        existingAllocations.push({
          batchNumber: item.batchNumber,
          quantity: item.quantity || 0,
          expiryDate: existingBatch.expiryDate,
          mrp: existingBatch.mrp,
          purchasePrice: existingBatch.purchasePrice,
          gstRate: item.gstRate || medicine.gstRate || 5,
          discountPercentage: discountPct !== undefined && !isNaN(discountPct) ? discountPct : undefined,
        });
      }
    }

    const allocatedQty = existingAllocations.reduce((sum: number, a: any) => sum + (a.quantity || 0), 0);

    // Filter batches: Only show batches with available quantity > 0
    // OR batches that are already allocated (so user can see existing allocations)
    // Batches with 0 quantity and not allocated are not visible
    // Also filter out expired batches (unless already allocated)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const filteredBatches = medicine.stockBatches.filter(batch => {
      const availableQty = batch.quantity || 0;
      const isAlreadyAllocated = existingAllocations.some((a: any) => a.batchNumber === batch.batchNumber && (a.quantity || 0) > 0);
      
      // Check if batch is expired
      const expiryDate = batch.expiryDate instanceof Date ? batch.expiryDate : batch.expiryDate.toDate();
      const expiryDateOnly = new Date(expiryDate);
      expiryDateOnly.setHours(0, 0, 0, 0);
      const isExpired = expiryDateOnly.getTime() < today.getTime();
      
      // Show batch if:
      // 1. It has available quantity AND not expired, OR
      // 2. It's already allocated (so user can see existing allocation even if expired/zero)
      if (isAlreadyAllocated) {
        return true; // Always show already allocated batches
      }
      
      // For non-allocated batches: must have stock and not be expired
      return availableQty > 0 && !isExpired;
    });
    
    // Sort batches by expiry date (ascending - earliest first), then by quantity (descending - higher first)
    filteredBatches.sort((a, b) => {
      const expiryA = a.expiryDate instanceof Date ? a.expiryDate : a.expiryDate.toDate();
      const expiryB = b.expiryDate instanceof Date ? b.expiryDate : b.expiryDate.toDate();
      const expiryDiff = expiryA.getTime() - expiryB.getTime();
      if (expiryDiff !== 0) return expiryDiff;
      // If expiry dates are same, sort by quantity (descending)
      return (b.quantity || 0) - (a.quantity || 0);
    });
    
    // If no batches are available and none are allocated, show alert
    if (filteredBatches.length === 0) {
      alert('No batches with available stock for this medicine');
      return;
    }

    setBatchAllocations(
      filteredBatches.map(batch => {
        const existing = existingAllocations.find((a: any) => a.batchNumber === batch.batchNumber);
        return {
          batchNumber: batch.batchNumber,
          quantity: existing?.quantity || 0,
          availableQuantity: batch.quantity || 0,
          expiryDate: batch.expiryDate,
          mrp: batch.mrp,
          purchasePrice: batch.purchasePrice,
          gstRate: medicine.gstRate,
          discountPercentage: batch.discountPercentage,
        };
      })
    );

    setBatchAllocationDialog({
      open: true,
      itemIndex,
      medicineId: item.medicineId,
      requiredQuantity: item.quantity || 0,
      allocatedQuantity: allocatedQty,
    });
  };

  // Function to save batch allocations
  const handleSaveBatchAllocations = () => {
    const { itemIndex, requiredQuantity } = batchAllocationDialog;
    const item = fulfillmentData.medicines[itemIndex];

    if (!item) {
      alert('Item not found');
      return;
    }

    // Validate total allocated quantity matches required
    const totalAllocated = batchAllocations.reduce((sum: number, a: any) => sum + (a.quantity || 0), 0);
    
    if (totalAllocated !== requiredQuantity) {
      alert(`Total allocated quantity (${totalAllocated}) must equal required quantity (${requiredQuantity})`);
      return;
    }

    // Validate each batch has enough stock
    for (const allocation of batchAllocations) {
      if (allocation.quantity > 0 && allocation.quantity > allocation.availableQuantity) {
        alert(`Batch ${allocation.batchNumber} only has ${allocation.availableQuantity} units available, but ${allocation.quantity} were allocated`);
        return;
      }
    }

    // Filter out allocations with 0 quantity
    const validAllocations = batchAllocations.filter(a => a.quantity > 0);

    if (validAllocations.length === 0) {
      alert('Please allocate at least one batch');
      return;
    }

    // Calculate total value from individual batches (for display purposes only)
    const totalValue = validAllocations.reduce(
      (sum, a) => sum + ((a.purchasePrice || 0) * a.quantity),
      0
    );

    // Get medicine for default GST rate
    const medicine = medicines?.find(m => m.id === item.medicineId);
    const defaultGstRate = medicine?.gstRate || 5;

    // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
    const calculatePriceFromMRP = (mrp: number | undefined, gstRate: number): number => {
      if (!mrp || mrp <= 0) return 0;
      const afterDiscount = mrp * 0.80; // 20% discount
      return afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
    };

    // Update fulfillment data - store individual batch allocations
    // Calculate price from MRP for each allocation
    const newMedicines = [...fulfillmentData.medicines];
    const processedAllocations = validAllocations.map(a => {
      const gstRate = a.gstRate || defaultGstRate;
      const calculatedPrice = calculatePriceFromMRP(a.mrp, gstRate);
      
      // Get the actual batch from medicine to ensure we have the latest discountPercentage
      const actualBatch = medicine?.stockBatches?.find(b => b.batchNumber === a.batchNumber);
      const discountPct = actualBatch?.discountPercentage !== undefined && actualBatch?.discountPercentage !== null
        ? (typeof actualBatch.discountPercentage === 'number' ? actualBatch.discountPercentage : parseFloat(String(actualBatch.discountPercentage)))
        : (a.discountPercentage !== undefined && a.discountPercentage !== null
          ? (typeof a.discountPercentage === 'number' ? a.discountPercentage : parseFloat(String(a.discountPercentage)))
          : undefined);
      
      return {
        batchNumber: a.batchNumber,
        quantity: a.quantity,
        expiryDate: a.expiryDate,
        mrp: a.mrp,
        purchasePrice: calculatedPrice > 0 ? calculatedPrice : (a.purchasePrice || 0), // Use calculated price or fallback
        gstRate: gstRate,
        discountPercentage: discountPct,
      };
    });

    newMedicines[itemIndex] = {
      ...item,
      batchAllocations: processedAllocations,
      // Keep batchNumber for backward compatibility (use first allocation)
      batchNumber: validAllocations[0].batchNumber,
      batchExpiryDate: validAllocations[0].expiryDate,
      // Only set price/mrp for single batch items - for multiple batches, calculations use batchAllocations
      price: validAllocations.length === 1 ? (processedAllocations[0].purchasePrice || 0) : 0,
      mrp: validAllocations.length === 1 ? validAllocations[0].mrp : undefined,
      gstRate: defaultGstRate,
      discountPercentage: processedAllocations[0]?.discountPercentage !== undefined 
        ? processedAllocations[0].discountPercentage 
        : item.discountPercentage, // Preserve discountPercentage from allocations or existing item
      verified: true,
    };

    setFulfillmentData({ ...fulfillmentData, medicines: newMedicines });
    setBatchAllocationDialog({ ...batchAllocationDialog, open: false });
    setBatchAllocations([]);
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

  // Check if all items have batches assigned (either batchNumber or batchAllocations)
  const allBatchesAssigned = fulfillmentData.medicines.length > 0 && 
    fulfillmentData.medicines.every(m => m.batchNumber || (m.batchAllocations && m.batchAllocations.length > 0));
  
  // Calculate subtotal and total from fulfillmentData.medicines to reflect updated prices after batch selection
  // Price is calculated from MRP: (MRP * 0.80) / (1 + GST/100)
  // Total Amount = Price * Quantity (this is what's shown in the "Total" column)
  // Subtotal = Sum of all "Total" column values (Price * Quantity)
  const itemsWithBatches = fulfillmentData.medicines.filter(m => m.batchNumber || (m.batchAllocations && m.batchAllocations.length > 0));
  
  // Calculate subtotal: sum of all "Total" column values (Price * Quantity)
  const subTotal = itemsWithBatches.reduce((sum: number, item: any) => {
    // If item has batchAllocations, calculate from individual batch prices
    if (item.batchAllocations && item.batchAllocations.length > 0) {
      const itemTotal = item.batchAllocations.reduce((batchSum: number, allocation: any) => {
        // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
        const mrp = allocation.mrp || 0;
        const gstRate = allocation.gstRate || item.gstRate || 5;
        let purchasePrice = 0;
        if (mrp > 0) {
          const afterDiscount = mrp * 0.80; // Apply 20% discount
          purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
        } else {
          purchasePrice = allocation.purchasePrice || 0;
        }
        const qty = allocation.quantity || 0;
        return batchSum + (purchasePrice * qty); // Price * Quantity (matches "Total" column)
      }, 0);
      return sum + itemTotal;
    }
    // Otherwise use single batch price
    // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
    const mrp = item.mrp || 0;
    const gstRate = item.gstRate || 5;
    let purchasePrice = 0;
    if (mrp > 0) {
      const afterDiscount = mrp * 0.80; // Apply 20% discount
      purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
    } else {
      purchasePrice = item.price || 0;
    }
    const qty = item.quantity || 0;
    return sum + (purchasePrice * qty); // Price * Quantity (matches "Total" column)
  }, 0);
  
  // Calculate discount: sum of (Price * Quantity * discountPercentage / 100) for all items
  const totalDiscount = itemsWithBatches.reduce((sum: number, item: any) => {
    if (item.batchAllocations && item.batchAllocations.length > 0) {
      const itemDiscount = item.batchAllocations.reduce((batchSum: number, allocation: any) => {
        // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
        const mrp = allocation.mrp || 0;
        const gstRate = allocation.gstRate || item.gstRate || 5;
        let purchasePrice = 0;
        if (mrp > 0) {
          const afterDiscount = mrp * 0.80; // Apply 20% discount
          purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
        } else {
          purchasePrice = allocation.purchasePrice || 0;
        }
        const qty = allocation.quantity || 0;
        const totalAmount = purchasePrice * qty;
        const discountPct = allocation.discountPercentage !== undefined 
          ? allocation.discountPercentage 
          : (item.discountPercentage !== undefined ? item.discountPercentage : 0);
        const discount = (totalAmount * discountPct) / 100;
        return batchSum + discount;
      }, 0);
      return sum + itemDiscount;
    } else {
      // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
      const mrp = item.mrp || 0;
      const gstRate = item.gstRate || 5;
      let purchasePrice = 0;
      if (mrp > 0) {
        const afterDiscount = mrp * 0.80; // Apply 20% discount
        purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
      } else {
        purchasePrice = item.price || 0;
      }
      const qty = item.quantity || 0;
      const totalAmount = purchasePrice * qty;
      const discountPct = item.discountPercentage !== undefined ? item.discountPercentage : 0;
      const discount = (totalAmount * discountPct) / 100;
      return sum + discount;
    }
  }, 0);
  
  // Calculate tax amount per item (using each item's GST rate) on (Total Amount - Discount) and sum them up
  const taxAmount = itemsWithBatches.reduce((sum: number, item: any) => {
    let itemTax = 0;
    if (item.batchAllocations && item.batchAllocations.length > 0) {
      itemTax = item.batchAllocations.reduce((batchSum: number, allocation: any) => {
        const purchasePrice = allocation.purchasePrice || 0; // Price already calculated from MRP
        const qty = allocation.quantity || 0;
        const totalAmount = purchasePrice * qty;
        const discountPct = allocation.discountPercentage !== undefined 
          ? allocation.discountPercentage 
          : (item.discountPercentage !== undefined ? item.discountPercentage : 0);
        const discount = (totalAmount * discountPct) / 100;
        const amountAfterDiscount = totalAmount - discount;
        const gstRate = allocation.gstRate || item.gstRate || (order.taxPercentage || 5);
        const itemGST = (amountAfterDiscount * gstRate) / 100;
        return batchSum + itemGST;
      }, 0);
    } else {
      const purchasePrice = item.price || 0; // Price already calculated from MRP
      const qty = item.quantity || 0;
      const totalAmount = purchasePrice * qty;
      const discountPct = item.discountPercentage !== undefined ? item.discountPercentage : 0;
      const discount = (totalAmount * discountPct) / 100;
      const amountAfterDiscount = totalAmount - discount;
      const gstRate = item.gstRate || (order.taxPercentage || fulfillmentData.taxPercentage || 5);
      itemTax = (amountAfterDiscount * gstRate) / 100;
    }
    return sum + itemTax;
  }, 0);
  
  const taxPercentage = order.taxPercentage || fulfillmentData.taxPercentage || 5;
  // Calculate total: Subtotal - Discount + Tax
  const amountAfterDiscount = subTotal - totalDiscount;
  const calculatedTotal = amountAfterDiscount + taxAmount;
  
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
            // Check if all items have batches assigned (either batchNumber or batchAllocations)
            const allBatchesAssigned = fulfillmentData.medicines.length > 0 && 
              fulfillmentData.medicines.every(m => m.batchNumber || (m.batchAllocations && m.batchAllocations.length > 0));
            
            if (!allBatchesAssigned && order.status === 'Pending') {
              alert('Please assign batches to all items before generating invoice');
              return;
            }
            
            // Create order object with updated prices from fulfillmentData
            // Also include batch MFG date if available
            const invoiceOrder = {
              ...order,
              medicines: fulfillmentData.medicines.length > 0 
                ? fulfillmentData.medicines
                    .filter(m => m.batchNumber || (m.batchAllocations && m.batchAllocations.length > 0))
                    .map(m => {
                      // Handle batchAllocations - for invoice, use first batch or single batchNumber
                      let batchNumber = m.batchNumber;
                      let expiryDate = m.batchExpiryDate || m.expiryDate;
                      let mfgDate = undefined;
                      
                      if (m.batchAllocations && m.batchAllocations.length > 0) {
                        // Use first batch for invoice display (backward compatibility)
                        batchNumber = m.batchAllocations[0].batchNumber;
                        expiryDate = m.batchAllocations[0].expiryDate || expiryDate;
                      }
                      
                      // Find batch MFG date from medicine data
                      if (batchNumber && medicines) {
                        const medicine = medicines.find(med => med.id === m.medicineId);
                        if (medicine?.stockBatches) {
                          const batch = medicine.stockBatches.find(b => b.batchNumber === batchNumber);
                          if (batch?.mfgDate) {
                            mfgDate = batch.mfgDate;
                          }
                        }
                      }
                      
                      return {
                        ...m,
                        batchNumber: batchNumber, // For backward compatibility with invoice
                        batchAllocations: m.batchAllocations, // Keep batchAllocations for future enhancements
                        expiryDate: expiryDate,
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
        {/* Store Information at the top */}
        <Grid item xs={12}>
          <Card sx={{ mb: 2, p: 1 }}>
            <CardContent sx={{ p: '8px !important', '&:last-child': { pb: '8px' } }}>
              <Box display="flex" alignItems="center" flexWrap="wrap" gap={2}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mr: 1 }}>Store Information:</Typography>
                <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
                  <strong>Email:</strong> {order.retailerEmail}
                </Typography>
                <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
                  <strong>Address:</strong> {order.deliveryAddress || 'No address provided'}
                </Typography>
                <Box display="flex" alignItems="center" gap={1}>
                  <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
                    <strong>Payment:</strong>
                  </Typography>
                  <FormControl size="small" sx={{ minWidth: 100 }}>
                    <Select
                      value={order.paymentStatus || 'Unpaid'}
                      onChange={(e) => {
                        const newStatus = e.target.value as 'Paid' | 'Unpaid' | 'Partial';
                        if (newStatus === 'Partial') {
                          const defaultAmount = order.paidAmount !== undefined 
                            ? order.paidAmount 
                            : (order.totalAmount * 0.5);
                          setPartialPaymentAmount(defaultAmount.toFixed(2));
                          updatePaymentStatusMutation.mutate({
                            orderId: order.id,
                            paymentStatus: 'Partial',
                            paidAmount: defaultAmount,
                            totalAmount: order.totalAmount,
                          });
                        } else {
                          updatePaymentStatusMutation.mutate({
                            orderId: order.id,
                            paymentStatus: newStatus,
                            paidAmount: newStatus === 'Paid' ? order.totalAmount : 0,
                            totalAmount: order.totalAmount,
                          });
                          setPartialPaymentAmount('');
                        }
                      }}
                      sx={{ fontSize: '0.75rem', height: '28px' }}
                    >
                      <MenuItem value="Unpaid" sx={{ fontSize: '0.75rem' }}>Unpaid</MenuItem>
                      <MenuItem value="Partial" sx={{ fontSize: '0.75rem' }}>Partial</MenuItem>
                      <MenuItem value="Paid" sx={{ fontSize: '0.75rem' }}>Paid</MenuItem>
                    </Select>
                  </FormControl>
                  {order.paymentStatus === 'Partial' && (
                    <TextField
                      label="Partial Amount"
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
                        startAdornment: <Typography sx={{ mr: 0.5, fontSize: '0.75rem' }}>₹</Typography>,
                        inputProps: { min: 0, max: order.totalAmount || 0, step: 0.01, style: { fontSize: '0.75rem', padding: '6px' } }
                      }}
                      size="small"
                      sx={{ width: 120 }}
                    />
                  )}
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

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
                    <TableCell align="right">MRP</TableCell>
                    <TableCell align="right">Price</TableCell>
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

                    // If item has multiple batch allocations, show each batch separately
                    if (item.batchAllocations && item.batchAllocations.length > 1) {
                      // Calculate total for all batches: Price * Quantity (simple calculation for display)
                      const totalForAllBatches = item.batchAllocations.reduce((sum: number, allocation: any) => {
                        // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
                        const mrp = allocation.mrp || 0;
                        const gstRate = allocation.gstRate || item.gstRate || 5;
                        let purchasePrice = 0;
                        if (mrp > 0) {
                          const afterDiscount = mrp * 0.80; // Apply 20% discount
                          purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
                        } else {
                          purchasePrice = allocation.purchasePrice || 0;
                        }
                        const qty = allocation.quantity || 0;
                        return sum + (purchasePrice * qty); // Price * Quantity
                      }, 0);
                      const totalQtyForAllBatches = item.batchAllocations.reduce(
                        (sum: number, allocation: any) => sum + (allocation.quantity || 0),
                        0
                      );
                      
                      return (
                        <React.Fragment key={item.medicineId || index}>
                          {/* Medicine Header Row */}
                          <TableRow sx={{ bgcolor: item.verified ? 'rgba(76, 175, 80, 0.12)' : 'rgba(0, 0, 0, 0.04)' }}>
                            <TableCell colSpan={2}>
                              <Typography variant="body2" fontWeight="bold">{item.name || 'Unknown'}</Typography>
                              <Typography variant="caption" color="textSecondary">
                                {item.batchAllocations.length} Batch{item.batchAllocations.length > 1 ? 'es' : ''} allocated
                                {item.scannedQRCode && ` | Scanned: ${item.scannedQRCode}`}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" fontWeight="medium">{item.quantity || 0}</Typography>
                            </TableCell>
                            <TableCell align="right">
                              {item.freeQuantity !== undefined && item.freeQuantity !== null && item.freeQuantity > 0 ? item.freeQuantity : '-'}
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" fontWeight="bold">
                                {totalQtyForAllBatches}
                              </Typography>
                            </TableCell>
                            <TableCell align="right" colSpan={4}>
                              <Typography variant="caption" color="textSecondary">See individual batches below</Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" fontWeight="bold">
                                ₹{totalForAllBatches.toFixed(2)}
                              </Typography>
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
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => handleAssignBatches(index)}
                                    title="Assign Batch(es)"
                                    sx={{ minWidth: 'auto', px: 1, fontSize: '0.75rem' }}
                                  >
                                    Edit
                                  </Button>
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
                          
                          {/* Individual Batch Rows */}
                          {item.batchAllocations.map((allocation: any, batchIdx: number) => {
                            const batchQty = allocation.quantity || 0;
                            const batchMRP = allocation.mrp || 0;
                            const gstRate = allocation.gstRate || item.gstRate || 5;
                            const discountPct = allocation.discountPercentage !== undefined ? allocation.discountPercentage : (item.discountPercentage !== undefined ? item.discountPercentage : 0);
                            
                            // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
                            let batchPurchasePrice = 0;
                            if (batchMRP > 0) {
                              const afterDiscount = batchMRP * 0.80; // Apply 20% discount
                              batchPurchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
                            } else {
                              // Fallback to stored purchasePrice if MRP not available
                              batchPurchasePrice = allocation.purchasePrice || 0;
                            }
                            
                            // Total Amount = Price * Quantity
                            const totalAmount = batchPurchasePrice * batchQty;
                            
                            // Discount = Total Amount * discountPercentage / 100
                            const discount = (totalAmount * discountPct) / 100;
                            
                            // Amount after discount
                            const amountAfterDiscount = totalAmount - discount;
                            
                            // Calculate GST on the amount after discount
                            const itemGST = (amountAfterDiscount * gstRate) / 100;
                            
                            // Total = Price * Quantity (simple calculation for display)
                            const batchTotal = batchPurchasePrice * batchQty;
                            
                            return (
                              <TableRow 
                                key={`${item.medicineId}-batch-${batchIdx}`}
                                sx={{ 
                                  bgcolor: item.verified ? 'rgba(76, 175, 80, 0.06)' : 'inherit',
                                }}
                              >
                                <TableCell>
                                  <Typography variant="caption" color="textSecondary" sx={{ ml: 3, display: 'block' }}>
                                    └─ {allocation.batchNumber}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  <Typography variant="caption" color="textSecondary">
                                    {allocation.expiryDate ? format(
                                      allocation.expiryDate instanceof Date 
                                        ? allocation.expiryDate 
                                        : allocation.expiryDate.toDate(),
                                      'MM/yyyy'
                                    ) : '-'}
                                  </Typography>
                                </TableCell>
                                <TableCell align="right">
                                  <Typography variant="caption">{batchQty}</Typography>
                                </TableCell>
                                <TableCell align="right">-</TableCell>
                                <TableCell align="right">
                                  <Typography variant="caption">{batchQty}</Typography>
                                </TableCell>
                                <TableCell align="right">
                                  <Typography variant="caption">
                                    {allocation.mrp ? `₹${allocation.mrp.toFixed(2)}` : '-'}
                                  </Typography>
                                </TableCell>
                                <TableCell align="right">
                                  <Typography variant="caption" fontWeight="medium">₹{batchPurchasePrice.toFixed(2)}</Typography>
                                </TableCell>
                                <TableCell align="right">
                                  <Typography variant="caption">{gstRate}%</Typography>
                                </TableCell>
                                <TableCell align="right">
                                  <Typography variant="caption">{discountPct}%</Typography>
                                </TableCell>
                                <TableCell align="right">
                                  <Typography variant="body2" fontWeight="medium">
                                    ₹{batchTotal.toFixed(2)}
                                  </Typography>
                                </TableCell>
                                {order.status === 'Pending' && <TableCell />}
                              </TableRow>
                            );
                          })}
                        </React.Fragment>
                      );
                    }
                    
                    // Single batch or no batch allocation - show as normal row
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
                          {item.batchAllocations && item.batchAllocations.length === 1 ? (
                            <>
                              {item.batchAllocations[0].batchNumber}
                              {item.batchAllocations[0].expiryDate && ` - Exp: ${format(
                                item.batchAllocations[0].expiryDate instanceof Date 
                                  ? item.batchAllocations[0].expiryDate 
                                  : item.batchAllocations[0].expiryDate.toDate(),
                                'MM/yyyy'
                              )}`}
                            </>
                          ) : item.batchNumber ? (
                            item.batchNumber
                          ) : (
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
                          {item.batchAllocations && item.batchAllocations.length === 1
                            ? (item.batchAllocations[0].mrp ? `₹${item.batchAllocations[0].mrp.toFixed(2)}` : '-')
                            : item.mrp 
                              ? `₹${(item.mrp || 0).toFixed(2)}`
                              : <Typography variant="caption" color="textSecondary">-</Typography>
                          }
                        </TableCell>
                        <TableCell align="right">
                          {item.batchAllocations && item.batchAllocations.length === 1 
                            ? (() => {
                                // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
                                const mrp = item.batchAllocations[0].mrp || 0;
                                const gstRate = item.batchAllocations[0].gstRate || item.gstRate || 5;
                                let purchasePrice = 0;
                                if (mrp > 0) {
                                  const afterDiscount = mrp * 0.80; // Apply 20% discount
                                  purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
                                } else {
                                  purchasePrice = item.batchAllocations[0].purchasePrice || 0;
                                }
                                return `₹${purchasePrice.toFixed(2)}`;
                              })()
                            : item.batchNumber || (item.batchAllocations && item.batchAllocations.length > 0) 
                              ? (() => {
                                  // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
                                  const mrp = item.mrp || 0;
                                  const gstRate = item.gstRate || 5;
                                  let purchasePrice = 0;
                                  if (mrp > 0) {
                                    const afterDiscount = mrp * 0.80; // Apply 20% discount
                                    purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
                                  } else {
                                    purchasePrice = item.price || 0;
                                  }
                                  return `₹${purchasePrice.toFixed(2)}`;
                                })()
                              : <Typography variant="caption" color="textSecondary">Enter batch</Typography>
                          }
                        </TableCell>
                        <TableCell align="right">
                          {item.batchAllocations && item.batchAllocations.length === 1
                            ? `${item.batchAllocations[0].gstRate || item.gstRate || 5}%`
                            : item.gstRate !== undefined ? `${item.gstRate}%` : '-'
                          }
                        </TableCell>
                        <TableCell align="right">
                          {item.batchAllocations && item.batchAllocations.length === 1
                            ? `${item.batchAllocations[0].discountPercentage !== undefined ? item.batchAllocations[0].discountPercentage : (item.discountPercentage !== undefined ? item.discountPercentage : 0)}%`
                            : item.discountPercentage !== undefined ? `${item.discountPercentage}%` : '-'
                          }
                        </TableCell>
                        <TableCell align="right">
                          {item.batchAllocations && item.batchAllocations.length === 1
                            ? (() => {
                                // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
                                const mrp = item.batchAllocations[0].mrp || 0;
                                const gstRate = item.batchAllocations[0].gstRate || item.gstRate || 5;
                                let purchasePrice = 0;
                                if (mrp > 0) {
                                  const afterDiscount = mrp * 0.80; // Apply 20% discount
                                  purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
                                } else {
                                  purchasePrice = item.batchAllocations[0].purchasePrice || 0;
                                }
                                const qty = item.batchAllocations[0].quantity || 0;
                                const total = purchasePrice * qty; // Price * Quantity
                                return `₹${total.toFixed(2)}`;
                              })()
                            : item.batchNumber || (item.batchAllocations && item.batchAllocations.length > 0) 
                              ? (() => {
                                  // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
                                  const mrp = item.mrp || 0;
                                  const gstRate = item.gstRate || 5;
                                  let purchasePrice = 0;
                                  if (mrp > 0) {
                                    const afterDiscount = mrp * 0.80; // Apply 20% discount
                                    purchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
                                  } else {
                                    purchasePrice = item.price || 0;
                                  }
                                  const qty = item.quantity || 0;
                                  const total = purchasePrice * qty; // Price * Quantity
                                  return `₹${total.toFixed(2)}`;
                                })()
                              : <Typography variant="caption" color="textSecondary">-</Typography>
                          }
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
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => handleAssignBatches(index)}
                                title="Assign Batch(es)"
                                sx={{ minWidth: 'auto', px: 1 }}
                              >
                                {item.batchAllocations && item.batchAllocations.length > 1
                                  ? `${item.batchAllocations.length} Batches`
                                  : 'Assign'
                                }
                              </Button>
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
              <Typography color="textSecondary">Discount:</Typography>
              <Typography>-₹{totalDiscount.toFixed(2)}</Typography>
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

      {/* Batch Allocation Dialog */}
      <Dialog open={batchAllocationDialog.open} onClose={() => setBatchAllocationDialog({ ...batchAllocationDialog, open: false })} maxWidth="md" fullWidth>
        <DialogTitle>
          Assign Batches - {fulfillmentData.medicines[batchAllocationDialog.itemIndex]?.name || 'Medicine'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
              Required Quantity: <strong>{batchAllocationDialog.requiredQuantity}</strong> | 
              Allocated: <strong style={{ color: batchAllocationDialog.allocatedQuantity === batchAllocationDialog.requiredQuantity ? 'green' : 'orange' }}>
                {batchAllocationDialog.allocatedQuantity}
              </strong>
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Batch Number</TableCell>
                    <TableCell>Expiry</TableCell>
                    <TableCell align="right">Available</TableCell>
                    <TableCell align="right">Allocate</TableCell>
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">MRP</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {batchAllocations.map((allocation, idx) => (
                    <TableRow key={allocation.batchNumber}>
                      <TableCell>{allocation.batchNumber}</TableCell>
                      <TableCell>
                        {allocation.expiryDate ? format(
                          allocation.expiryDate instanceof Date 
                            ? allocation.expiryDate 
                            : allocation.expiryDate.toDate(),
                          'MM/yyyy'
                        ) : '-'}
                      </TableCell>
                      <TableCell align="right">
                        <Chip 
                          label={allocation.availableQuantity} 
                          size="small"
                          color={allocation.availableQuantity > 0 ? 'success' : 'error'}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          value={allocation.quantity}
                          onChange={(e) => {
                            const newAllocations = [...batchAllocations];
                            const value = parseInt(e.target.value) || 0;
                            // Limit to available quantity (which will be > 0 since we filtered out 0 quantity batches)
                            newAllocations[idx].quantity = Math.max(0, Math.min(value, allocation.availableQuantity));
                            setBatchAllocations(newAllocations);
                            
                            const total = newAllocations.reduce((sum, a) => sum + a.quantity, 0);
                            setBatchAllocationDialog({
                              ...batchAllocationDialog,
                              allocatedQuantity: total,
                            });
                          }}
                          inputProps={{ 
                            min: 0, 
                            max: allocation.availableQuantity,
                            style: { width: '80px', textAlign: 'right' }
                          }}
                          error={allocation.quantity > allocation.availableQuantity}
                          helperText={allocation.quantity > allocation.availableQuantity ? 'Exceeds available' : ''}
                        />
                      </TableCell>
                      <TableCell align="right">
                        ₹{allocation.purchasePrice?.toFixed(2) || '-'}
                      </TableCell>
                      <TableCell align="right">
                        ₹{allocation.mrp?.toFixed(2) || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {batchAllocationDialog.allocatedQuantity !== batchAllocationDialog.requiredQuantity && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                Total allocated ({batchAllocationDialog.allocatedQuantity}) does not match required ({batchAllocationDialog.requiredQuantity})
              </Alert>
            )}
            {batchAllocationDialog.allocatedQuantity === batchAllocationDialog.requiredQuantity && batchAllocationDialog.allocatedQuantity > 0 && (
              <Alert severity="success" sx={{ mt: 2 }}>
                All quantities allocated successfully!
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setBatchAllocationDialog({ ...batchAllocationDialog, open: false });
            setBatchAllocations([]);
          }}>Cancel</Button>
          <Button 
            onClick={handleSaveBatchAllocations}
            variant="contained"
            disabled={batchAllocationDialog.allocatedQuantity !== batchAllocationDialog.requiredQuantity}
          >
            Save Allocations
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


