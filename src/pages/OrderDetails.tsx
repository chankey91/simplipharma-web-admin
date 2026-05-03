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
  ToggleButtonGroup,
  ToggleButton,
  InputAdornment,
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
  Assignment,
  Payment,
  AttachMoney,
} from '@mui/icons-material';
import { useQueryClient } from '@tanstack/react-query';
import { useOrder, useUpdateOrderStatus, useFulfillOrder, useUpdateOrderDispatch, useMarkOrderDelivered, useCancelOrder, useUpdatePaymentStatus } from '../hooks/useOrders';
import { useMedicines, useCreateMedicine } from '../hooks/useInventory';
import { useTrays, useOperators, useTraysInUse } from '../hooks/useOperations';
import { format } from 'date-fns';
import { auth, doc, updateDoc, db } from '../services/firebase';
import { Loading } from '../components/Loading';
import { QRCodeScanner } from '../components/BarcodeScanner';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { OrderStatus } from '../types';
import { generateOrderInvoice } from '../utils/invoice';
import { normalizeFirestoreDate } from '../services/inventory';
import {
  computeSchemeFulfillmentFreeQty,
  orderedUnitsFromAllocation,
  schemeLinePaidFreeConserved,
  schemeOrderLineDisplayTotals,
} from '../utils/schemeFulfillment';
import { orderLineInvoiceEconomics, orderLineTaxableBeforeDiscount } from '../utils/orderLineInvoiceEconomics';
import { formatPurchaseSchemeLabel } from '../utils/purchaseSchemeLabel';

const statusSteps: OrderStatus[] = ['Pending', 'Order Fulfillment', 'In Transit', 'Delivered'];

const toNumber = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const getSchemeFromAny = (source: any) => ({
  schemePaidQty: toNumber(source?.schemePaidQty ?? source?.purchaseSchemeDeal),
  schemeFreeQty: toNumber(source?.schemeFreeQty ?? source?.purchaseSchemeFree),
});

const getSchemeLabels = (item: any): string[] => {
  if (!item) return [];
  const labels = new Set<string>();

  if (Array.isArray(item.batchAllocations) && item.batchAllocations.length > 0) {
    item.batchAllocations.forEach((allocation: any) => {
      const paid = toNumber(allocation?.schemePaidQty);
      const free = toNumber(allocation?.schemeFreeQty);
      if (paid > 0 && free > 0) {
        labels.add(formatPurchaseSchemeLabel(paid, free));
      }
    });
  }

  return Array.from(labels);
};

export const OrderDetailsPage: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: order, isLoading } = useOrder(orderId || '');
  const { data: medicines } = useMedicines();
  const { data: trays, isError: traysQueryError, error: traysQueryErr } = useTrays();
  const { data: operators, isError: operatorsQueryError, error: operatorsQueryErr } = useOperators();
  const { data: traysInUse = [] } = useTraysInUse(orderId || undefined);
  
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
  const [trayNumberDialog, setTrayNumberDialog] = useState<{ open: boolean; orderId: string | null }>({
    open: false,
    orderId: null
  });
  const [trayNumber, setTrayNumber] = useState('');
  const [processedBy, setProcessedBy] = useState('');
  const [selectedBatch, setSelectedBatch] = useState<string>('');
  
  const currentOrderTray = order?.trayNumber || trayNumber;
  const availableTrays = trays?.filter(
    (t) => !traysInUse.includes(t.name) || t.name === currentOrderTray
  ) ?? [];
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
    schemePaidQty?: number;
    schemeFreeQty?: number;
    allocationFreeQty?: number;
  }>>([]);

  const [cancelReason, setCancelReason] = useState('');
  const [partialPaymentAmount, setPartialPaymentAmount] = useState<string>('');
  const [paymentDialog, setPaymentDialog] = useState<{
    open: boolean;
    amount: string;
    method: 'Cash' | 'Online';
    isFull: boolean;
    transactionId: string;
  }>({ open: false, amount: '', method: 'Cash', isFull: true, transactionId: '' });
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

            const lineSchemeFreeQty = (
              batchNumber: string | undefined,
              lineQty: number
            ): number => {
              if (!batchNumber || !medicine?.stockBatches) return 0;
              const batch = medicine.stockBatches.find(b => b.batchNumber === batchNumber);
              if (!batch) return 0;
              const sch = getSchemeFromAny(batch);
              return computeSchemeFulfillmentFreeQty(
                lineQty,
                sch.schemePaidQty,
                sch.schemeFreeQty
              );
            };
            
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

            const computedFreeQuantity =
              batchAllocations && batchAllocations.length > 0
                ? (() => {
                    const hasPerAllocFree = batchAllocations.some(
                      (a: any) => a.allocationFreeQty !== undefined && a.allocationFreeQty !== null
                    );
                    if (hasPerAllocFree) {
                      return batchAllocations.reduce(
                        (s, allocation) => s + toNumber((allocation as any).allocationFreeQty ?? 0),
                        0
                      );
                    }
                    const totalO = batchAllocations.reduce(
                      (s, allocation) => s + orderedUnitsFromAllocation(allocation as any),
                      0
                    );
                    let schemePaid: number | undefined;
                    let schemeFree: number | undefined;
                    for (const allocation of batchAllocations) {
                      const b = medicine?.stockBatches?.find(
                        (x) => x.batchNumber === allocation.batchNumber
                      );
                      const allocSch = getSchemeFromAny(allocation);
                      const batchSch = getSchemeFromAny(b);
                      const p = allocSch.schemePaidQty || batchSch.schemePaidQty;
                      const f = allocSch.schemeFreeQty || batchSch.schemeFreeQty;
                      if (p > 0 && f > 0) {
                        schemePaid = p;
                        schemeFree = f;
                        break;
                      }
                    }
                    return computeSchemeFulfillmentFreeQty(
                      totalO,
                      schemePaid,
                      schemeFree
                    );
                  })()
                : lineSchemeFreeQty(m.batchNumber, toNumber(m.quantity));
            
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
              freeQuantity:
                m.freeQuantity !== undefined && m.freeQuantity !== null
                  ? toNumber(m.freeQuantity)
                  : computedFreeQuantity,
              // Preserve originalQuantity if it exists, otherwise set it to current quantity (for backward compatibility)
              originalQuantity: m.originalQuantity || m.quantity,
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
      
      // Show tray number dialog for pending orders if tray number and processedBy are not set
      if (order.status === 'Pending' && !order.trayNumber && !order.processedBy) {
        setTrayNumberDialog({ open: true, orderId: order.id });
        setTrayNumber('');
        setProcessedBy('');
      } else if (order.trayNumber || order.processedBy) {
        // If already set, populate the fields
        setTrayNumber(order.trayNumber || '');
        setProcessedBy(order.processedBy || '');
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
        
        // Subtotal / discount: same as order invoice (economic paid qty × invoice unit price)
        const taxPctForLines = order.taxPercentage || fulfillmentData.taxPercentage || 5;
        const subTotal = itemsWithBatches.reduce((sum: number, item: any) => {
          const med = medicines?.find((m) => m.id === item.medicineId);
          return sum + orderLineTaxableBeforeDiscount(item, med, taxPctForLines);
        }, 0);

        const totalDiscount = itemsWithBatches.reduce((sum: number, item: any) => {
          const med = medicines?.find((m) => m.id === item.medicineId);
          const e = orderLineInvoiceEconomics(item, med, taxPctForLines);
          const lineAmt = e.unitPrice * e.paidQty;
          const discount = (lineAmt * e.discountPct) / 100;
          return sum + discount;
        }, 0);
        
        const amountAfterDiscount = subTotal - totalDiscount;
        const taxAmount = (amountAfterDiscount * taxPctForLines) / 100;
        
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
            taxPercentage: taxPctForLines,
            taxAmount,
            totalAmount,
            trayNumber: (trayNumber || order?.trayNumber || '').trim() || undefined,
            processedBy: (processedBy || order?.processedBy || '').trim() || undefined
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

  const handleSaveTrayNumber = async () => {
    if (!trayNumberDialog.orderId) return;
    
    try {
      const orderRef = doc(db, 'orders', trayNumberDialog.orderId);
      const updateData: any = {};
      
      // Only update if values are provided (allow empty strings to clear)
      if (trayNumber.trim()) {
        updateData.trayNumber = trayNumber.trim();
      }
      if (processedBy.trim()) {
        updateData.processedBy = processedBy.trim();
      }
      
      // If both are empty, still save to mark as "acknowledged"
      if (Object.keys(updateData).length > 0) {
        await updateDoc(orderRef, updateData);
        queryClient.invalidateQueries({ queryKey: ['traysInUse'] });
        queryClient.invalidateQueries({ queryKey: ['order', trayNumberDialog.orderId] });
      }
      
      setTrayNumberDialog({ open: false, orderId: null });
      // Keep trayNumber and processedBy in state for use when fulfilling
      
      if (order?.status === 'Pending') {
        alert('Tray number and processor information saved successfully!');
      } else {
        alert('Tray number and processor information saved successfully!');
      }
    } catch (error: any) {
      console.error('Failed to save tray number and processor:', error);
      alert(`Failed to save information: ${error.message || 'Unknown error'}`);
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
          const foundBatchScheme = getSchemeFromAny(foundBatch);
          const lineSplit = schemeLinePaidFreeConserved(
            toNumber(item.quantity),
            foundBatchScheme.schemePaidQty,
            foundBatchScheme.schemeFreeQty
          );
          newMedicines[scanningItemIndex].batchAllocations = [{
            batchNumber: foundBatch.batchNumber,
            quantity: lineSplit.paidQty,
            allocationFreeQty: lineSplit.freeQty,
            expiryDate: foundBatch.expiryDate,
            mrp: foundBatch.mrp,
            purchasePrice: calculatedPrice,
            gstRate: gstRate,
            discountPercentage: batchDiscountPercentage !== undefined && !isNaN(batchDiscountPercentage) ? batchDiscountPercentage : undefined,
            schemePaidQty: toNumber(foundBatch.schemePaidQty) || undefined,
            schemeFreeQty: toNumber(foundBatch.schemeFreeQty) || undefined,
          }];
          newMedicines[scanningItemIndex].freeQuantity = lineSplit.freeQty;
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
            const foundBatchScheme = getSchemeFromAny(foundBatch);
            const lineSplit = schemeLinePaidFreeConserved(
              toNumber(item.quantity),
              foundBatchScheme.schemePaidQty,
              foundBatchScheme.schemeFreeQty
            );
            newMedicines[itemIndex].batchAllocations = [{
              batchNumber: foundBatch.batchNumber,
              quantity: lineSplit.paidQty,
              allocationFreeQty: lineSplit.freeQty,
              expiryDate: foundBatch.expiryDate,
              mrp: foundBatch.mrp,
              purchasePrice: calculatedPrice,
              gstRate: gstRate,
              discountPercentage: batchDiscountPercentage !== undefined && !isNaN(batchDiscountPercentage) ? batchDiscountPercentage : undefined,
              schemePaidQty: toNumber(foundBatch.schemePaidQty) || undefined,
              schemeFreeQty: toNumber(foundBatch.schemeFreeQty) || undefined,
            }];
            newMedicines[itemIndex].freeQuantity = lineSplit.freeQty;
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
            const selectedBatchScheme = getSchemeFromAny(batch);
            const lineSplit = schemeLinePaidFreeConserved(
              toNumber(item.quantity),
              selectedBatchScheme.schemePaidQty,
              selectedBatchScheme.schemeFreeQty
            );
            newMedicines[itemIndex].batchAllocations = [{
              batchNumber: batch.batchNumber,
              quantity: lineSplit.paidQty,
              allocationFreeQty: lineSplit.freeQty,
              expiryDate: batch.expiryDate,
              mrp: batch.mrp,
              purchasePrice: calculatedPrice,
              gstRate: gstRate,
              discountPercentage: batchDiscountPercentage !== undefined && !isNaN(batchDiscountPercentage) ? batchDiscountPercentage : undefined,
              schemePaidQty: toNumber(batch.schemePaidQty) || undefined,
              schemeFreeQty: toNumber(batch.schemeFreeQty) || undefined,
            }];
            newMedicines[itemIndex].freeQuantity = lineSplit.freeQty;
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
    if (!medicine) {
      alert(
        `Medicine not found in master data (ID: ${item.medicineId}). ` +
          'The order may reference a deleted product or mismatched ID. Check Inventory.'
      );
      return;
    }
    if (!medicine.stockBatches || medicine.stockBatches.length === 0) {
      alert(`No stock batches for "${medicine.name}". Add batches in Inventory before fulfilling.`);
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
          schemePaidQty: toNumber(existingBatch.schemePaidQty) || undefined,
          schemeFreeQty: toNumber(existingBatch.schemeFreeQty) || undefined,
        });
      }
    }

    const allocatedQty = existingAllocations.reduce(
      (sum: number, a: any) => sum + orderedUnitsFromAllocation(a),
      0
    );
    
    // Use originalQuantity if it exists (for partial fulfillment), otherwise use current quantity
    const requiredQty = item.originalQuantity || item.quantity || 0;

    // Filter batches: Only show batches with available quantity > 0
    // OR batches that are already allocated (so user can see existing allocations)
    // Batches with 0 quantity and not allocated are not visible
    // Also filter out expired batches (unless already allocated)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const filteredBatches = medicine.stockBatches.filter(batch => {
      const availableQty = Number(batch.quantity) || 0;
      const isAlreadyAllocated = existingAllocations.some((a: any) => a.batchNumber === batch.batchNumber && (a.quantity || 0) > 0);

      const expiryNorm = normalizeFirestoreDate(batch.expiryDate);
      let isExpired = false;
      if (expiryNorm) {
        const expiryDateOnly = new Date(expiryNorm);
        expiryDateOnly.setHours(0, 0, 0, 0);
        isExpired = expiryDateOnly.getTime() < today.getTime();
      }

      if (isAlreadyAllocated) {
        return true;
      }
      return availableQty > 0 && !isExpired;
    });

    filteredBatches.sort((a, b) => {
      const expA = normalizeFirestoreDate(a.expiryDate);
      const expB = normalizeFirestoreDate(b.expiryDate);
      if (!expA && !expB) return (Number(b.quantity) || 0) - (Number(a.quantity) || 0);
      if (!expA) return 1;
      if (!expB) return -1;
      const expiryDiff = expA.getTime() - expB.getTime();
      if (expiryDiff !== 0) return expiryDiff;
      return (Number(b.quantity) || 0) - (Number(a.quantity) || 0);
    });
    
    // If no batches are available and none are allocated, show alert
    if (filteredBatches.length === 0) {
      alert('No batches with available stock for this medicine');
      return;
    }

    setBatchAllocations(
      filteredBatches.map(batch => {
        const existing = existingAllocations.find((a: any) => a.batchNumber === batch.batchNumber);
        const alreadyAllocated = existing ? orderedUnitsFromAllocation(existing) : 0;
        // Available quantity = current batch quantity
        // Note: If order hasn't been fulfilled yet, batch.quantity is the original stock
        // If order has been fulfilled, batch.quantity is already reduced
        const availableQty = batch.quantity || 0;
        return {
          batchNumber: batch.batchNumber,
          quantity: alreadyAllocated,
          availableQuantity: availableQty, // Current available stock in batch
          expiryDate: batch.expiryDate,
          mrp: batch.mrp,
          purchasePrice: batch.purchasePrice,
          gstRate: medicine.gstRate,
          discountPercentage: batch.discountPercentage,
          schemePaidQty: toNumber(batch.schemePaidQty) || undefined,
          schemeFreeQty: toNumber(batch.schemeFreeQty) || undefined,
        };
      })
    );

    setBatchAllocationDialog({
      open: true,
      itemIndex,
      medicineId: item.medicineId,
      requiredQuantity: requiredQty,
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

    // Validate total allocated quantity - allow partial fulfillment (must be > 0 and <= required)
    const totalAllocated = batchAllocations.reduce(
      (sum: number, a: any) => sum + orderedUnitsFromAllocation(a),
      0
    );
    
    if (totalAllocated === 0) {
      alert('Please allocate at least some quantity');
      return;
    }
    
    if (totalAllocated > requiredQuantity) {
      alert(`Total allocated quantity (${totalAllocated}) cannot exceed required quantity (${requiredQuantity})`);
      return;
    }
    
    // Warn if partial fulfillment
    if (totalAllocated < requiredQuantity) {
      const confirmPartial = window.confirm(
        `Warning: Only ${totalAllocated} out of ${requiredQuantity} units will be fulfilled. ` +
        `The remaining ${requiredQuantity - totalAllocated} units will not be fulfilled. Continue?`
      );
      if (!confirmPartial) {
        return;
      }
    }

    // Validate each batch has enough stock
    // Note: If order status is 'Pending', stock hasn't been reduced yet, so availableQuantity is the actual stock
    // If order has been fulfilled, stock is already reduced, so availableQuantity reflects current stock
    for (const allocation of batchAllocations) {
      const phys = orderedUnitsFromAllocation(allocation);
      if (phys > 0 && phys > allocation.availableQuantity) {
        alert(
          `Batch ${allocation.batchNumber} only has ${allocation.availableQuantity} units available, but ${phys} were allocated`
        );
        return;
      }
    }

    // Filter out allocations with 0 physical quantity
    const validAllocations = batchAllocations.filter(
      (a) => orderedUnitsFromAllocation(a) > 0
    );

    if (validAllocations.length === 0) {
      alert('Please allocate at least one batch');
      return;
    }

    // Get medicine for default GST rate
    const medicine = medicines?.find(m => m.id === item.medicineId);
    const defaultGstRate = medicine?.gstRate || 5;

    // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
    const calculatePriceFromMRP = (mrp: number | undefined, gstRate: number): number => {
      if (!mrp || mrp <= 0) return 0;
      const afterDiscount = mrp * 0.80; // 20% discount
      return afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
    };

    const O = totalAllocated;
    let schemePaid: number | undefined;
    let schemeFree: number | undefined;
    for (const a of validAllocations) {
      const actualBatch = medicine?.stockBatches?.find((b) => b.batchNumber === a.batchNumber);
      const s = getSchemeFromAny(actualBatch || a);
      if (s.schemePaidQty > 0 && s.schemeFreeQty > 0) {
        schemePaid = s.schemePaidQty;
        schemeFree = s.schemeFreeQty;
        break;
      }
    }
    const lineSplit = schemeLinePaidFreeConserved(O, schemePaid, schemeFree);

    // Update fulfillment data - store individual batch allocations (quantity = billable paid, allocationFreeQty = scheme free)
    const newMedicines = [...fulfillmentData.medicines];
    const processedAllocations = validAllocations.map((a) => {
      const gstRate = a.gstRate || defaultGstRate;
      const calculatedPrice = calculatePriceFromMRP(a.mrp, gstRate);

      // Get the actual batch from medicine to ensure we have the latest discountPercentage
      const actualBatch = medicine?.stockBatches?.find((b) => b.batchNumber === a.batchNumber);
      const discountPct =
        actualBatch?.discountPercentage !== undefined && actualBatch?.discountPercentage !== null
          ? typeof actualBatch.discountPercentage === 'number'
            ? actualBatch.discountPercentage
            : parseFloat(String(actualBatch.discountPercentage))
          : a.discountPercentage !== undefined && a.discountPercentage !== null
            ? typeof a.discountPercentage === 'number'
              ? a.discountPercentage
              : parseFloat(String(a.discountPercentage))
            : undefined;

      const qi = orderedUnitsFromAllocation(a);
      const free_i = O > 0 ? (qi / O) * lineSplit.freeQty : 0;
      const paid_i = qi - free_i;

      return {
        batchNumber: a.batchNumber,
        quantity: paid_i,
        allocationFreeQty: free_i,
        expiryDate: a.expiryDate,
        mrp: a.mrp,
        purchasePrice: calculatedPrice > 0 ? calculatedPrice : a.purchasePrice || 0,
        gstRate: gstRate,
        discountPercentage: discountPct,
        schemePaidQty:
          getSchemeFromAny(actualBatch).schemePaidQty ||
          getSchemeFromAny(a).schemePaidQty ||
          undefined,
        schemeFreeQty:
          getSchemeFromAny(actualBatch).schemeFreeQty ||
          getSchemeFromAny(a).schemeFreeQty ||
          undefined,
      };
    });

    const totalFreeQuantity = lineSplit.freeQty;

    newMedicines[itemIndex] = {
      ...item,
      batchAllocations: processedAllocations,
      // Store original ordered quantity if this is partial fulfillment
      originalQuantity: totalAllocated < requiredQuantity ? requiredQuantity : item.originalQuantity || item.quantity,
      // Update quantity to fulfilled quantity
      quantity: totalAllocated, // This is the fulfilled quantity
      freeQuantity: totalFreeQuantity,
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
  
  // Subtotal / discount / tax: match order tax invoice (`getOrderInvoiceHTML`)
  const itemsWithBatches = fulfillmentData.medicines.filter(m => m.batchNumber || (m.batchAllocations && m.batchAllocations.length > 0));
  const taxPercentage = order.taxPercentage || fulfillmentData.taxPercentage || 5;

  const subTotal = itemsWithBatches.reduce((sum: number, item: any) => {
    const med = medicines?.find((m) => m.id === item.medicineId);
    return sum + orderLineTaxableBeforeDiscount(item, med, taxPercentage);
  }, 0);

  const totalDiscount = itemsWithBatches.reduce((sum: number, item: any) => {
    const med = medicines?.find((m) => m.id === item.medicineId);
    const e = orderLineInvoiceEconomics(item, med, taxPercentage);
    const lineAmt = e.unitPrice * e.paidQty;
    return sum + (lineAmt * e.discountPct) / 100;
  }, 0);
  const amountAfterDiscount = subTotal - totalDiscount;
  const taxAmount = (amountAfterDiscount * taxPercentage) / 100;
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
                      let freeQuantity = toNumber(m.freeQuantity);
                      
                      if (m.batchAllocations && m.batchAllocations.length > 0) {
                        // Use first batch for invoice display (backward compatibility)
                        batchNumber = m.batchAllocations[0].batchNumber;
                        expiryDate = m.batchAllocations[0].expiryDate || expiryDate;

                        const hasPerAllocFree = m.batchAllocations.some(
                          (a: any) => a.allocationFreeQty !== undefined && a.allocationFreeQty !== null
                        );
                        if (hasPerAllocFree) {
                          freeQuantity = m.batchAllocations.reduce(
                            (s: number, a: any) => s + toNumber(a.allocationFreeQty ?? 0),
                            0
                          );
                        } else {
                          const allocationFree = (() => {
                            const medicine = medicines?.find((med) => med.id === m.medicineId);
                            const totalO = m.batchAllocations.reduce(
                              (s: number, allocation: any) => s + orderedUnitsFromAllocation(allocation),
                              0
                            );
                            let schemePaidQty: number | undefined;
                            let schemeFreeQty: number | undefined;
                            for (const allocation of m.batchAllocations) {
                              const stockBatch = medicine?.stockBatches?.find(
                                (b) => b.batchNumber === allocation.batchNumber
                              );
                              const allocationScheme = getSchemeFromAny(allocation);
                              const stockBatchScheme = getSchemeFromAny(stockBatch);
                              const p = allocationScheme.schemePaidQty || stockBatchScheme.schemePaidQty;
                              const f = allocationScheme.schemeFreeQty || stockBatchScheme.schemeFreeQty;
                              if (p > 0 && f > 0) {
                                schemePaidQty = p;
                                schemeFreeQty = f;
                                break;
                              }
                            }
                            return schemeLinePaidFreeConserved(
                              totalO,
                              schemePaidQty,
                              schemeFreeQty
                            ).freeQty;
                          })();

                          if (allocationFree > 0) {
                            freeQuantity = allocationFree;
                          }
                        }
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
                        freeQuantity,
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
                <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
                  <strong>Payment:</strong>{' '}
                  <Chip
                    size="small"
                    label={`${order.paymentStatus || 'Unpaid'}${order.paymentMethod ? ` · ${order.paymentMethod}` : ''}`}
                    color={
                      order.paymentStatus === 'Paid' ? 'success' :
                      order.paymentStatus === 'Partial' ? 'warning' : 'default'
                    }
                    sx={{ height: 20, fontSize: '0.7rem' }}
                  />
                </Typography>
              </Box>
            </CardContent>
          </Card>

          {(traysQueryError || operatorsQueryError) && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Tray/operator lists failed to load (dropdowns may be empty). Deploy{' '}
              <strong>firestore.rules</strong> with <code>trays</code> and <code>operators</code> rules, or check Firestore
              permissions.
              {traysQueryError && (
                <Typography variant="caption" display="block">
                  Trays: {(traysQueryErr as Error)?.message}
                </Typography>
              )}
              {operatorsQueryError && (
                <Typography variant="caption" display="block">
                  Operators: {(operatorsQueryErr as Error)?.message}
                </Typography>
              )}
            </Alert>
          )}

          {/* Tray & Operator - Display and option to assign/change (for Pending and Order Fulfillment) */}
          {order.status !== 'Cancelled' && order.status !== 'Delivered' && (
            <Card sx={{ mb: 2, p: 1 }}>
              <CardContent sx={{ p: '8px !important', '&:last-child': { pb: '8px' } }}>
                <Box display="flex" alignItems="center" flexWrap="wrap" gap={2}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mr: 1 }}>Order Processing:</Typography>
                  <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
                    <strong>Tray:</strong> {order.trayNumber || trayNumber || 'Not assigned'}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
                    <strong>Processed By:</strong> {order.processedBy || processedBy || 'Not assigned'}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Edit />}
                    onClick={() => {
                      setTrayNumber(order.trayNumber || trayNumber || '');
                      setProcessedBy(order.processedBy || processedBy || '');
                      setTrayNumberDialog({ open: true, orderId: order.id });
                    }}
                    sx={{ ml: 1 }}
                  >
                    {(order.trayNumber || order.processedBy || trayNumber || processedBy) ? 'Change' : 'Assign'}
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )}
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
                      const medForLine = medicines?.find((m) => m.id === item.medicineId);
                      const lineInvoiceAmt = orderLineTaxableBeforeDiscount(
                        item,
                        medForLine,
                        taxPercentage
                      );
                      const econLine = orderLineInvoiceEconomics(item, medForLine, taxPercentage);
                      const sumAllocQtyForLine = item.batchAllocations.reduce(
                        (s: number, a: any) => s + toNumber(a.quantity),
                        0
                      );
                      const invoiceAmtDen =
                        econLine.paidQty > 0 ? econLine.paidQty : sumAllocQtyForLine > 0 ? sumAllocQtyForLine : 1;
                      const physicalSum = item.batchAllocations.reduce(
                        (sum: number, allocation: any) => sum + orderedUnitsFromAllocation(allocation),
                        0
                      );
                      let schemePLine: number | undefined;
                      let schemeFLine: number | undefined;
                      for (const allocation of item.batchAllocations) {
                        const b = medForLine?.stockBatches?.find(
                          (x: any) => x.batchNumber === allocation.batchNumber
                        );
                        const s = getSchemeFromAny(b || allocation);
                        if (s.schemePaidQty > 0 && s.schemeFreeQty > 0) {
                          schemePLine = s.schemePaidQty;
                          schemeFLine = s.schemeFreeQty;
                          break;
                        }
                      }
                      const lineDisplay = schemeOrderLineDisplayTotals(
                        physicalSum,
                        schemePLine,
                        schemeFLine
                      );
                      const paidQtyForLine = lineDisplay.billQty;
                      const physicalQtyForLine = lineDisplay.totalQty;
                      const schemeLabels = getSchemeLabels(item);
                      
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
                              <Typography variant="body2" fontWeight="medium">{paidQtyForLine}</Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Box>
                                <Typography variant="body2">
                                  {lineDisplay.freeQty > 0 ? lineDisplay.freeQty : '-'}
                                </Typography>
                                {schemeLabels.length > 0 && (
                                  <Typography variant="caption" color="text.secondary">
                                    Scheme Applied: {schemeLabels.join(', ')}
                                  </Typography>
                                )}
                              </Box>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" fontWeight="bold">
                                {physicalQtyForLine}
                              </Typography>
                            </TableCell>
                            <TableCell align="right" colSpan={4}>
                              <Typography variant="caption" color="textSecondary">See individual batches below</Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" fontWeight="bold">
                                ₹{lineInvoiceAmt.toFixed(2)}
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
                            const batchFree = toNumber(allocation.allocationFreeQty);
                            const batchPhysical = orderedUnitsFromAllocation(allocation);
                            const batchMRP = allocation.mrp || 0;
                            const gstRate = allocation.gstRate || item.gstRate || 5;
                            const discountPct = allocation.discountPercentage !== undefined ? allocation.discountPercentage : (item.discountPercentage !== undefined ? item.discountPercentage : 0);
                            
                            // Calculate price from MRP: (MRP * 0.80) / (1 + GST/100)
                            let batchPurchasePrice = 0;
                            if (batchMRP > 0) {
                              const afterDiscount = batchMRP * 0.80; // Apply 20% discount
                              batchPurchasePrice = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
                            } else {
                              batchPurchasePrice = allocation.purchasePrice || 0;
                            }

                            const batchTotal =
                              lineInvoiceAmt * (toNumber(allocation.quantity) / invoiceAmtDen);
                            
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
                                <TableCell align="right">
                                  <Typography variant="caption">
                                    {batchFree > 0 ? batchFree : '-'}
                                  </Typography>
                                </TableCell>
                                <TableCell align="right">
                                  <Typography variant="caption">{batchPhysical}</Typography>
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
                    const schemeLabels = getSchemeLabels(item);
                    const singleAlloc =
                      item.batchAllocations && item.batchAllocations.length === 1
                        ? item.batchAllocations[0]
                        : null;
                    const medSingle = medicines?.find((m) => m.id === item.medicineId);
                    let totalOSingle = toNumber(item.quantity);
                    let schemePS: number | undefined;
                    let schemeFS: number | undefined;
                    if (singleAlloc != null) {
                      totalOSingle = orderedUnitsFromAllocation(singleAlloc);
                      const b = medSingle?.stockBatches?.find(
                        (x: any) => x.batchNumber === singleAlloc.batchNumber
                      );
                      const s = getSchemeFromAny(b || singleAlloc);
                      if (s.schemePaidQty > 0 && s.schemeFreeQty > 0) {
                        schemePS = s.schemePaidQty;
                        schemeFS = s.schemeFreeQty;
                      }
                    } else if (item.batchNumber && medSingle?.stockBatches) {
                      const b = medSingle.stockBatches.find((x: any) => x.batchNumber === item.batchNumber);
                      const s = getSchemeFromAny(b);
                      if (s.schemePaidQty > 0 && s.schemeFreeQty > 0) {
                        schemePS = s.schemePaidQty;
                        schemeFS = s.schemeFreeQty;
                      }
                    }
                    const singleLineDisplay = schemeOrderLineDisplayTotals(
                      totalOSingle,
                      schemePS,
                      schemeFS
                    );
                    const paidForDisplay = singleLineDisplay.billQty;
                    const physicalForDisplay = singleLineDisplay.totalQty;
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
                        <TableCell align="right">
                          {item.originalQuantity && item.originalQuantity !== item.quantity ? (
                            <Box>
                              <Typography variant="body2">
                                {item.quantity} / {item.originalQuantity}
                              </Typography>
                              <Chip 
                                label="Partial" 
                                size="small" 
                                color="warning" 
                                sx={{ mt: 0.5 }}
                              />
                            </Box>
                          ) : (
                            paidForDisplay
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Box>
                            <Typography variant="body2">
                              {singleLineDisplay.freeQty > 0 ? singleLineDisplay.freeQty : '-'}
                            </Typography>
                            {schemeLabels.length > 0 && (
                              <Typography variant="caption" color="text.secondary">
                                Scheme Applied: {schemeLabels.join(', ')}
                              </Typography>
                            )}
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight="medium">
                            {physicalForDisplay}
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
                          {item.batchNumber || (item.batchAllocations && item.batchAllocations.length > 0)
                            ? `₹${orderLineTaxableBeforeDiscount(item, medSingle, taxPercentage).toFixed(2)}`
                            : <Typography variant="caption" color="textSecondary">-</Typography>}
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

            {/* Payment Collection Card - Redesigned */}
            <Card sx={{ mt: 2, border: '1px solid', borderColor: 'divider', borderLeft: 4, borderLeftColor: (order.paymentStatus === 'Paid' ? 'success.main' : order.paymentStatus === 'Partial' ? 'warning.main' : 'error.main') }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                  <Typography variant="subtitle1" fontWeight="600">Payment</Typography>
                  <Chip
                    size="small"
                    label={order.paymentStatus || 'Unpaid'}
                    color={
                      order.paymentStatus === 'Paid' ? 'success' :
                      order.paymentStatus === 'Partial' ? 'warning' : 'error'
                    }
                  />
                </Box>

                {/* Payment summary */}
                <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.5, mb: 2 }}>
                  <Box display="flex" justifyContent="space-between" mb={0.5}>
                    <Typography variant="body2" color="textSecondary">Order Total</Typography>
                    <Typography variant="body2" fontWeight="bold">₹{order.totalAmount?.toFixed(2) || grandTotal.toFixed(2)}</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" mb={0.5}>
                    <Typography variant="body2" color="textSecondary">Paid</Typography>
                    <Typography variant="body2" color="success.main">₹{(order.paidAmount ?? 0).toFixed(2)}</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between">
                    <Typography variant="body2" color="textSecondary">Due</Typography>
                    <Typography variant="body2" fontWeight="bold" color={(order.dueAmount ?? (order.totalAmount || 0) - (order.paidAmount ?? 0)) > 0 ? 'error.main' : 'success.main'}>
                      ₹{((order.dueAmount ?? (order.totalAmount || 0) - (order.paidAmount ?? 0)) || 0).toFixed(2)}
                    </Typography>
                  </Box>
                  {order.paymentMethod && (
                    <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, display: 'block' }}>
                      Method: {order.paymentMethod}
                    </Typography>
                  )}
                  {order.transactionId && (
                    <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, display: 'block' }}>
                      Txn ID: {order.transactionId}
                    </Typography>
                  )}
                </Box>

                {/* Actions - only when dispatched */}
                {(order.status === 'In Transit' || order.status === 'Delivered') && (
                  <>
                    {(order.paymentStatus === 'Unpaid' || !order.paymentStatus || order.paymentStatus === 'Partial') ? (
                      <Button
                        fullWidth
                        variant="contained"
                        color="primary"
                        startIcon={<Payment />}
                        onClick={() => {
                          const total = order.totalAmount || 0;
                          const paid = order.paidAmount ?? 0;
                          const due = total - paid;
                          setPaymentDialog({
                            open: true,
                            amount: String(due > 0 ? due : total),
                            method: (order.paymentMethod === 'Cash' || order.paymentMethod === 'Online' ? order.paymentMethod : 'Cash') as 'Cash' | 'Online',
                            isFull: due >= total - 0.01,
                            transactionId: order.transactionId || '',
                          });
                        }}
                        sx={{ mb: 1 }}
                      >
                        Record Payment
                      </Button>
                    ) : (
                      <Button
                        fullWidth
                        variant="outlined"
                        size="small"
                        color="inherit"
                        onClick={() => updatePaymentStatusMutation.mutate({
                          orderId: order.id,
                          paymentStatus: 'Unpaid',
                          paidAmount: 0,
                          totalAmount: order.totalAmount,
                        })}
                        disabled={updatePaymentStatusMutation.isPending}
                      >
                        Mark Unpaid
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
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

      {/* Tray Number Dialog */}
      <Dialog 
        open={trayNumberDialog.open} 
        onClose={() => {
          setTrayNumberDialog({ open: false, orderId: null });
        }} 
        maxWidth="sm" 
        fullWidth
      >
        <DialogTitle>
          {order?.status === 'Pending' ? 'Order Information' : 'Order Fulfilled Successfully'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            {order?.status === 'Pending' ? (
              <Alert severity="info" sx={{ mb: 2 }}>
                Please enter the tray number and processor name for this pending order.
              </Alert>
            ) : (
              <Alert severity="success" sx={{ mb: 2 }}>
                Order has been fulfilled successfully. Please enter the tray number and processor name.
              </Alert>
            )}
            <FormControl fullWidth margin="normal">
              <InputLabel>Tray Number</InputLabel>
              <Select
                value={trayNumber}
                label="Tray Number"
                onChange={(e) => setTrayNumber(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSaveTrayNumber()}
              >
                <MenuItem value="">
                  <em>Select tray (optional)</em>
                </MenuItem>
                {trayNumber && !availableTrays.some((t) => t.name === trayNumber) && (
                  <MenuItem value={trayNumber}>{trayNumber}</MenuItem>
                )}
                {availableTrays.map((tray) => (
                  <MenuItem key={tray.id} value={tray.name}>
                    {tray.name}
                  </MenuItem>
                ))}
              </Select>
              <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, display: 'block' }}>
                Add more trays in Operations → Tray Numbers. Trays assigned to Pending or In-Fulfillment orders are hidden until dispatched.
              </Typography>
            </FormControl>
            <FormControl fullWidth margin="normal">
              <InputLabel>Processed By</InputLabel>
              <Select
                value={processedBy}
                label="Processed By"
                onChange={(e) => setProcessedBy(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSaveTrayNumber()}
              >
                <MenuItem value="">
                  <em>Select operator (optional)</em>
                </MenuItem>
                {processedBy && !operators?.some((o) => o.name === processedBy) && (
                  <MenuItem value={processedBy}>{processedBy}</MenuItem>
                )}
                {operators?.map((op) => (
                  <MenuItem key={op.id} value={op.name}>
                    {op.name}
                  </MenuItem>
                ))}
              </Select>
              <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5 }}>
                Add more operators in Operations → Operators
              </Typography>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setTrayNumberDialog({ open: false, orderId: null });
            setTrayNumber('');
            setProcessedBy('');
          }}>
            Skip
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSaveTrayNumber}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Record Payment Dialog */}
      <Dialog
        open={paymentDialog.open}
        onClose={() => setPaymentDialog({ ...paymentDialog, open: false, transactionId: '' })}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle sx={{ pb: 0 }}>Record Payment</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Amount"
              type="number"
              value={paymentDialog.amount}
              onChange={(e) => setPaymentDialog({ ...paymentDialog, amount: e.target.value })}
              InputProps={{
                startAdornment: <InputAdornment position="start">₹</InputAdornment>,
                inputProps: { min: 0, max: order?.totalAmount || 0, step: 0.01 }
              }}
              helperText={`Order total: ₹${(order?.totalAmount || 0).toFixed(2)}`}
              sx={{ mb: 2 }}
            />
            <Typography variant="subtitle2" color="textSecondary" gutterBottom sx={{ mb: 1 }}>
              Payment method
            </Typography>
            <ToggleButtonGroup
              value={paymentDialog.method}
              exclusive
              onChange={(_, val) => val && setPaymentDialog({ ...paymentDialog, method: val })}
              fullWidth
              sx={{ mb: 1 }}
            >
              <ToggleButton value="Cash" sx={{ py: 1.25 }}>
                <AttachMoney sx={{ mr: 0.5, fontSize: 18 }} /> Cash
              </ToggleButton>
              <ToggleButton value="Online" sx={{ py: 1.25 }}>
                <Payment sx={{ mr: 0.5, fontSize: 18 }} /> Online
              </ToggleButton>
            </ToggleButtonGroup>
            {paymentDialog.method === 'Online' && (
              <TextField
                fullWidth
                label="Transaction ID"
                placeholder="e.g. UPI ref, bank transfer ref"
                value={paymentDialog.transactionId}
                onChange={(e) => setPaymentDialog({ ...paymentDialog, transactionId: e.target.value })}
                helperText="Optional - for UPI, bank transfer, or card payment reference"
                sx={{ mb: 2 }}
              />
            )}
            <Box display="flex" gap={1} mt={2}>
              <Button
                fullWidth
                variant="outlined"
                size="small"
                onClick={() => setPaymentDialog({ ...paymentDialog, amount: String(order?.totalAmount || 0), isFull: true })}
              >
                Full amount
              </Button>
              <Button
                fullWidth
                variant="outlined"
                size="small"
                onClick={() => setPaymentDialog({ ...paymentDialog, amount: String((order?.totalAmount || 0) * 0.5), isFull: false })}
              >
                50%
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPaymentDialog({ open: false, amount: '', method: 'Cash', isFull: true, transactionId: '' })}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              !paymentDialog.amount ||
              parseFloat(paymentDialog.amount) <= 0 ||
              parseFloat(paymentDialog.amount) > (order?.totalAmount || 0) ||
              updatePaymentStatusMutation.isPending
            }
            onClick={() => {
              const amount = parseFloat(paymentDialog.amount) || 0;
              const total = order?.totalAmount || 0;
              const isPaid = Math.abs(amount - total) < 0.01;
              updatePaymentStatusMutation.mutate({
                orderId: order!.id,
                paymentStatus: isPaid ? 'Paid' : 'Partial',
                paidAmount: amount,
                totalAmount: total,
                paymentMethod: paymentDialog.method,
                transactionId: paymentDialog.method === 'Online' ? paymentDialog.transactionId : undefined,
              });
              setPaymentDialog({ open: false, amount: '', method: 'Cash', isFull: true, transactionId: '' });
            }}
          >
            {updatePaymentStatusMutation.isPending ? <CircularProgress size={24} /> : 'Confirm'}
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
                label="HSN / item code"
                value={newMedicineData.code}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, code: e.target.value })}
                helperText="GST HSN — same value can apply to many products"
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
                    <TableCell align="center">Scheme</TableCell>
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
                            const parsed = parseFloat(e.target.value);
                            const value = Number.isFinite(parsed) ? parsed : 0;
                            newAllocations[idx].quantity = Math.max(
                              0,
                              Math.min(value, allocation.availableQuantity)
                            );
                            setBatchAllocations(newAllocations);

                            const total = newAllocations.reduce(
                              (sum, a) => sum + orderedUnitsFromAllocation(a),
                              0
                            );
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
                          error={orderedUnitsFromAllocation(allocation) > allocation.availableQuantity}
                          helperText={
                            orderedUnitsFromAllocation(allocation) > allocation.availableQuantity
                              ? 'Exceeds available'
                              : ''
                          }
                        />
                      </TableCell>
                      <TableCell align="right">
                        ₹{allocation.purchasePrice?.toFixed(2) || '-'}
                      </TableCell>
                      <TableCell align="right">
                        ₹{allocation.mrp?.toFixed(2) || '-'}
                      </TableCell>
                      <TableCell align="center">
                        <Typography variant="body2">
                          {formatPurchaseSchemeLabel(allocation.schemePaidQty, allocation.schemeFreeQty)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {batchAllocationDialog.allocatedQuantity < batchAllocationDialog.requiredQuantity && batchAllocationDialog.allocatedQuantity > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                Partial fulfillment: {batchAllocationDialog.allocatedQuantity} / {batchAllocationDialog.requiredQuantity} units will be fulfilled. 
                The remaining {batchAllocationDialog.requiredQuantity - batchAllocationDialog.allocatedQuantity} units will not be fulfilled.
              </Alert>
            )}
            {batchAllocationDialog.allocatedQuantity === batchAllocationDialog.requiredQuantity && batchAllocationDialog.allocatedQuantity > 0 && (
              <Alert severity="success" sx={{ mt: 2 }}>
                All quantities allocated successfully!
              </Alert>
            )}
            {batchAllocationDialog.allocatedQuantity === 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Please allocate at least some quantity to proceed.
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
            disabled={batchAllocationDialog.allocatedQuantity === 0 || batchAllocationDialog.allocatedQuantity > batchAllocationDialog.requiredQuantity}
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


