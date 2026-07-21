import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
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
  Undo,
  Refresh,
  Add,
  Remove,
} from '@mui/icons-material';
import { useQueryClient } from '@tanstack/react-query';
import {
  useOrder,
  useOrdersByStatuses,
  useUpdateOrderStatus,
  useFulfillOrder,
  useUnfulfillOrder,
  useRecalculateOrderPricing,
  useUpdateOrderDispatch,
  useMarkOrderDelivered,
  useCancelOrder,
  useRestoreCancelledOrderStock,
  useUpdatePaymentStatus,
} from '../hooks/useOrders';
import { updateOrderMedicines, updateOrderTotalAmount, saveOrderFulfillmentDraft, getOrderById } from '../services/orders';
import { setOrderTotalOverride } from '../utils/orderTotalOverrides';
import { calculateOrderTotalsFromLines } from '../utils/orderTotals';
import { prepareFulfilledDemandOrderMedicines } from '../utils/fulfilledDemandOrderContext';
import { useMedicines, useCreateMedicine } from '../hooks/useInventory';
import { useProductDemandsForOrder } from '../hooks/useProductDemands';
import { usePurchaseInvoices } from '../hooks/usePurchaseInvoices';
import { useTrays, useOperators, useTraysInUse } from '../hooks/useOperations';
import { format } from 'date-fns';
import { auth, doc, updateDoc, db } from '../services/firebase';
import { Loading } from '../components/Loading';
import { ProductDemandImage } from '../components/ProductDemandImage';
import { QRCodeScanner } from '../components/BarcodeScanner';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Medicine, OrderMedicine, OrderStatus, ProductDemand } from '../types';
import { generateOrderInvoice } from '../utils/invoice';
import { formatOrderNumberForDisplay } from '../utils/orderDisplay';
import {
  clearSessionFulfillmentDraft,
  mergeFulfillmentWorkIntoLines,
  pickFulfillmentDraft,
  serializeDraftMedicines,
  writeSessionFulfillmentDraft,
} from '../utils/orderFulfillmentDraft';
import {
  buildExternalPendingReservations,
  computeBatchAvailability,
  findBatchStockConflicts,
  formatBatchStockConflictMessage,
  lineUsesConflictingBatch,
  batchReservationKey,
} from '../utils/fulfillmentBatchReservations';
import { normalizeFirestoreDate } from '../services/inventory';
import {
  computeSchemeFulfillmentFreeQty,
  orderLineSchemeDisplayPhysical,
  orderedUnitsFromAllocation,
  schemeLinePaidFreeConserved,
  schemeOrderLineDisplayTotals,
  formatSchemeQty,
  splitSchemeAcrossAllocationPhysical,
} from '../utils/schemeFulfillment';
import {
  orderLineInvoiceEconomics,
  orderLineAmountAfterDiscount,
  orderLineTaxableBeforeDiscount,
} from '../utils/orderLineInvoiceEconomics';
import { formatPurchaseSchemeLabel } from '../utils/purchaseSchemeLabel';
import {
  applyDefaultDiscountToFulfillmentLine,
  buildPurchaseBatchDiscountLookup,
  findStockBatch,
  resolveOrderLineDiscountPct,
  resolveOrderLineDisplayDiscountPct,
  toSellDiscountBatch,
  unitPriceFromBatch,
} from '../utils/orderFulfillmentDiscount';
import { useAppDialog } from '../context/AppDialogProvider';
import { useFulfillmentLeaveGuard } from '../context/FulfillmentLeaveGuardContext';
import { recalculateMedicinesPricingFromInventory } from '../utils/recalculateOrderLinePricing';
import { stripUndefinedDeep } from '../utils/firestorePayload';

const statusSteps: OrderStatus[] = ['Pending', 'Order Fulfillment', 'In Transit', 'Delivered'];

const toNumber = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Ordered physical strips for a Pending line (admin qty edit / batch required qty). */
const getOrderedPhysicalQty = (item: {
  originalQuantity?: number;
  quantity?: number;
  freeQuantity?: number;
}): number => {
  const orig = toNumber(item.originalQuantity);
  if (orig > 0) return Math.floor(orig);
  const qty = toNumber(item.quantity);
  const free = toNumber(item.freeQuantity);
  if (free > 0) return Math.max(1, Math.floor(qty + free));
  return Math.max(1, Math.floor(qty));
};

/** Map fulfillment UI line → OrderMedicine for Firestore (drops verified/scan-only fields). */
const toPersistedOrderMedicine = (line: any): OrderMedicine => {
  if ((line as { lineType?: string }).lineType === 'product_demand') {
    return stripUndefinedDeep({
      medicineId: line.medicineId || '',
      name: line.name || '',
      price: toNumber(line.price),
      quantity: Math.max(1, toNumber(line.quantity) || 1),
      lineType: 'product_demand' as const,
      productDemandId: line.productDemandId,
      manufacturerName: line.manufacturerName,
      requestedUnit: line.requestedUnit,
      notes: line.notes,
      imageUrl: line.imageUrl,
      originalQuantity: line.originalQuantity != null ? toNumber(line.originalQuantity) : undefined,
    }) as OrderMedicine;
  }

  const out: Record<string, unknown> = {
    medicineId: line.medicineId,
    name: line.name,
    price: toNumber(line.price),
    quantity: toNumber(line.quantity),
  };
  if (line.freeQuantity != null) out.freeQuantity = toNumber(line.freeQuantity);
  if (line.originalQuantity != null) out.originalQuantity = toNumber(line.originalQuantity);
  if (line.batchNumber) out.batchNumber = line.batchNumber;
  if (line.expiryDate) out.expiryDate = line.expiryDate;
  else if (line.batchExpiryDate) out.expiryDate = line.batchExpiryDate;
  if (line.discountPercentage != null && line.discountPercentage !== '') {
    out.discountPercentage = toNumber(line.discountPercentage);
  }
  if (line.discountManuallySet === true) out.discountManuallySet = true;
  if (line.gstRate != null) out.gstRate = toNumber(line.gstRate);
  if (line.mrp != null) out.mrp = toNumber(line.mrp);
  if (line.nonReturnable === true) out.nonReturnable = true;
  if (line.productDemandId) {
    out.productDemandId = line.productDemandId;
    out.lineType = 'medicine';
  }
  if (typeof line.notes === 'string' && line.notes.trim()) out.notes = line.notes.trim();
  if (Array.isArray(line.batchAllocations) && line.batchAllocations.length > 0) {
    out.batchAllocations = line.batchAllocations.map((a: any) =>
      stripUndefinedDeep({
        batchNumber: a.batchNumber,
        quantity: toNumber(a.quantity),
        allocationFreeQty:
          a.allocationFreeQty != null ? toNumber(a.allocationFreeQty) : undefined,
        expiryDate: a.expiryDate,
        mrp: a.mrp != null ? toNumber(a.mrp) : undefined,
        purchasePrice: a.purchasePrice != null ? toNumber(a.purchasePrice) : undefined,
        gstRate: a.gstRate != null ? toNumber(a.gstRate) : undefined,
        discountPercentage:
          a.discountPercentage != null ? toNumber(a.discountPercentage) : undefined,
        schemePaidQty: a.schemePaidQty != null ? toNumber(a.schemePaidQty) : undefined,
        schemeFreeQty: a.schemeFreeQty != null ? toNumber(a.schemeFreeQty) : undefined,
        ...(a.nonReturnable === true ? { nonReturnable: true } : {}),
      })
    );
  }
  return stripUndefinedDeep(out) as unknown as OrderMedicine;
};

const formatExpiryMmYyyy = (value: unknown): string | null => {
  const d = normalizeFirestoreDate(value);
  return d ? format(d, 'MM/yyyy') : null;
};

const expiryIsAfterNow = (value: unknown): boolean => {
  const d = normalizeFirestoreDate(value);
  return d ? d.getTime() > Date.now() : true;
};

const parseDiscountPct = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return n;
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

type PurchaseDiscountLookup = ReturnType<typeof buildPurchaseBatchDiscountLookup>;

function mapRepairedLineToFulfillment(
  line: OrderMedicine,
  medicines: Medicine[],
  purchaseDiscountLookup: PurchaseDiscountLookup,
  orderStatus?: string
) {
  if ((line as { lineType?: string }).lineType === 'product_demand') {
    return {
      ...line,
      medicineId: (line as { medicineId?: string }).medicineId ?? '',
      verified: true,
      scannedQRCode: '',
      batchExpiryDate: undefined,
      batchNumber: undefined,
      batchAllocations: undefined,
      discountPercentage: 0,
      freeQuantity: 0,
      originalQuantity: line.originalQuantity || line.quantity,
      lineType: 'product_demand' as const,
      productDemandId: line.productDemandId,
      manufacturerName: (line as { manufacturerName?: string }).manufacturerName,
      requestedUnit: (line as { requestedUnit?: string }).requestedUnit,
      notes: (line as { notes?: string }).notes,
    };
  }

  let discountPct = line.discountPercentage;
  const medicine = medicines.find((med) => med.id === line.medicineId);

  const lineSchemeFreeQty = (batchNumber: string | undefined, lineQty: number): number => {
    if (!batchNumber || !medicine?.stockBatches) return 0;
    const batch = medicine.stockBatches.find((b) => b.batchNumber === batchNumber);
    if (!batch) return 0;
    const sch = getSchemeFromAny(batch);
    return computeSchemeFulfillmentFreeQty(lineQty, sch.schemePaidQty, sch.schemeFreeQty);
  };

  let batchAllocations = line.batchAllocations;

  const computedFreeQuantity =
    batchAllocations && batchAllocations.length > 0
      ? (() => {
          const hasPerAllocFree = batchAllocations.some(
            (a) => a.allocationFreeQty !== undefined && a.allocationFreeQty !== null
          );
          if (hasPerAllocFree) {
            return batchAllocations.reduce(
              (s, allocation) => s + toNumber(allocation.allocationFreeQty ?? 0),
              0
            );
          }
          let schemePaid: number | undefined;
          let schemeFree: number | undefined;
          for (const allocation of batchAllocations) {
            const b = medicine?.stockBatches?.find((x) => x.batchNumber === allocation.batchNumber);
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
          const totalO = orderLineSchemeDisplayPhysical(
            { ...line, batchAllocations },
            schemePaid,
            schemeFree
          );
          return computeSchemeFulfillmentFreeQty(totalO, schemePaid, schemeFree);
        })()
      : lineSchemeFreeQty(line.batchNumber, toNumber(line.quantity));

  const shouldRefreshDiscount = orderStatus === 'Pending';

  const withDefaults = shouldRefreshDiscount
    ? applyDefaultDiscountToFulfillmentLine(
        {
          ...line,
          batchAllocations,
          discountManuallySet: (line as { discountManuallySet?: boolean }).discountManuallySet,
        },
        purchaseDiscountLookup,
        (batchNumber) => findStockBatch(medicine, batchNumber),
        medicine?.gstRate || line.gstRate || 5
      )
    : {
        ...line,
        batchAllocations,
        discountPercentage: line.discountPercentage,
        discountManuallySet: (line as { discountManuallySet?: boolean }).discountManuallySet,
      };
  discountPct = withDefaults.discountPercentage ?? toNumber(line.discountPercentage);

  return {
    ...withDefaults,
    medicineId: line.medicineId,
    verified: !!line.batchNumber || !!(line.batchAllocations && line.batchAllocations.length > 0),
    scannedQRCode: '',
    batchExpiryDate:
      line.batchAllocations && line.batchAllocations.length > 0
        ? line.batchAllocations[0].expiryDate
        : line.expiryDate,
    discountPercentage: discountPct,
    discountManuallySet: (line as { discountManuallySet?: boolean }).discountManuallySet,
    batchAllocations: withDefaults.batchAllocations ?? batchAllocations,
    freeQuantity:
      line.freeQuantity !== undefined && line.freeQuantity !== null
        ? toNumber(line.freeQuantity)
        : computedFreeQuantity,
    originalQuantity: line.originalQuantity || line.quantity,
  };
}

export const OrderDetailsPage: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { alert, confirm, prompt } = useAppDialog();
  const { setGuardActive, allowNextNavigation, guardedNavigate, confirmLeaveIfNeeded } =
    useFulfillmentLeaveGuard();
  const { data: order, isLoading } = useOrder(orderId || '');
  // Only Pending orders hold soft batch reservations (via their fulfillment
  // drafts), so scope this instead of downloading the whole orders collection.
  const { data: allOrders } = useOrdersByStatuses(['Pending']);
  const { data: medicines, isLoading: medicinesLoading } = useMedicines();
  const lineDemandIds = useMemo(
    () =>
      (order?.medicines ?? [])
        .map((m) => m.productDemandId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    [order?.medicines]
  );
  const { data: productDemands } = useProductDemandsForOrder(orderId || '', lineDemandIds);
  const demandById = useMemo(() => {
    const m = new Map<string, ProductDemand>();
    for (const d of productDemands || []) {
      m.set(d.id, d);
    }
    return m;
  }, [productDemands]);
  const { data: purchaseInvoices, isLoading: purchaseInvoicesLoading } = usePurchaseInvoices();
  const purchaseInvoicesList = purchaseInvoices || [];
  const purchaseDiscountLookup = useMemo(
    () => buildPurchaseBatchDiscountLookup(purchaseInvoices || []),
    [purchaseInvoices]
  );
  const orderDemandRepairAttempted = useRef<string | null>(null);
  /** After fulfill, hydrate UI once — PI/medicines refetch must not remount lines (Disc flicker). */
  const fulfilledUiFrozenRef = useRef<string | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localPendingEditsRef = useRef<{ orderId: string | null; dirty: boolean }>({
    orderId: null,
    dirty: false,
  });
  const [resyncingDemandLines, setResyncingDemandLines] = useState(false);
  const [recalculatingPricing, setRecalculatingPricing] = useState(false);

  const hasFulfilledProductDemands = useMemo(() => {
    if (!order?.id || !productDemands?.length) return false;
    return productDemands.some((d) => d.orderId === order.id && d.status === 'fulfilled');
  }, [order?.id, productDemands]);

  const resolveFulfillmentDiscountPct = useCallback(
    (
      medicineId: string | undefined,
      batchNumber: string | undefined,
      itemDiscount?: unknown,
      allocationDiscount?: unknown,
      batch?: { mrp?: number; purchasePrice?: number; discountPercentage?: number },
      discountManuallySet?: boolean,
      gstRate?: number,
      lockPersistedDiscount?: boolean
    ) =>
      resolveOrderLineDisplayDiscountPct({
        itemDiscount,
        allocationDiscount,
        medicineId,
        batchNumber,
        purchaseLookup: purchaseDiscountLookup,
        batch: batch ? { ...batch, batchNumber } : undefined,
        gstRate,
        discountManuallySet,
        lockPersistedDiscount,
      }),
    [purchaseDiscountLookup]
  );

  /** Tracks in-progress batch assignments (synced with leave guard + draft save). */
  const [fulfillmentDirty, setFulfillmentDirty] = useState(false);

  const markFulfillmentDirty = useCallback(() => {
    if (order?.id) {
      localPendingEditsRef.current = { orderId: order.id, dirty: true };
      setFulfillmentDirty(true);
    }
  }, [order?.id]);

  const persistFulfillmentDraft = useCallback(
    async (meds: any[], taxPct?: number) => {
      if (!order?.id || order.status !== 'Pending') return;
      const payload = {
        medicines: serializeDraftMedicines(meds),
        taxPercentage: taxPct ?? order.taxPercentage ?? 5,
      };
      writeSessionFulfillmentDraft(order.id, payload);
      await saveOrderFulfillmentDraft(order.id, payload);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    [order?.id, order?.status, order?.taxPercentage, queryClient]
  );

  const scheduleFulfillmentDraftSave = useCallback(
    (meds: any[]) => {
      if (!order?.id || order.status !== 'Pending') return;
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = setTimeout(() => {
        void persistFulfillmentDraft(meds).catch((err) =>
          console.warn('Failed to save fulfillment draft:', err)
        );
      }, 600);
    },
    [order?.id, order?.status, persistFulfillmentDraft]
  );

  const { data: trays, isError: traysQueryError, error: traysQueryErr, isFetching: traysFetching } = useTrays();
  const { data: operators, isError: operatorsQueryError, error: operatorsQueryErr } = useOperators();
  const { data: traysInUse = [] } = useTraysInUse(orderId || undefined);
  
  const fulfillOrderMutation = useFulfillOrder();
  const unfulfillOrderMutation = useUnfulfillOrder();
  const recalculateOrderPricingMutation = useRecalculateOrderPricing();
  const dispatchOrderMutation = useUpdateOrderDispatch();
  const deliverOrderMutation = useMarkOrderDelivered();
  const cancelOrderMutation = useCancelOrder();
  const restoreCancelledOrderStockMutation = useRestoreCancelledOrderStock();
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

  /** Trays not assigned to another Pending / Order Fulfillment order; current order's tray stays listed for edits. Trays on In Transit+ are free (see getTraysInUse). */
  const traysInUseNorm = useMemo(
    () => new Set(traysInUse.map((x) => String(x ?? '').trim().toLowerCase()).filter(Boolean)),
    [traysInUse]
  );
  const currentTrayNorm = useMemo(
    () => String(order?.trayNumber ?? trayNumber ?? '').trim().toLowerCase(),
    [order?.trayNumber, trayNumber]
  );
  const availableTrays = useMemo(() => {
    if (!trays?.length) return [];
    const out: NonNullable<typeof trays> = [];
    const seen = new Set<string>();
    for (const t of trays) {
      const name = String(t.name ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      const inUseElsewhere = traysInUseNorm.has(key);
      if (!inUseElsewhere || key === currentTrayNorm) {
        seen.add(key);
        out.push(t);
      }
    }
    return out;
  }, [trays, traysInUseNorm, currentTrayNorm]);
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
  /** Tracks which order id has had fulfillment lines synced (avoids empty table on first paint). */
  const [fulfillmentInitOrderId, setFulfillmentInitOrderId] = useState<string | null>(null);

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
    stockQuantity?: number;
    reservedElsewhere?: number;
    reservedSameOrderOtherLines?: number;
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
    setFulfillmentInitOrderId(null);
    setFulfillmentData({ taxPercentage: 5, medicines: [] });
    setFulfillmentDirty(false);
    localPendingEditsRef.current = { orderId: null, dirty: false };
    orderDemandRepairAttempted.current = null;
    fulfilledUiFrozenRef.current = null;
  }, [orderId]);

  useEffect(() => {
    const guardOn = fulfillmentDirty && order?.status === 'Pending';
    setGuardActive(guardOn);
    return () => setGuardActive(false);
  }, [fulfillmentDirty, order?.status, setGuardActive]);

  useEffect(() => {
    if (!fulfillmentDirty || order?.status !== 'Pending') return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [fulfillmentDirty, order?.status]);

  const leaveBlocker = useBlocker(
    Boolean(fulfillmentDirty && order?.status === 'Pending')
  );
  const leaveConfirmInFlightRef = useRef(false);

  useEffect(() => {
    if (leaveBlocker.state !== 'blocked' || leaveConfirmInFlightRef.current) return;
    leaveConfirmInFlightRef.current = true;
    void confirmLeaveIfNeeded().then((ok) => {
      leaveConfirmInFlightRef.current = false;
      if (ok) leaveBlocker.proceed?.();
      else leaveBlocker.reset?.();
    });
  }, [leaveBlocker.state, confirmLeaveIfNeeded, leaveBlocker]);

  useEffect(() => {
    if (!order || !medicines || purchaseInvoices === undefined) return;

    // Fulfilled+: load lines once. Re-running on every PI/medicines update remounted Disc %
    // and made totals look like they were flipping custom ↔ default.
    if (order.status !== 'Pending' && fulfilledUiFrozenRef.current === order.id) {
      return;
    }

    if (localPendingEditsRef.current.orderId !== order.id) {
      localPendingEditsRef.current = { orderId: order.id, dirty: false };
    }

    const stepIndex = statusSteps.indexOf(order.status as OrderStatus);
    setActiveStep(stepIndex >= 0 ? stepIndex : 0);

    if (order.paymentStatus === 'Partial' && order.paidAmount !== undefined) {
      setPartialPaymentAmount(order.paidAmount.toFixed(2));
    } else if (order.paymentStatus !== 'Partial') {
      setPartialPaymentAmount('');
    }

    if (order.status === 'Pending' && !order.trayNumber && !order.processedBy) {
      setTrayNumberDialog({ open: true, orderId: order.id });
      setTrayNumber('');
      setProcessedBy('');
    } else if (order.trayNumber || order.processedBy) {
      setTrayNumber(String(order.trayNumber || '').trim());
      setProcessedBy(order.processedBy || '');
    }

    const rawMedicines =
      order.medicines && Array.isArray(order.medicines) ? order.medicines : [];

    const savedDraft =
      order.status === 'Pending'
        ? pickFulfillmentDraft(order.id, order.fulfillmentDraft)
        : null;

    const mappedFromServer = rawMedicines.map((line) =>
      mapRepairedLineToFulfillment(line, medicines, purchaseDiscountLookup, order.status)
    );

    const initialMedicines = savedDraft
      ? mergeFulfillmentWorkIntoLines(mappedFromServer, savedDraft.medicines)
      : mappedFromServer;

    if (savedDraft) {
      localPendingEditsRef.current = { orderId: order.id, dirty: true };
      setFulfillmentDirty(true);
    }

    setFulfillmentData((prev) => {
      if (
        order.status === 'Pending' &&
        localPendingEditsRef.current.orderId === order.id &&
        localPendingEditsRef.current.dirty &&
        prev.medicines.length > 0
      ) {
        return {
          ...prev,
          medicines: mergeFulfillmentWorkIntoLines(mappedFromServer, prev.medicines),
        };
      }
      return {
        ...prev,
        taxPercentage: savedDraft?.taxPercentage ?? order.taxPercentage ?? prev.taxPercentage ?? 5,
        medicines: initialMedicines,
      };
    });
    setFulfillmentInitOrderId(order.id);
    if (order.status !== 'Pending') {
      fulfilledUiFrozenRef.current = order.id;
    }

    let cancelled = false;

    void (async () => {
      // Demand-line repair only — do not remount fulfilled UI from async remap (Disc flicker).
      if (order.status !== 'Pending') {
        const { medicines: repaired, changed } = await prepareFulfilledDemandOrderMedicines(
          rawMedicines,
          order.id,
          productDemands || [],
          medicines,
          purchaseInvoicesList
        );
        if (cancelled) return;
        if (changed && orderDemandRepairAttempted.current !== order.id) {
          orderDemandRepairAttempted.current = order.id;
          try {
            await updateOrderMedicines(order.id, repaired);
            // Allow one re-hydrate from saved medicines after repair write.
            fulfilledUiFrozenRef.current = null;
            queryClient.invalidateQueries({ queryKey: ['order', order.id] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['productDemands'] });
          } catch (err) {
            console.error('Failed to repair fulfilled demand order lines:', err);
            orderDemandRepairAttempted.current = null;
          }
        }
        return;
      }

      const { medicines: repaired, changed } = await prepareFulfilledDemandOrderMedicines(
        rawMedicines,
        order.id,
        productDemands || [],
        medicines,
        purchaseInvoicesList
      );

      if (changed && orderDemandRepairAttempted.current !== order.id) {
        orderDemandRepairAttempted.current = order.id;
        try {
          await updateOrderMedicines(order.id, repaired);
          queryClient.invalidateQueries({ queryKey: ['order', order.id] });
          queryClient.invalidateQueries({ queryKey: ['orders'] });
          queryClient.invalidateQueries({ queryKey: ['productDemands'] });
        } catch (err) {
          console.error('Failed to repair fulfilled demand order lines:', err);
          orderDemandRepairAttempted.current = null;
        }
      }

      if (cancelled) return;

      setFulfillmentData((prev) => {
        const repairedMapped = repaired.map((line) =>
          mapRepairedLineToFulfillment(line, medicines, purchaseDiscountLookup, order.status)
        );

        if (
          order.status === 'Pending' &&
          localPendingEditsRef.current.orderId === order.id &&
          localPendingEditsRef.current.dirty
        ) {
          const workSource =
            prev.medicines.length > 0
              ? prev.medicines
              : savedDraft?.medicines ?? [];
          return {
            ...prev,
            medicines: mergeFulfillmentWorkIntoLines(repairedMapped, workSource),
          };
        }

        return { ...prev, medicines: repairedMapped };
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    order?.id,
    order?.status,
    order?.medicines,
    order?.taxPercentage,
    order?.trayNumber,
    order?.processedBy,
    order?.fulfillmentDraft,
    order?.paymentStatus,
    order?.paidAmount,
    medicines,
    productDemands,
    purchaseInvoices,
    purchaseInvoicesList,
    purchaseDiscountLookup,
    queryClient,
  ]);

  // Re-apply batch/PI trade discount only while Pending (before fulfill).
  // After fulfill, saved Disc % (including 0%) must not be overwritten from PI.
  useEffect(() => {
    if (!order || order.status !== 'Pending') return;

    setFulfillmentData((prev) => {
      if (!prev.medicines.length) return prev;

      let changed = false;
      const nextMedicines = prev.medicines.map((m) => {
        if ((m as any).lineType === 'product_demand') return m;
        if (m.discountManuallySet) return m;
        if (!m.batchNumber && !(m.batchAllocations && m.batchAllocations.length > 0)) {
          return m;
        }
        const medicine = medicines?.find((med) => med.id === m.medicineId);
        const defaultGst = medicine?.gstRate || m.gstRate || order.taxPercentage || 5;
        const updated = applyDefaultDiscountToFulfillmentLine(
          m,
          purchaseDiscountLookup,
          (batchNumber) => findStockBatch(medicine, batchNumber),
          defaultGst
        );
        if (updated.discountPercentage !== m.discountPercentage) {
          changed = true;
        } else if (updated.batchAllocations?.length && m.batchAllocations?.length) {
          const allocDiscChanged = updated.batchAllocations.some(
            (a: { batchNumber: string; discountPercentage?: number }, i: number) =>
              a.discountPercentage !== m.batchAllocations?.[i]?.discountPercentage
          );
          if (allocDiscChanged) changed = true;
        }
        return updated;
      });

      return changed ? { ...prev, medicines: nextMedicines } : prev;
    });
  }, [purchaseDiscountLookup, order?.status, order?.taxPercentage, medicines]);

  // Auto-save in-progress fulfillment while Pending (survives navigation to Product Demands).
  useEffect(() => {
    if (order?.status !== 'Pending') return;
    if (!localPendingEditsRef.current.dirty) return;
    if (!fulfillmentData.medicines.length) return;
    scheduleFulfillmentDraftSave(fulfillmentData.medicines);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [fulfillmentData.medicines, order?.status, scheduleFulfillmentDraftSave]);

  const allBatchesAssignedForTotals = useMemo(
    () =>
      fulfillmentData.medicines.length > 0 &&
      fulfillmentData.medicines.every(
        (m) =>
          (m as { lineType?: string }).lineType === 'product_demand' ||
          m.batchNumber ||
          (m.batchAllocations && m.batchAllocations.length > 0)
      ),
    [fulfillmentData.medicines]
  );

  const canRecalculatePricing =
    (order?.status === 'Pending' || order?.status === 'Order Fulfillment') &&
    allBatchesAssignedForTotals;

  const externalBatchReservations = useMemo(
    () => buildExternalPendingReservations(allOrders, order?.id || ''),
    [allOrders, order?.id]
  );

  const getBatchStockQuantity = useCallback(
    (medicineId: string, batchNumber: string) => {
      const med = medicines?.find((m) => m.id === medicineId);
      const batch = med?.stockBatches?.find((b) => b.batchNumber === batchNumber);
      return Number(batch?.quantity) || 0;
    },
    [medicines]
  );

  const batchStockConflicts = useMemo(() => {
    if (order?.status !== 'Pending' || !fulfillmentData.medicines.length) return [];
    return findBatchStockConflicts(
      fulfillmentData.medicines,
      externalBatchReservations,
      getBatchStockQuantity,
      (medicineId) => medicines?.find((m) => m.id === medicineId)?.name || medicineId
    );
  }, [
    order?.status,
    fulfillmentData.medicines,
    externalBatchReservations,
    getBatchStockQuantity,
    medicines,
  ]);

  const batchConflictKeys = useMemo(
    () =>
      new Set(
        batchStockConflicts.map((c) => batchReservationKey(c.medicineId, c.batchNumber))
      ),
    [batchStockConflicts]
  );

  const taxPctForTotals = order?.taxPercentage || fulfillmentData.taxPercentage || 5;
  const lockDiscAfterFulfill = Boolean(order && order.status !== 'Pending');
  const orderTotals = useMemo(
    () =>
      order
        ? calculateOrderTotalsFromLines(
            fulfillmentData.medicines,
            medicines,
            taxPctForTotals,
            purchaseDiscountLookup,
            { lockPersistedDiscount: lockDiscAfterFulfill }
          )
        : {
            billableLines: [],
            subTotal: 0,
            totalDiscount: 0,
            taxAmount: 0,
            calculatedTotal: 0,
            roundoff: 0,
            grandTotal: 0,
            uniformTaxPercentage: null,
          },
    [
      order,
      fulfillmentData.medicines,
      medicines,
      taxPctForTotals,
      purchaseDiscountLookup,
      lockDiscAfterFulfill,
    ]
  );
  const orderTotalSyncRef = useRef<string | null>(null);
  const autoStockRestoreRef = useRef<string | null>(null);

  // Cancel restores stock in Firestore, but Inventory used a 15-minute cache and
  // cancel never invalidated it — refresh medicines whenever a cancelled order is opened.
  useEffect(() => {
    if (!order?.id || order.status !== 'Cancelled') return;
    void queryClient.invalidateQueries({ queryKey: ['medicines'] });
    void queryClient.invalidateQueries({ queryKey: ['expiringMedicines'] });
    void queryClient.invalidateQueries({ queryKey: ['expiredMedicines'] });
  }, [order?.id, order?.status, queryClient]);

  // Auto-restore when cancel never put stock back (failed restore, or retailer/SO cancel after fulfill).
  useEffect(() => {
    if (!order?.id || order.status !== 'Cancelled') return;
    if (order.stockRestoredOnCancel === true) return;
    if (autoStockRestoreRef.current === order.id) return;

    const hasFulfilledBatches = (order.medicines || []).some(
      (m) =>
        Boolean(m.batchNumber) ||
        (Array.isArray(m.batchAllocations) && m.batchAllocations.length > 0)
    );
    if (!hasFulfilledBatches) return;

    const cancelNote = String(order.cancelReason || '');
    const needsRestore =
      order.stockRestoredOnCancel === false ||
      /cancelled by retailer|cancelled by sales officer/i.test(cancelNote);
    if (!needsRestore) return;

    autoStockRestoreRef.current = order.id;
    void restoreCancelledOrderStockMutation
      .mutateAsync(order.id)
      .then(async (res) => {
        if (res.stockRestoreErrors.length > 0) {
          await alert(
            `Inventory restore incomplete:\n${res.stockRestoreErrors.slice(0, 3).join('\n')}`,
            { severity: 'warning' }
          );
        }
      })
      .catch((e: unknown) => {
        console.warn('Auto stock restore on cancelled order failed:', e);
      });
    // Intentionally omit mutation object from deps — run once per order id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.status, order?.stockRestoredOnCancel, order?.cancelReason, alert]);

  useEffect(() => {
    if (!order?.id) return;
    if (order.status === 'Cancelled') return;
    // Only auto-sync live totals while Pending. After fulfill, rewriting totalAmount
    // caused Disc % / payment totals to oscillate (custom ↔ PI default).
    if (order.status !== 'Pending') {
      const liveTotal = orderTotals.grandTotal;
      if (liveTotal > 0) setOrderTotalOverride(order.id, liveTotal);
      return;
    }
    if (!allBatchesAssignedForTotals) return;
    if (!medicines?.length) return;

    const liveTotal = orderTotals.grandTotal;
    if (liveTotal <= 0) return;
    setOrderTotalOverride(order.id, liveTotal);
    if (Math.abs((order.totalAmount ?? 0) - liveTotal) < 0.005) return;

    const syncKey = `${order.id}:${liveTotal}`;
    if (orderTotalSyncRef.current === syncKey) return;

    orderTotalSyncRef.current = syncKey;
    void updateOrderTotalAmount(order.id, liveTotal, order.paidAmount ?? 0, {
      taxAmount: orderTotals.taxAmount,
      subTotal: orderTotals.subTotal,
    })
      .then(() => {
        queryClient.setQueryData(['order', order.id], (old: unknown) => {
          if (!old || typeof old !== 'object') return old;
          return {
            ...(old as object),
            totalAmount: liveTotal,
            dueAmount: Math.max(0, liveTotal - (order.paidAmount ?? 0)),
            taxAmount: orderTotals.taxAmount,
            subTotal: orderTotals.subTotal,
          };
        });
        queryClient.invalidateQueries({ queryKey: ['receivableOrders'] });
      })
      .catch((err) => {
        console.error('Failed to sync order total:', err);
        orderTotalSyncRef.current = null;
      });
  }, [
    order?.id,
    order?.status,
    order?.totalAmount,
    order?.paidAmount,
    orderTotals.grandTotal,
    orderTotals.taxAmount,
    orderTotals.subTotal,
    allBatchesAssignedForTotals,
    medicines,
    queryClient,
  ]);

  const handleResyncDemandLinesFromPi = useCallback(async () => {
    if (!order?.id || !medicines || purchaseInvoices === undefined) return;

    setResyncingDemandLines(true);
    orderDemandRepairAttempted.current = null;

    try {
      const rawMedicines = order.medicines ?? [];
      const { medicines: repaired, changed } = await prepareFulfilledDemandOrderMedicines(
        rawMedicines,
        order.id,
        productDemands || [],
        medicines,
        purchaseInvoicesList
      );

      await updateOrderMedicines(order.id, repaired);
      orderDemandRepairAttempted.current = order.id;

      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['productDemands'] });

      setFulfillmentData((prev) => ({
        ...prev,
        medicines: repaired.map((line) =>
          mapRepairedLineToFulfillment(line, medicines, purchaseDiscountLookup, order.status)
        ),
      }));

      if (changed) {
        await alert('Order lines updated from purchase invoice.', { severity: 'success' });
      } else {
        await alert('Lines checked — no changes were needed (confirm demand has purchase invoice ref).', { severity: 'info' });
      }
    } catch (err) {
      console.error('Resync demand lines from PI failed:', err);
      await alert('Could not sync lines from purchase invoice. See console for details.', { severity: 'error' });
    } finally {
      setResyncingDemandLines(false);
    }
  }, [
    order,
    medicines,
    productDemands,
    purchaseInvoices,
    purchaseInvoicesList,
    purchaseDiscountLookup,
    queryClient,
    alert,
  ]);

  const handleRecalculatePricing = useCallback(async () => {
    if (!order?.id || !medicines) return;
    if (!canRecalculatePricing) {
      await alert('Assign batches to all lines before recalculating pricing.', { severity: 'warning' });
      return;
    }

    const proceed = await confirm(
      order.status === 'Pending'
        ? 'Update unit prices and discount % on this screen from current inventory batch data?'
        : 'Recalculate saved order line prices and totals from current inventory? Re-print the invoice afterward.',
      { title: 'Recalculate pricing from inventory' }
    );
    if (!proceed) return;

    setRecalculatingPricing(true);
    try {
      if (order.status === 'Pending') {
        const recalculated = recalculateMedicinesPricingFromInventory(
          fulfillmentData.medicines,
          medicines,
          purchaseDiscountLookup
        );
        markFulfillmentDirty();
        setFulfillmentData((prev) => ({ ...prev, medicines: recalculated }));
        await persistFulfillmentDraft(recalculated);
        await alert('Pricing updated from current inventory.', { severity: 'success' });
      } else {
        const result = await recalculateOrderPricingMutation.mutateAsync({
          orderId: order.id,
          medicinesCatalog: medicines,
          purchaseInvoices: purchaseInvoicesList,
        });
        setFulfillmentData((prev) => ({
          ...prev,
          medicines: result.medicines.map((line) =>
            mapRepairedLineToFulfillment(line, medicines, purchaseDiscountLookup, order.status)
          ),
        }));
        const warn =
          result.totals.grandTotal !== (order.totalAmount ?? 0)
            ? ` New grand total: ₹${result.totals.grandTotal.toFixed(2)}.`
            : '';
        await alert(`Order pricing recalculated from inventory.${warn}`, { severity: 'success' });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Recalculate pricing failed:', err);
      await alert(`Could not recalculate pricing: ${message}`, { severity: 'error' });
    } finally {
      setRecalculatingPricing(false);
    }
  }, [
    order?.id,
    order?.status,
    order?.totalAmount,
    medicines,
    canRecalculatePricing,
    fulfillmentData.medicines,
    purchaseDiscountLookup,
    purchaseInvoicesList,
    persistFulfillmentDraft,
    recalculateOrderPricingMutation,
    alert,
    confirm,
    markFulfillmentDirty,
  ]);

  if (isLoading || medicinesLoading || purchaseInvoicesLoading) {
    return <Loading message="Loading order details..." />;
  }

  if (!order) return <Alert severity="error">Order not found</Alert>;

  const hasOrderLines = (order.medicines?.length ?? 0) > 0;
  if (hasOrderLines && fulfillmentInitOrderId !== order.id) {
    return <Loading message="Loading order items..." />;
  }

  const handleAction = (action: string) => {
    switch (action) {
      case 'fulfill':
        void (async () => {
          if (batchStockConflicts.length > 0) {
            await alert(
              `Cannot fulfill — batch assignments exceed available stock (other pending orders may have reserved the same batches).\n\n${formatBatchStockConflictMessage(batchStockConflicts)}`,
              { severity: 'error', title: 'Stock conflict' }
            );
            return;
          }
          setConfirmDialog({
            open: true,
            action: 'fulfill',
            title: 'Confirm Fulfillment',
            message:
              'Are you sure you want to mark this order as fulfilled? This will generate the tax invoice.',
          });
        })();
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
      case 'unfulfill':
        setConfirmDialog({
          open: true,
          action: 'unfulfill',
          title: 'Un-fulfill order',
          message:
            'Return this order to Pending, restore stock to inventory, and allow batch/discount edits. ' +
            'The invoice number and line assignments will be kept. You will need to fulfill again to deduct stock.',
        });
        break;
    }
  };

  const executeAction = async () => {
    const user = auth.currentUser;
    if (!user) {
      await alert('You must be logged in to perform this action', { severity: 'warning' });
      return;
    }

    try {
      if (confirmDialog.action === 'fulfill') {
        // Calculate subtotal from items with batches assigned
        // Unit price uses batch discount % when set, else standard discount off MRP
        // Total Amount = Price * Quantity
        // Discount = Total Amount * discountPercentage / 100
        // Subtotal = Sum of (Total Amount - Discount)
        const taxPctForLines = order.taxPercentage || fulfillmentData.taxPercentage || 5;
        const fulfillTotals = calculateOrderTotalsFromLines(
          fulfillmentData.medicines,
          medicines,
          taxPctForLines
        );
        const { subTotal, totalDiscount, taxAmount, grandTotal: totalAmount } = fulfillTotals;
        
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
        clearSessionFulfillmentDraft(order.id);
        localPendingEditsRef.current = { orderId: order.id, dirty: false };
        setFulfillmentDirty(false);
        try {
          const refreshed = await getOrderById(order.id);
          if (refreshed) {
            void generateOrderInvoice(refreshed, { emailPdfToRetailer: true }).catch(async (err) => {
              console.error('Error emailing invoice after fulfill:', err);
              await alert(
                'Order fulfilled, but the invoice email could not be sent. Download from Print Invoice or check Firebase logs.',
                { severity: 'warning' }
              );
            });
          }
        } catch (emailErr) {
          console.error('Error loading order for invoice email:', emailErr);
        }
        await alert('Order fulfilled successfully! Invoice will be emailed to the retailer.', { severity: 'success' });
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
        await alert('Order dispatched successfully!', { severity: 'success' });
      } else if (confirmDialog.action === 'deliver') {
        await deliverOrderMutation.mutateAsync({
          orderId: order.id,
          deliveredBy: user.uid
        });
        await alert('Order marked as delivered successfully!', { severity: 'success' });
      } else if (confirmDialog.action === 'cancel') {
        if (!cancelReason.trim()) {
          await alert('Please provide a cancellation reason', { severity: 'warning' });
          return;
        }
        const res = await cancelOrderMutation.mutateAsync({
          orderId: order.id,
          cancelledBy: user.uid,
          reason: cancelReason
        });
        if (res.stockRestoreErrors.length > 0) {
          await alert(
            `Order cancelled, but some stock could not be restored:\n${res.stockRestoreErrors.slice(0, 3).join('\n')}`,
            { severity: 'warning' }
          );
        } else {
          await alert('Order cancelled successfully!', { severity: 'success' });
        }
      } else if (confirmDialog.action === 'unfulfill') {
        const res = await unfulfillOrderMutation.mutateAsync({
          orderId: order.id,
          unfulfilledBy: user.uid,
        });
        localPendingEditsRef.current = { orderId: order.id, dirty: false };
        setFulfillmentDirty(false);
        if (res.stockRestoreErrors.length > 0) {
          await alert(
            `Order returned to Pending, but some stock could not be restored:\n${res.stockRestoreErrors.slice(0, 3).join('\n')}`,
            { severity: 'warning' }
          );
        } else {
          await alert(
            'Order un-fulfilled. Stock restored — you can edit batches/pricing and fulfill again.',
            { severity: 'success' }
          );
        }
      }
      setConfirmDialog({ ...confirmDialog, open: false });
    } catch (error: any) {
      console.error('Action failed:', error);
      await alert(`Failed to ${confirmDialog.action} order: ${error.message || 'Unknown error'}`, { severity: 'error' });
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
        await alert('Tray number and processor information saved successfully!', { severity: 'success' });
      } else {
        await alert('Tray number and processor information saved successfully!', { severity: 'success' });
      }
    } catch (error: any) {
      console.error('Failed to save tray number and processor:', error);
      await alert(`Failed to save information: ${error.message || 'Unknown error'}`, { severity: 'error' });
    }
  };

  const handleScan = async (qrCode: string) => {
    if (scanningItemIndex !== null) {
      const item = fulfillmentData.medicines[scanningItemIndex];
      if (!item || (item as any).lineType === 'product_demand' || !item.medicineId) {
        await alert('Invalid item selected', { severity: 'warning' });
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
            calculatedPrice = unitPriceFromBatch(foundBatch, gstRate, {
              medicineId: item.medicineId,
              purchaseLookup: purchaseDiscountLookup,
            });
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
          const discountPct = resolveFulfillmentDiscountPct(
            item.medicineId,
            foundBatch.batchNumber,
            item.discountPercentage,
            undefined,
            foundBatch,
            item.discountManuallySet,
            gstRate
          );
          newMedicines[scanningItemIndex].discountPercentage = discountPct;
          newMedicines[scanningItemIndex].discountManuallySet = false;
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
            discountPercentage: discountPct,
            schemePaidQty: toNumber(foundBatch.schemePaidQty) || undefined,
            schemeFreeQty: toNumber(foundBatch.schemeFreeQty) || undefined,
            ...(foundBatch.nonReturnable === true ? { nonReturnable: true as const } : {}),
          }];
          newMedicines[scanningItemIndex].freeQuantity = lineSplit.freeQty;
        }
        markFulfillmentDirty();
        setFulfillmentData({ ...fulfillmentData, medicines: newMedicines });
      } else {
        await alert('QR code does not match this medicine!', { severity: 'warning' });
      }
      setScannerOpen(false);
      setScanningItemIndex(null);
    }
  };

  const handleManualEntry = async () => {
    if (manualEntryDialog.itemIndex >= 0) {
      const item = fulfillmentData.medicines[manualEntryDialog.itemIndex];
      if (!item || (item as any).lineType === 'product_demand' || !item.medicineId) {
        await alert('Invalid item selected', { severity: 'warning' });
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
              calculatedPrice = unitPriceFromBatch(foundBatch, gstRate, {
                medicineId: item.medicineId,
                purchaseLookup: purchaseDiscountLookup,
              });
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
            const discountPct = resolveFulfillmentDiscountPct(
              item.medicineId,
              foundBatch.batchNumber,
              item.discountPercentage,
              undefined,
              foundBatch,
              item.discountManuallySet,
              gstRate
            );
            newMedicines[itemIndex].discountPercentage = discountPct;
            newMedicines[itemIndex].discountManuallySet = false;
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
              discountPercentage: discountPct,
              schemePaidQty: toNumber(foundBatch.schemePaidQty) || undefined,
              schemeFreeQty: toNumber(foundBatch.schemeFreeQty) || undefined,
              ...(foundBatch.nonReturnable === true ? { nonReturnable: true as const } : {}),
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
              calculatedPrice = unitPriceFromBatch(batch, gstRate, {
                medicineId: item.medicineId,
                purchaseLookup: purchaseDiscountLookup,
              });
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
            const discountPct = resolveFulfillmentDiscountPct(
              item.medicineId,
              batch.batchNumber,
              item.discountPercentage,
              undefined,
              batch,
              item.discountManuallySet,
              gstRate
            );
            newMedicines[itemIndex].discountPercentage = discountPct;
            newMedicines[itemIndex].discountManuallySet = false;
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
              discountPercentage: discountPct,
              schemePaidQty: toNumber(batch.schemePaidQty) || undefined,
              schemeFreeQty: toNumber(batch.schemeFreeQty) || undefined,
              ...(batch.nonReturnable === true ? { nonReturnable: true as const } : {}),
            }];
            newMedicines[itemIndex].freeQuantity = lineSplit.freeQty;
          }
        } else {
          // Mark as verified without batch
          newMedicines[itemIndex].verified = true;
        }
        
        markFulfillmentDirty();
        setFulfillmentData({ ...fulfillmentData, medicines: newMedicines });
      }
      
      setManualEntryDialog({ open: false, itemIndex: -1 });
      setManualQRCodeInput('');
      setSelectedBatch('');
    }
  };

  // Function to open batch allocation dialog
  const handleAssignBatches = async (itemIndex: number) => {
    const item = fulfillmentData.medicines[itemIndex];
    if (!item || (item as any).lineType === 'product_demand' || !item.medicineId) {
      await alert('Invalid item selected', { severity: 'warning' });
      return;
    }

    const medicine = medicines?.find(m => m.id === item.medicineId);
    if (!medicine) {
      await alert(
        `Medicine not found in master data (ID: ${item.medicineId}). ` +
          'The order may reference a deleted product or mismatched ID. Check Inventory.',
        { severity: 'error' }
      );
      return;
    }
    if (!medicine.stockBatches || medicine.stockBatches.length === 0) {
      await alert(`No stock batches for "${medicine.name}". Add batches in Inventory before fulfilling.`, { severity: 'warning' });
      return;
    }

    // Initialize allocations from existing batchAllocations or single batchNumber
    const existingAllocations = item.batchAllocations || [];
    if (existingAllocations.length === 0 && item.batchNumber) {
      // Migrate from old single batch to new structure
      const existingBatch = medicine.stockBatches.find(b => b.batchNumber === item.batchNumber);
      if (existingBatch) {
        const migrateGstRate = item.gstRate || medicine.gstRate || 5;
        const discountPct = resolveFulfillmentDiscountPct(
          item.medicineId,
          item.batchNumber,
          item.discountPercentage,
          undefined,
          existingBatch,
          item.discountManuallySet,
          migrateGstRate
        );
        
        existingAllocations.push({
          batchNumber: item.batchNumber,
          quantity: item.quantity || 0,
          expiryDate: existingBatch.expiryDate,
          mrp: existingBatch.mrp,
          purchasePrice: existingBatch.purchasePrice,
          gstRate: item.gstRate || medicine.gstRate || 5,
          discountPercentage: discountPct,
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
      await alert('No batches with available stock for this medicine', { severity: 'warning' });
      return;
    }

    setBatchAllocations(
      filteredBatches.map(batch => {
        const existing = existingAllocations.find((a: any) => a.batchNumber === batch.batchNumber);
        const alreadyAllocated = existing ? orderedUnitsFromAllocation(existing) : 0;
        const stockQty = Number(batch.quantity) || 0;
        const avail = computeBatchAvailability(
          item.medicineId!,
          batch.batchNumber,
          stockQty,
          externalBatchReservations,
          fulfillmentData.medicines,
          { excludeLineIndex: itemIndex }
        );
        return {
          batchNumber: batch.batchNumber,
          quantity: alreadyAllocated,
          availableQuantity: avail.effectiveAvailable,
          stockQuantity: avail.stockQuantity,
          reservedElsewhere: avail.reservedElsewhere,
          reservedSameOrderOtherLines: avail.reservedSameOrderOtherLines,
          expiryDate: batch.expiryDate,
          mrp: batch.mrp,
          purchasePrice: batch.purchasePrice,
          standardDiscount: batch.standardDiscount,
          gstRate: medicine.gstRate,
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
  const handleSaveBatchAllocations = async () => {
    const { itemIndex, requiredQuantity } = batchAllocationDialog;
    const item = fulfillmentData.medicines[itemIndex];

    if (!item) {
      await alert('Item not found', { severity: 'error' });
      return;
    }

    // Validate total allocated quantity - allow partial fulfillment (must be > 0 and <= required)
    const totalAllocated = batchAllocations.reduce(
      (sum: number, a: any) => sum + orderedUnitsFromAllocation(a),
      0
    );
    
    if (totalAllocated === 0) {
      await alert('Please allocate at least some quantity', { severity: 'warning' });
      return;
    }
    
    if (totalAllocated > requiredQuantity) {
      await alert(`Total allocated quantity (${totalAllocated}) cannot exceed required quantity (${requiredQuantity})`, { severity: 'warning' });
      return;
    }
    
    // Warn if partial fulfillment
    if (totalAllocated < requiredQuantity) {
      const confirmPartial = await confirm(
        `Warning: Only ${totalAllocated} out of ${requiredQuantity} units will be fulfilled. ` +
        `The remaining ${requiredQuantity - totalAllocated} units will not be fulfilled. Continue?`,
        { title: 'Partial fulfillment' }
      );
      if (!confirmPartial) {
        return;
      }
    }

    // Validate each batch has enough stock (after soft reservations from other pending orders)
    for (const allocation of batchAllocations) {
      const phys = orderedUnitsFromAllocation(allocation);
      if (phys > 0 && phys > allocation.availableQuantity) {
        const reservedNote =
          (allocation.reservedElsewhere ?? 0) > 0
            ? ` (${allocation.reservedElsewhere} reserved in other pending orders)`
            : '';
        await alert(
          `Batch ${allocation.batchNumber} only has ${allocation.availableQuantity} units available for this order${reservedNote}, but ${phys} were allocated`,
          { severity: 'warning' }
        );
        return;
      }
    }

    // Filter out allocations with 0 physical quantity
    const validAllocations = batchAllocations.filter(
      (a) => orderedUnitsFromAllocation(a) > 0
    );

    if (validAllocations.length === 0) {
      await alert('Please allocate at least one batch', { severity: 'warning' });
      return;
    }

    // Get medicine for default GST rate
    const medicine = medicines?.find(m => m.id === item.medicineId);
    const defaultGstRate = medicine?.gstRate || 5;

    const calculatePriceFromMRP = (
      mrp: number | undefined,
      gstRate: number,
      batch?: { purchasePrice?: number; discountPercentage?: number; standardDiscount?: number; batchNumber?: string }
    ): number => {
      if (!mrp || mrp <= 0) return 0;
      if (batch) {
        return unitPriceFromBatch({ ...batch, mrp }, gstRate, {
          medicineId: item.medicineId,
          purchaseLookup: purchaseDiscountLookup,
        });
      }
      return unitPriceFromBatch({ mrp }, gstRate, {
        medicineId: item.medicineId,
        purchaseLookup: purchaseDiscountLookup,
      });
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
    const processedAllocations = validAllocations.map((a) => {
      const gstRate = a.gstRate || defaultGstRate;
      const actualBatch = findStockBatch(medicine, a.batchNumber);
      const sellBatch = toSellDiscountBatch(actualBatch, a.batchNumber, a.mrp, gstRate);
      const calculatedPrice = calculatePriceFromMRP(a.mrp, gstRate, sellBatch);

      const discountPct = resolveFulfillmentDiscountPct(
        item.medicineId,
        a.batchNumber,
        item.discountPercentage,
        a.discountPercentage,
        actualBatch,
        false,
        gstRate
      );

      const qi = orderedUnitsFromAllocation(a);
      const { paid: paid_i, free: free_i } = splitSchemeAcrossAllocationPhysical(
        qi,
        O,
        lineSplit.paidQty,
        lineSplit.freeQty
      );

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
        ...((actualBatch as { nonReturnable?: boolean } | undefined)?.nonReturnable === true
          ? { nonReturnable: true as const }
          : {}),
      };
    });

    const totalFreeQuantity = lineSplit.freeQty;

    const lineAfterBatches = applyDefaultDiscountToFulfillmentLine(
      {
        ...item,
        batchAllocations: processedAllocations,
        originalQuantity: totalAllocated < requiredQuantity ? requiredQuantity : item.originalQuantity || item.quantity,
        quantity: lineSplit.paidQty,
        freeQuantity: totalFreeQuantity,
        batchNumber: validAllocations[0].batchNumber,
        batchExpiryDate: validAllocations[0].expiryDate,
        price: validAllocations.length === 1 ? (processedAllocations[0].purchasePrice || 0) : 0,
        mrp: validAllocations.length === 1 ? validAllocations[0].mrp : undefined,
        gstRate: defaultGstRate,
        discountManuallySet: false,
        verified: true,
        qtyAdjustedNeedsBatch: undefined,
      },
      purchaseDiscountLookup,
      (batchNumber) => findStockBatch(medicine, batchNumber),
      defaultGstRate
    );

    markFulfillmentDirty();
    setFulfillmentData((prev) => {
      const newMedicines = [...prev.medicines];
      newMedicines[itemIndex] = lineAfterBatches;
      return { ...prev, medicines: newMedicines };
    });
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
      markFulfillmentDirty();
      setFulfillmentData({ ...fulfillmentData, medicines: newMedicines });
    }
  };

  const handleLineDiscountChange = (itemIndex: number, raw: string, batchIdx?: number) => {
    const parsed = raw === '' ? 0 : parseFloat(raw);
    const value = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;

    markFulfillmentDirty();
    setFulfillmentData((prev) => {
      const medicines = [...prev.medicines];
      const item = { ...medicines[itemIndex] };

      if (batchIdx !== undefined && item.batchAllocations?.length) {
        const allocs = item.batchAllocations.map((a: any, i: number) =>
          i === batchIdx ? { ...a, discountPercentage: value } : a
        );
        item.batchAllocations = allocs;
        item.discountPercentage = value;
      } else {
        item.discountPercentage = value;
        if (item.batchAllocations?.length) {
          item.batchAllocations = item.batchAllocations.map((a: any) => ({
            ...a,
            discountPercentage: value,
          }));
        }
      }

      item.discountManuallySet = true;
      medicines[itemIndex] = item;
      return { ...prev, medicines };
    });
  };

  const handleAdjustOrderedQuantity = async (itemIndex: number, nextPhysicalO: number) => {
    if (!order || order.status !== 'Pending') return;
    const item = fulfillmentData.medicines[itemIndex];
    if (!item || (item as { lineType?: string }).lineType === 'product_demand') return;

    const next = Math.max(1, Math.floor(Number(nextPhysicalO) || 0));
    const current = getOrderedPhysicalQty(item);
    if (next === current) return;

    const updatedLine = {
      ...item,
      originalQuantity: next,
      quantity: next,
      freeQuantity: 0,
      batchAllocations: undefined,
      batchNumber: undefined,
      verified: false,
      scannedQRCode: '',
      batchExpiryDate: undefined,
      discountManuallySet: false,
      nonReturnable: undefined,
      qtyAdjustedNeedsBatch: true,
    };

    const newMedicines = [...fulfillmentData.medicines];
    newMedicines[itemIndex] = updatedLine;
    markFulfillmentDirty();
    setFulfillmentData((prev) => ({ ...prev, medicines: newMedicines }));

    try {
      await updateOrderMedicines(order.id, newMedicines.map(toPersistedOrderMedicine));
      scheduleFulfillmentDraftSave(newMedicines);
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    } catch (err) {
      console.error('Failed to update ordered quantity:', err);
      await alert('Failed to update quantity. Please try again.', { severity: 'error' });
    }
  };

  const renderOrderedQtyControls = (item: any, itemIndex: number) => {
    const orderedQty = getOrderedPhysicalQty(item);
    const showReassignHint = item.qtyAdjustedNeedsBatch === true;
    return (
      <Box display="flex" flexDirection="column" alignItems="flex-end" gap={0.25}>
        <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.25}>
          <IconButton
            size="small"
            aria-label="Decrease quantity"
            disabled={orderedQty <= 1}
            onClick={() => void handleAdjustOrderedQuantity(itemIndex, orderedQty - 1)}
            sx={{ p: 0.25 }}
          >
            <Remove fontSize="small" />
          </IconButton>
          <TextField
            size="small"
            type="number"
            defaultValue={orderedQty}
            key={`ordered-qty-${itemIndex}-${orderedQty}`}
            onBlur={(e) => {
              const parsed = parseInt(e.target.value, 10);
              void handleAdjustOrderedQuantity(
                itemIndex,
                Number.isFinite(parsed) ? parsed : orderedQty
              );
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              (e.target as HTMLInputElement).blur();
            }}
            inputProps={{
              min: 1,
              step: 1,
              style: { textAlign: 'center', padding: '4px 4px', width: 44 },
            }}
            sx={{ width: 64, '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
          />
          <IconButton
            size="small"
            aria-label="Increase quantity"
            onClick={() => void handleAdjustOrderedQuantity(itemIndex, orderedQty + 1)}
            sx={{ p: 0.25 }}
          >
            <Add fontSize="small" />
          </IconButton>
        </Box>
        {showReassignHint ? (
          <Typography variant="caption" color="warning.main" sx={{ lineHeight: 1.2 }}>
            Re-assign batches
          </Typography>
        ) : null}
      </Box>
    );
  };

  const renderDiscPctCell = (
    item: any,
    itemIndex: number,
    allocation?: any,
    batchIdx?: number
  ) => {
    const med = medicines?.find((m) => m.id === item.medicineId);
    const batchNumber =
      allocation?.batchNumber ?? item.batchNumber ?? item.batchAllocations?.[0]?.batchNumber;
    const batch = batchNumber ? findStockBatch(med, batchNumber) : undefined;

    const gstRateForDisc =
      toNumber(allocation?.gstRate) || toNumber(item.gstRate) || toNumber(med?.gstRate) || 5;
    const useManualOverride = item.discountManuallySet === true;
    const lockPersisted = order?.status !== 'Pending';
    // After fulfill: show saved Disc % only (never re-derive from PI — that caused flicker).
    const discountPct = lockPersisted
      ? toNumber(
          allocation?.discountPercentage !== undefined && allocation?.discountPercentage !== null
            ? allocation.discountPercentage
            : item.discountPercentage
        )
      : batchNumber
        ? resolveFulfillmentDiscountPct(
            item.medicineId,
            batchNumber,
            item.discountPercentage,
            allocation?.discountPercentage,
            batch,
            useManualOverride,
            gstRateForDisc,
            false
          )
        : 0;

    if (order?.status === 'Pending') {
      return (
        <TextField
          size="small"
          type="number"
          value={discountPct}
          onChange={(e) => handleLineDiscountChange(itemIndex, e.target.value, batchIdx)}
          inputProps={{ min: 0, max: 100, step: 0.01, style: { textAlign: 'right', padding: '4px 6px' } }}
          sx={{ width: 76, '& .MuiInputBase-input': { fontSize: '0.75rem' } }}
          InputProps={{
            endAdornment: <InputAdornment position="end" sx={{ '& p': { fontSize: '0.7rem' } }}>%</InputAdornment>,
          }}
        />
      );
    }

    return (
      <Typography variant={allocation ? 'caption' : 'body2'}>
        {discountPct}%
      </Typography>
    );
  };

  const handleAddMedicineToMaster = async () => {
    if (!newMedicineData.name || !newMedicineData.manufacturer || !newMedicineData.category) {
      await alert('Please fill all required fields', { severity: 'warning' });
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
      await alert('Medicine added to master data successfully!', { severity: 'success' });
    } catch (error: any) {
      await alert(error.message || 'Failed to add medicine', { severity: 'error' });
    }
  };

  // Check if all items have batches assigned (either batchNumber or batchAllocations)
  const allBatchesAssigned = fulfillmentData.medicines.length > 0 && 
    fulfillmentData.medicines.every(m => 
      (m as any).lineType === 'product_demand' ||
      m.batchNumber || (m.batchAllocations && m.batchAllocations.length > 0)
    );
  
  const taxPercentage = taxPctForTotals;
  const liveBreakdown = orderTotals;
  // After fulfill, Invoice/Payment use saved money fields so PI/catalog loads cannot
  // keep shifting totals (looked like Disc % / payment flickering).
  const useStoredTotals =
    order.status !== 'Pending' && order.status !== 'Cancelled' && toNumber(order.totalAmount) > 0;
  const subTotal = useStoredTotals
    ? toNumber(order.subTotal) || liveBreakdown.subTotal
    : liveBreakdown.subTotal;
  const taxAmount = useStoredTotals
    ? toNumber(order.taxAmount) || liveBreakdown.taxAmount
    : liveBreakdown.taxAmount;
  const grandTotal = useStoredTotals ? toNumber(order.totalAmount) : liveBreakdown.grandTotal;
  const totalDiscount = liveBreakdown.totalDiscount;
  const roundoff = useStoredTotals
    ? Number((grandTotal - (subTotal - totalDiscount + taxAmount)).toFixed(4))
    : liveBreakdown.roundoff;

  /** Payment card: after fulfill always stored totalAmount (never live recompute). */
  const effectiveOrderTotal = useStoredTotals
    ? toNumber(order.totalAmount)
    : liveBreakdown.grandTotal > 0
      ? liveBreakdown.grandTotal
      : toNumber(order.totalAmount);
  const effectiveDueAmount = Math.max(0, effectiveOrderTotal - (order.paidAmount ?? 0));

  return (
    <Box>
      <Breadcrumbs items={[
        { label: 'Orders', path: '/orders' },
        { label: `Order #${formatOrderNumberForDisplay(order.id)}` }
      ]} />
      <Box display="flex" alignItems="center" mb={3}>
        <IconButton onClick={() => void guardedNavigate(navigate, '/orders')} sx={{ mr: 2 }}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h4">Order #{formatOrderNumberForDisplay(order.id)}</Typography>
        <Box sx={{ flexGrow: 1 }} />
        {hasFulfilledProductDemands && (
          <Button
            variant="outlined"
            color="primary"
            disabled={resyncingDemandLines || purchaseInvoices === undefined}
            onClick={() => void handleResyncDemandLinesFromPi()}
            sx={{ mr: 2 }}
          >
            {resyncingDemandLines ? 'Syncing PI…' : 'Sync from purchase invoice'}
          </Button>
        )}
        {canRecalculatePricing && (
          <Button
            variant="outlined"
            startIcon={recalculatingPricing ? <CircularProgress size={18} /> : <Refresh />}
            disabled={recalculatingPricing || recalculateOrderPricingMutation.isPending}
            onClick={() => void handleRecalculatePricing()}
            sx={{ mr: 2 }}
            title="Apply batch discount (or standard discount) from current inventory to line rates"
          >
            Recalculate pricing
          </Button>
        )}
        {order.status === 'Order Fulfillment' && (
          <Button
            variant="outlined"
            color="warning"
            startIcon={<Undo />}
            disabled={unfulfillOrderMutation.isPending}
            onClick={() => handleAction('unfulfill')}
            sx={{ mr: 2 }}
            title="Restore stock and return order to Pending for edits"
          >
            Un-fulfill
          </Button>
        )}
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
          title="Download the tax invoice PDF only (no email)."
          onClick={async () => {
            // Check if all items have batches assigned (either batchNumber or batchAllocations)
            const allBatchesAssigned = fulfillmentData.medicines.length > 0 && 
              fulfillmentData.medicines.every(m => 
                (m as any).lineType === 'product_demand' ||
                m.batchNumber || (m.batchAllocations && m.batchAllocations.length > 0)
              );
            
            if (!allBatchesAssigned && order.status === 'Pending') {
              await alert('Please assign batches to all items before generating invoice', { severity: 'warning' });
              return;
            }
            
            // Create order object with updated prices from fulfillmentData
            // Also include batch MFG date if available
            const invoiceOrder = {
              ...order,
              medicines: fulfillmentData.medicines.length > 0 
                ? fulfillmentData.medicines
                    .filter(
                      (m) =>
                        (m as any).lineType !== 'product_demand' &&
                        Boolean(m.medicineId) &&
                        (Boolean(m.batchNumber) ||
                          (Array.isArray(m.batchAllocations) &&
                            m.batchAllocations.some((a: any) => Boolean(a?.batchNumber))))
                    )
                    .map((m) => {
                      if ((m as any).lineType === 'product_demand') {
                        return { ...m };
                      }
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
                            const totalO = orderLineSchemeDisplayPhysical(m, schemePaidQty, schemeFreeQty);
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
              generateOrderInvoice(invoiceOrder).catch(async (err) => {
                console.error('Error generating invoice:', err);
                await alert('Failed to generate invoice. Please try again.', { severity: 'error' });
              });
            } catch (error) {
              console.error('Error generating invoice:', error);
              await alert('Failed to generate invoice. Please try again.', { severity: 'error' });
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
                  <strong>Store Name:</strong> {order.retailerName || 'N/A'}
                </Typography>
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
                  {order.paymentReviewStatus === 'pending_admin_review' ? (
                    <Chip
                      size="small"
                      label="Payment review pending"
                      color="warning"
                      sx={{ height: 20, fontSize: '0.7rem', ml: 0.5 }}
                    />
                  ) : null}
                  {order.paymentReviewStatus === 'rejected' ? (
                    <Chip
                      size="small"
                      label="Payment rejected"
                      color="error"
                      sx={{ height: 20, fontSize: '0.7rem', ml: 0.5 }}
                    />
                  ) : null}
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
                      setTrayNumber(String(order.trayNumber || trayNumber || '').trim());
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
          {fulfillmentDirty && order.status === 'Pending' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Fulfillment in progress — batch assignments are saved automatically and will be restored
              when you return. Refreshing the page or navigating away will ask you to confirm first.
            </Alert>
          )}
          {batchStockConflicts.length > 0 && order.status === 'Pending' && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Batch assignments may be stale — stock conflict with other pending orders
              </Typography>
              {batchStockConflicts.map((c) => (
                <Typography key={`${c.medicineId}:${c.batchNumber}`} variant="body2" sx={{ mb: 0.5 }}>
                  {c.medicineName} / {c.batchNumber}: {c.allocatedOnThisOrder} allocated, only{' '}
                  {c.effectiveAvailable} available ({c.stockQuantity} in stock, {c.reservedElsewhere}{' '}
                  reserved elsewhere). Re-assign batches before fulfilling.
                </Typography>
              ))}
            </Alert>
          )}
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
                    if (!item) {
                      return null;
                    }
                    if ((item as any).lineType === 'product_demand') {
                      const colSpan = order.status === 'Pending' ? 11 : 10;
                      const pid = (item as OrderMedicine).productDemandId;
                      const dDoc = pid ? demandById.get(pid) : undefined;
                      const isRejected = dDoc?.status === 'rejected';
                      const isFulfilled = dDoc?.status === 'fulfilled';
                      const strikeSx = isRejected
                        ? { textDecoration: 'line-through' as const }
                        : undefined;
                      const showFulfill =
                        Boolean(pid) && !isRejected && (!dDoc || dDoc.status === 'pending');
                      return (
                        <TableRow
                          key={`product-demand-${index}`}
                          sx={{
                            bgcolor: isRejected ? 'action.hover' : 'rgba(255, 152, 0, 0.08)',
                            opacity: isRejected ? 0.88 : 1,
                            color: isRejected ? 'text.secondary' : 'inherit',
                          }}
                        >
                          <TableCell
                            colSpan={colSpan}
                            sx={isRejected ? { color: 'text.secondary' } : undefined}
                          >
                            <Box display="flex" alignItems="flex-start" flexWrap="wrap" sx={{ gap: 1 }}>
                              <ProductDemandImage
                                imageUrl={
                                  dDoc?.imageUrl ||
                                  (item as OrderMedicine).imageUrl
                                }
                                alt={item.name}
                                size={64}
                              />
                              <Box flex={1} minWidth={0}>
                                <Box display="flex" alignItems="center" flexWrap="wrap" sx={{ gap: 1 }}>
                                  <Chip
                                    size="small"
                                    label={
                                      isRejected ? 'Rejected' : isFulfilled ? 'Fulfilled' : 'Product request'
                                    }
                                    color={isRejected ? 'default' : isFulfilled ? 'success' : 'warning'}
                                    variant="outlined"
                                  />
                                  <Typography variant="body2" fontWeight="bold" sx={strikeSx}>
                                    {item.name}
                                  </Typography>
                                </Box>
                            <Typography
                              variant="caption"
                              color="textSecondary"
                              display="block"
                              sx={{ mt: 0.5, ...strikeSx }}
                            >
                              {(item as any).manufacturerName || ''}
                              {' · '}
                              Qty {item.quantity}
                              {(item as any).requestedUnit ? ` ${(item as any).requestedUnit}` : ''}
                            </Typography>
                            {(item as any).notes ? (
                              <Typography
                                variant="caption"
                                color="textSecondary"
                                display="block"
                                sx={strikeSx}
                              >
                                Notes: {(item as any).notes}
                              </Typography>
                            ) : null}
                            {isRejected ? (
                              <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 0.5 }}>
                                This product request was not supplied.
                                {dDoc?.rejectionReason
                                  ? ` Reason: ${dDoc.rejectionReason}`
                                  : ''}
                              </Typography>
                            ) : !isFulfilled ? (
                              <Typography
                                variant="caption"
                                color="textSecondary"
                                sx={{ mt: 0.5 }}
                                display="block"
                              >
                                No inventory batch on this line — map the product in Product requests when ready.
                              </Typography>
                            ) : null}
                            {showFulfill ? (
                              <Button
                                size="small"
                                variant="contained"
                                color="warning"
                                sx={{ mt: 1 }}
                                onClick={() => {
                                  markFulfillmentDirty();
                                  void persistFulfillmentDraft(fulfillmentData.medicines).finally(() => {
                                    allowNextNavigation();
                                    navigate(
                                      `/product-demands?demandId=${encodeURIComponent(
                                        (item as OrderMedicine).productDemandId!
                                      )}&returnTo=${encodeURIComponent(`/orders/${order.id}`)}`
                                    );
                                  });
                                }}
                              >
                                Fulfill request
                              </Button>
                            ) : null}
                              </Box>
                            </Box>
                          </TableCell>
                        </TableRow>
                      );
                    }
                    if (!item.medicineId) {
                      return null;
                    }

                    // If item has multiple batch allocations, show each batch separately
                    if (item.batchAllocations && item.batchAllocations.length > 1) {
                      const medForLine = medicines?.find((m) => m.id === item.medicineId);
                      const lineInvoiceAmt = orderLineTaxableBeforeDiscount(
                        item,
                        medForLine,
                        taxPercentage,
                        purchaseDiscountLookup,
                        { lockPersistedDiscount: order.status !== 'Pending' }
                      );
                      const econLine = orderLineInvoiceEconomics(
                        item,
                        medForLine,
                        taxPercentage,
                        purchaseDiscountLookup,
                        { lockPersistedDiscount: order.status !== 'Pending' }
                      );
                      const sumAllocQtyForLine = item.batchAllocations.reduce(
                        (s: number, a: any) => s + toNumber(a.quantity),
                        0
                      );
                      const invoiceAmtDen =
                        econLine.paidQty > 0 ? econLine.paidQty : sumAllocQtyForLine > 0 ? sumAllocQtyForLine : 1;
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
                      const physicalSum = orderLineSchemeDisplayPhysical(item, schemePLine, schemeFLine);
                      const lineDisplay = schemeOrderLineDisplayTotals(
                        physicalSum,
                        schemePLine,
                        schemeFLine
                      );
                      const paidQtyForLine = lineDisplay.billQty;
                      const physicalQtyForLine = lineDisplay.totalQty;
                      const schemeLabels = getSchemeLabels(item);
                      const fromAllocsSumForWeights = item.batchAllocations.reduce(
                        (s: number, a: any) => s + orderedUnitsFromAllocation(a),
                        0
                      );
                      
                      return (
                        <React.Fragment key={item.medicineId || index}>
                          {/* Medicine Header Row */}
                          <TableRow sx={{ bgcolor: item.verified ? 'rgba(76, 175, 80, 0.12)' : 'rgba(0, 0, 0, 0.04)' }}>
                            <TableCell colSpan={2}>
                              <Typography variant="body2" fontWeight="bold">{item.name || 'Unknown'}</Typography>
                              {item.notes ? (
                                <Typography variant="caption" color="textSecondary" display="block">
                                  Remark: {item.notes}
                                </Typography>
                              ) : null}
                              <Typography variant="caption" color="textSecondary">
                                {item.batchAllocations.length} Batch{item.batchAllocations.length > 1 ? 'es' : ''} allocated
                                {item.scannedQRCode && ` | Scanned: ${item.scannedQRCode}`}
                              </Typography>
                              {lineUsesConflictingBatch(item, batchConflictKeys) && (
                                <Chip
                                  label="Stock conflict — re-assign batches"
                                  size="small"
                                  color="warning"
                                  sx={{ mt: 0.5, height: 20, fontSize: '0.7rem' }}
                                />
                              )}
                            </TableCell>
                            <TableCell align="right">
                              {order.status === 'Pending'
                                ? renderOrderedQtyControls(item, index)
                                : (
                              <Typography variant="body2" fontWeight="medium">
                                {formatSchemeQty(paidQtyForLine)}
                              </Typography>
                                )}
                            </TableCell>
                            <TableCell align="right">
                              <Box>
                                <Typography variant="body2">
                                  {lineDisplay.freeQty > 0 ? formatSchemeQty(lineDisplay.freeQty) : '-'}
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
                                {formatSchemeQty(physicalQtyForLine)}
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
                            const stockBatch = findStockBatch(medForLine, allocation.batchNumber);
                            const batchPhysical = orderedUnitsFromAllocation(allocation);
                            const w =
                              fromAllocsSumForWeights > 0
                                ? batchPhysical / fromAllocsSumForWeights
                                : 0;
                            const batchQty = lineDisplay.billQty * w;
                            const batchFree = lineDisplay.freeQty * w;
                            const batchMRP =
                              toNumber(allocation.mrp) ||
                              toNumber(stockBatch?.mrp);
                            const gstRate =
                              toNumber(allocation.gstRate) ||
                              toNumber(item.gstRate) ||
                              toNumber((stockBatch as any)?.gstRate) ||
                              taxPercentage ||
                              5;
                            let batchPurchasePrice = toNumber(allocation.purchasePrice);
                            if (batchPurchasePrice <= 0) {
                              batchPurchasePrice = toNumber(stockBatch?.purchasePrice);
                            }
                            if (batchPurchasePrice <= 0 && batchMRP > 0) {
                              batchPurchasePrice = unitPriceFromBatch(
                                toSellDiscountBatch(
                                  stockBatch,
                                  allocation.batchNumber,
                                  batchMRP,
                                  gstRate
                                ),
                                gstRate,
                                {
                                  medicineId: item.medicineId,
                                  purchaseLookup: purchaseDiscountLookup,
                                }
                              );
                            }

                            const batchTotal =
                              paidQtyForLine > 0
                                ? lineInvoiceAmt * (batchQty / paidQtyForLine)
                                : lineInvoiceAmt * (batchPhysical / (physicalQtyForLine || 1));
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
                                    {allocation.expiryDate ? formatExpiryMmYyyy(allocation.expiryDate) ?? '-' : '-'}
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
                                  <Typography variant="caption">{formatSchemeQty(batchPhysical)}</Typography>
                                </TableCell>
                                <TableCell align="right">
                                  <Typography variant="caption">
                                    {batchMRP > 0 ? `₹${batchMRP.toFixed(2)}` : '-'}
                                  </Typography>
                                </TableCell>
                                <TableCell align="right">
                                  <Typography variant="caption" fontWeight="medium">₹{batchPurchasePrice.toFixed(2)}</Typography>
                                </TableCell>
                                <TableCell align="right">
                                  <Typography variant="caption">{gstRate}%</Typography>
                                </TableCell>
                                <TableCell align="right">
                                  {renderDiscPctCell(item, index, allocation, batchIdx)}
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
                    let schemePS: number | undefined;
                    let schemeFS: number | undefined;
                    if (singleAlloc != null) {
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
                    const totalOSingle = orderLineSchemeDisplayPhysical(item, schemePS, schemeFS);
                    const singleLineDisplay = schemeOrderLineDisplayTotals(
                      totalOSingle,
                      schemePS,
                      schemeFS
                    );
                    const paidForDisplay = singleLineDisplay.billQty;
                    const physicalForDisplay = singleLineDisplay.totalQty;
                    const lineEcon = orderLineInvoiceEconomics(
                      item,
                      medSingle,
                      taxPercentage,
                      purchaseDiscountLookup,
                      { lockPersistedDiscount: order.status !== 'Pending' }
                    );
                    const fallbackBatchMrp = toNumber(
                      medSingle?.stockBatches?.find((b: any) => toNumber(b?.mrp) > 0)?.mrp
                    );
                    const displayMrp =
                      toNumber(item.mrp) ||
                      toNumber(singleAlloc?.mrp) ||
                      toNumber(medSingle?.mrp) ||
                      fallbackBatchMrp;
                    const displayUnitPrice = lineEcon.unitPrice;
                    const hasLinePricing = displayUnitPrice > 0 || displayMrp > 0;
                    const hasAssignedBatch =
                      Boolean(item.batchNumber) ||
                      Boolean(item.batchAllocations && item.batchAllocations.length > 0);
                    const canShowPricingColumns = order.status !== 'Pending' || hasAssignedBatch;
                    const displayGstRate =
                      (item.batchAllocations && item.batchAllocations.length === 1
                        ? toNumber(item.batchAllocations[0].gstRate)
                        : 0) ||
                      toNumber(item.gstRate) ||
                      toNumber(lineEcon.gstRate) ||
                      toNumber(taxPercentage) ||
                      5;
                    const batchNumberForDisc =
                      item.batchAllocations?.length === 1
                        ? item.batchAllocations[0].batchNumber
                        : item.batchNumber;
                    const batchForDisc = batchNumberForDisc
                      ? findStockBatch(medSingle, batchNumberForDisc)
                      : undefined;
                    const displayDiscountPct = batchNumberForDisc
                      ? resolveOrderLineDisplayDiscountPct({
                          itemDiscount: item.discountPercentage,
                          allocationDiscount: item.batchAllocations?.[0]?.discountPercentage,
                          medicineId: item.medicineId,
                          batchNumber: batchNumberForDisc,
                          purchaseLookup: purchaseDiscountLookup,
                          batch: toSellDiscountBatch(
                            batchForDisc,
                            batchNumberForDisc,
                            toNumber(item.batchAllocations?.[0]?.mrp) || toNumber(item.mrp),
                            displayGstRate
                          ),
                          gstRate: displayGstRate,
                          discountManuallySet: item.discountManuallySet === true,
                          lockPersistedDiscount: order.status !== 'Pending',
                        })
                      : toNumber(item.discountPercentage);
                    return (
                      <TableRow key={item.medicineId || index} sx={{ bgcolor: item.verified ? 'rgba(76, 175, 80, 0.08)' : 'inherit' }}>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">{item.name || 'Unknown'}</Typography>
                          {item.notes ? (
                            <Typography variant="caption" color="textSecondary" display="block">
                              Remark: {item.notes}
                            </Typography>
                          ) : null}
                          <Typography variant="caption" color="textSecondary">
                            {item.batchExpiryDate && (
                              <>Exp: {formatExpiryMmYyyy(item.batchExpiryDate)}</>
                            )}
                            {item.scannedQRCode && (
                              <>
                                {item.batchExpiryDate && ' | '}
                                Scanned: {item.scannedQRCode}
                              </>
                            )}
                          </Typography>
                          {lineUsesConflictingBatch(item, batchConflictKeys) && (
                            <Chip
                              label="Stock conflict — re-assign batches"
                              size="small"
                              color="warning"
                              sx={{ mt: 0.5, height: 20, fontSize: '0.7rem' }}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {item.batchAllocations && item.batchAllocations.length === 1
                            ? item.batchAllocations[0].batchNumber
                            : item.batchNumber
                              ? item.batchNumber
                              : (
                                  <Typography variant="caption" color="textSecondary">
                                    Not assigned
                                  </Typography>
                                )}
                        </TableCell>
                        <TableCell align="right">
                          {order.status === 'Pending' ? (
                            renderOrderedQtyControls(item, index)
                          ) : item.originalQuantity && item.originalQuantity !== item.quantity ? (
                            <Box>
                              <Typography variant="body2" fontWeight="medium">
                                {formatSchemeQty(paidForDisplay)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" display="block">
                                Line strips fulfilled: {item.quantity} / {item.originalQuantity}
                              </Typography>
                              <Chip
                                label="Partial"
                                size="small"
                                color="warning"
                                sx={{ mt: 0.5 }}
                              />
                            </Box>
                          ) : (
                            formatSchemeQty(paidForDisplay)
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Box>
                            <Typography variant="body2">
                              {singleLineDisplay.freeQty > 0 ? formatSchemeQty(singleLineDisplay.freeQty) : '-'}
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
                            {formatSchemeQty(physicalForDisplay)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {canShowPricingColumns && item.batchAllocations && item.batchAllocations.length === 1
                            ? (item.batchAllocations[0].mrp ? `₹${item.batchAllocations[0].mrp.toFixed(2)}` : '-')
                            : canShowPricingColumns && displayMrp > 0
                              ? `₹${displayMrp.toFixed(2)}`
                              : <Typography variant="caption" color="textSecondary">-</Typography>
                          }
                        </TableCell>
                        <TableCell align="right">
                          {canShowPricingColumns && item.batchAllocations && item.batchAllocations.length === 1
                            ? (() => {
                                const alloc = item.batchAllocations[0];
                                const mrp = alloc.mrp || 0;
                                const gstRate = alloc.gstRate || item.gstRate || 5;
                                const stockBatch = medSingle?.stockBatches?.find(
                                  (b) => b.batchNumber === alloc.batchNumber
                                );
                                let purchasePrice = toNumber(alloc.purchasePrice);
                                if (purchasePrice <= 0 && mrp > 0) {
                                  purchasePrice = unitPriceFromBatch(
                                    {
                                      mrp,
                                      purchasePrice: stockBatch?.purchasePrice,
                                      discountPercentage: stockBatch?.discountPercentage,
                                      batchNumber: alloc.batchNumber,
                                    },
                                    gstRate,
                                    {
                                      medicineId: item.medicineId,
                                      purchaseLookup: purchaseDiscountLookup,
                                    }
                                  );
                                }
                                return `₹${purchasePrice.toFixed(2)}`;
                              })()
                            : canShowPricingColumns && (item.batchNumber || (item.batchAllocations && item.batchAllocations.length > 0))
                              ? (() => {
                                  const mrp = item.mrp || 0;
                                  const gstRate = item.gstRate || 5;
                                  const stockBatch = medSingle?.stockBatches?.find(
                                    (b) => b.batchNumber === item.batchNumber
                                  );
                                  let purchasePrice = toNumber(item.price);
                                  if (purchasePrice <= 0 && mrp > 0) {
                                    purchasePrice = unitPriceFromBatch(
                                      {
                                        mrp,
                                        purchasePrice: stockBatch?.purchasePrice,
                                        discountPercentage: stockBatch?.discountPercentage,
                                        batchNumber: item.batchNumber,
                                      },
                                      gstRate,
                                      {
                                        medicineId: item.medicineId,
                                        purchaseLookup: purchaseDiscountLookup,
                                      }
                                    );
                                  }
                                  return `₹${purchasePrice.toFixed(2)}`;
                                })()
                              : canShowPricingColumns && hasLinePricing
                                ? `₹${displayUnitPrice.toFixed(2)}`
                                : <Typography variant="caption" color="textSecondary">-</Typography>
                          }
                        </TableCell>
                        <TableCell align="right">
                          {canShowPricingColumns
                            ? `${displayGstRate}%`
                            : <Typography variant="caption" color="textSecondary">-</Typography>}
                        </TableCell>
                        <TableCell align="right">
                          {canShowPricingColumns && item.batchAllocations && item.batchAllocations.length === 1
                            ? renderDiscPctCell(item, index, item.batchAllocations[0], 0)
                            : canShowPricingColumns && (item.batchNumber || (item.batchAllocations && item.batchAllocations.length > 0))
                              ? renderDiscPctCell(item, index)
                              : canShowPricingColumns && batchNumberForDisc
                                ? `${displayDiscountPct.toFixed(2)}%`
                                : <Typography variant="caption" color="textSecondary">0%</Typography>
                          }
                        </TableCell>
                        <TableCell align="right">
                          {canShowPricingColumns && (item.batchNumber || (item.batchAllocations && item.batchAllocations.length > 0) || hasLinePricing)
                            ? `₹${orderLineAmountAfterDiscount(item, medSingle, taxPercentage, purchaseDiscountLookup, { lockPersistedDiscount: order.status !== 'Pending' }).toFixed(2)}`
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
                  disabled={
                    batchStockConflicts.length > 0 ||
                    !fulfillmentData.medicines.every(
                      (m) => (m as any).lineType === 'product_demand' || m.verified
                    )
                  }
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
              <Typography fontWeight="medium">#{formatOrderNumberForDisplay(order.id)}</Typography>
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
              <Typography color="textSecondary">Tax (GST):</Typography>
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
                    <Typography variant="body2" fontWeight="bold">₹{effectiveOrderTotal.toFixed(2)}</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" mb={0.5}>
                    <Typography variant="body2" color="textSecondary">Paid</Typography>
                    <Typography variant="body2" color="success.main">₹{(order.paidAmount ?? 0).toFixed(2)}</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between">
                    <Typography variant="body2" color="textSecondary">Due</Typography>
                    <Typography variant="body2" fontWeight="bold" color={effectiveDueAmount > 0 ? 'error.main' : 'success.main'}>
                      ₹{effectiveDueAmount.toFixed(2)}
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
                    {order.paymentReviewStatus === 'pending_admin_review' ? (
                      <Alert severity="warning" sx={{ mb: 1 }}>
                        Retailer payment is pending approval. Open{' '}
                        <Button
                          size="small"
                          color="inherit"
                          sx={{ textTransform: 'none', p: 0, minWidth: 0, verticalAlign: 'baseline' }}
                          onClick={() => navigate('/payment-requests')}
                        >
                          Payment requests
                        </Button>{' '}
                        to approve or reject — payment is applied only after approval.
                      </Alert>
                    ) : null}
                    {(order.paymentStatus === 'Unpaid' || !order.paymentStatus || order.paymentStatus === 'Partial') ? (
                      <Button
                        fullWidth
                        variant="contained"
                        color="primary"
                        startIcon={<Payment />}
                        disabled={order.paymentReviewStatus === 'pending_admin_review'}
                        onClick={() => {
                          const total = effectiveOrderTotal;
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
                          totalAmount: effectiveOrderTotal,
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
              {restoreCancelledOrderStockMutation.isPending && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Restoring inventory stock…
                </Typography>
              )}
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
              unfulfillOrderMutation.isPending ||
              dispatchOrderMutation.isPending ||
              deliverOrderMutation.isPending ||
              cancelOrderMutation.isPending
            }
          >
            {confirmDialog.action === 'cancel'
              ? 'Confirm Cancellation'
              : confirmDialog.action === 'unfulfill'
                ? 'Un-fulfill'
                : 'Proceed'}
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
        PaperProps={{ sx: { overflow: 'visible' } }}
      >
        <DialogTitle>
          {order?.status === 'Pending' ? 'Order Information' : 'Order Fulfilled Successfully'}
        </DialogTitle>
        <DialogContent sx={{ overflow: 'visible' }}>
          <Box sx={{ mt: 2, overflow: 'visible' }}>
            {order?.status === 'Pending' ? (
              <Alert severity="info" sx={{ mb: 2 }}>
                Please enter the tray number and processor name for this pending order.
              </Alert>
            ) : (
              <Alert severity="success" sx={{ mb: 2 }}>
                Order has been fulfilled successfully. Please enter the tray number and processor name.
              </Alert>
            )}
            <TextField
              select
              fullWidth
              margin="normal"
              label="Tray Number"
              value={String(trayNumber ?? '').trim()}
              onChange={(e) => setTrayNumber(String(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTrayNumber();
              }}
              SelectProps={{ native: true }}
              InputLabelProps={{ shrink: true }}
              helperText={
                traysQueryError
                  ? undefined
                  : traysFetching
                    ? 'Loading trays…'
                    : !(trays?.length ?? 0)
                      ? 'Add tray numbers under Fulfillment setup → Tray Numbers.'
                      : availableTrays.length === 0
                        ? 'Every tray is on another Pending or Order Fulfillment order. Trays become available again after those orders are dispatched (In Transit or later).'
                        : 'Only trays that are free or already on this order are listed. Trays on dispatched orders are available again.'
              }
            >
              <option value="">Select tray (optional)</option>
              {String(trayNumber ?? '').trim() &&
                !availableTrays.some((t) => String(t.name ?? '').trim() === String(trayNumber ?? '').trim()) && (
                  <option key="__orphan_tray" value={String(trayNumber).trim()}>
                    {String(trayNumber).trim()} (current)
                  </option>
                )}
              {availableTrays.map((tray) => {
                const name = String(tray.name ?? '').trim();
                return (
                  <option key={tray.id} value={name}>
                    {name}
                  </option>
                );
              })}
            </TextField>
            <FormControl fullWidth margin="normal">
              <InputLabel>Processed By</InputLabel>
              <Select
                value={processedBy}
                label="Processed By"
                onChange={(e) => setProcessedBy(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSaveTrayNumber()}
                MenuProps={{
                  disablePortal: true,
                  PaperProps: { sx: { maxHeight: 280 } },
                }}
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
                Add more operators in Fulfillment setup → Operators
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
                inputProps: { min: 0, max: effectiveOrderTotal, step: 0.01 }
              }}
              helperText={`Order total: ₹${effectiveOrderTotal.toFixed(2)}`}
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
                onClick={() => setPaymentDialog({ ...paymentDialog, amount: String(effectiveOrderTotal), isFull: true })}
              >
                Full amount
              </Button>
              <Button
                fullWidth
                variant="outlined"
                size="small"
                onClick={() => setPaymentDialog({ ...paymentDialog, amount: String(effectiveOrderTotal * 0.5), isFull: false })}
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
              parseFloat(paymentDialog.amount) > effectiveOrderTotal ||
              updatePaymentStatusMutation.isPending
            }
            onClick={() => {
              const amount = parseFloat(paymentDialog.amount) || 0;
              const total = effectiveOrderTotal;
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
              if (!item || (item as any).lineType === 'product_demand' || !item.medicineId) {
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
                b.quantity > 0 && expiryIsAfterNow(b.expiryDate)
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
                        (!batch.expiryDate || expiryIsAfterNow(batch.expiryDate));
                      return (
                        <MenuItem key={batch.id} value={batch.batchNumber} disabled={!isAvailable}>
                          <Box>
                            <Typography variant="body2" fontWeight="medium">
                              Batch: {batch.batchNumber}
                            </Typography>
                            <Typography variant="caption" color={isAvailable ? "textSecondary" : "error"}>
                              Qty: {batch.quantity} | 
                              Expiry: {formatExpiryMmYyyy(batch.expiryDate) ?? 'N/A'}
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
                    <TableCell align="right">Available (this order)</TableCell>
                    <TableCell align="right">Allocate</TableCell>
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">MRP</TableCell>
                    <TableCell align="right">Purchase Disc %</TableCell>
                    <TableCell align="center">Scheme</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {batchAllocations.map((allocation, idx) => (
                    <TableRow key={allocation.batchNumber}>
                      <TableCell>{allocation.batchNumber}</TableCell>
                      <TableCell>
                        {allocation.expiryDate ? formatExpiryMmYyyy(allocation.expiryDate) ?? '-' : '-'}
                      </TableCell>
                      <TableCell align="right">
                        <Box display="flex" flexDirection="column" alignItems="flex-end" gap={0.5}>
                          <Chip
                            label={allocation.availableQuantity}
                            size="small"
                            color={allocation.availableQuantity > 0 ? 'success' : 'error'}
                          />
                          {(allocation.reservedElsewhere ?? 0) > 0 && (
                            <Typography variant="caption" color="text.secondary">
                              {allocation.stockQuantity ?? allocation.availableQuantity} in stock,{' '}
                              {allocation.reservedElsewhere} reserved elsewhere
                            </Typography>
                          )}
                        </Box>
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
                      <TableCell align="right">
                        {(() => {
                          const med = medicines?.find((m) => m.id === batchAllocationDialog.medicineId);
                          const stockBatch = findStockBatch(med, allocation.batchNumber);
                          const piDisc = toNumber(stockBatch?.discountPercentage);
                          return `${piDisc.toFixed(2)}%`;
                        })()}
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


