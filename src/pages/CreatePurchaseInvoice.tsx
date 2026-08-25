import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Autocomplete,
  Alert,
  Chip,
  Divider,
  Card,
  CardContent,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  ArrowBack,
  Add,
  Delete,
  Save,
  Search,
  QrCode,
  Edit,
} from '@mui/icons-material';
import { useVendors } from '../hooks/useVendors';
import { useCreateMedicine, useMedicine } from '../hooks/useInventory';
import { useCreatePurchaseInvoice, usePurchaseInvoice, useUpdatePurchaseInvoiceWithStock, useVendorLastPurchases } from '../hooks/usePurchaseInvoices';
import { RetailerLastSchemeHint } from '../components/RetailerLastSchemeHint';
import { PurchaseInvoiceItem, Medicine, Vendor, StockBatch } from '../types';
import { format } from 'date-fns';
import { auth } from '../services/firebase';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import QRCode from 'qrcode';
import {
  resolveMedicineAfterPickerSelection,
  findMedicineByExactName,
} from '../services/medicineSearch';
import { useMedicineSearch } from '../hooks/useMedicineSearch';
import {
  useMedicineResolutionContext,
  useGroupedMedicineResolveOptions,
} from '../hooks/useMedicineResolutionContext';
import {
  renderMedicineResolveGroup,
  renderMedicineResolveOption,
} from '../components/MedicineResolveAutocomplete';
import type { MedicineResolveOption } from '../services/medicineResolution';
import { getTodayDateStringIST, getYearIST } from '../utils/dateTime';
import { formatPurchaseSchemeLabel } from '../utils/purchaseSchemeLabel';
import { getMedicinePickerLabel } from '../utils/medicinePickerLabel';
import { normalizeFirestoreDate } from '../services/inventory';
import { useAppDialog } from '../context/AppDialogProvider';
import { VendorFormDialog } from '../components/VendorFormDialog';
import { purchaseItemStockBatchNumber } from '../utils/purchaseInvoiceBatch';

const EXPIRY_MM_YY_HELPER = 'Format: MM/YY (e.g., 12/25)';

function formatExpiryMmYy(expiryDate: Date | unknown): string {
  const d = normalizeFirestoreDate(expiryDate as Parameters<typeof normalizeFirestoreDate>[0]);
  if (!d) return '';
  return format(d, 'MM/yy');
}

type ExpiryParseResult =
  | { ok: true; month: number; year: number }
  | { ok: false; error: string };

function parseExpiryMmYy(value: string): ExpiryParseResult {
  const parts = value.trim().split('/');
  if (parts.length !== 2) {
    return { ok: false, error: 'Format must be MM/YY (e.g., 12/25)' };
  }
  const monthStr = parts[0].trim();
  const yearStr = parts[1].trim();
  if (monthStr.length !== 2) {
    return { ok: false, error: 'Month must be 2 digits (e.g., 01, 02, ..., 12)' };
  }
  const month = parseInt(monthStr, 10);
  if (isNaN(month) || month < 1 || month > 12) {
    return { ok: false, error: 'Month must be between 01 and 12' };
  }
  if (yearStr.length !== 2) {
    return { ok: false, error: 'Year must be 2 digits (e.g., 25)' };
  }
  const yy = parseInt(yearStr, 10);
  if (isNaN(yy)) {
    return { ok: false, error: 'Year must be a valid number' };
  }
  const year = 2000 + yy;
  const currentYear = getYearIST();
  // Allow past years (editing existing / near-expired stock) and up to +20 years ahead.
  if (year < currentYear - 10 || year > currentYear + 20) {
    return {
      ok: false,
      error: `Year must be between ${currentYear - 10} and ${currentYear + 20}`,
    };
  }
  return { ok: true, month, year };
}

export const CreatePurchaseInvoicePage: React.FC = () => {
  const navigate = useNavigate();
  const { invoiceId: editInvoiceId } = useParams<{ invoiceId?: string }>();
  const isEditMode = Boolean(editInvoiceId);
  const { data: existingInvoice, isLoading: existingLoading } = usePurchaseInvoice(editInvoiceId || '');
  const { data: vendors } = useVendors();
  const createMedicineMutation = useCreateMedicine();
  const createInvoiceMutation = useCreatePurchaseInvoice();
  const updateInvoiceMutation = useUpdatePurchaseInvoiceWithStock();
  const { alert, confirm, prompt } = useAppDialog();
  const hydratedEditRef = useRef<string | null>(null);

  /** Session cache of medicines touched this visit — never load the full catalog. */
  const [medicineCache, setMedicineCache] = useState<Record<string, Medicine>>({});
  const rememberMedicines = useCallback((rows: Medicine[]) => {
    if (!rows.length) return;
    setMedicineCache((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const m of rows) {
        if (!m?.id) continue;
        if (!next[m.id]) {
          next[m.id] = m;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);
  const rememberMedicine = useCallback(
    (m: Medicine | null | undefined) => {
      if (m?.id) rememberMedicines([m]);
    },
    [rememberMedicines]
  );

  const [invoiceData, setInvoiceData] = useState({
    invoiceNumber: '',
    vendorId: '',
    invoiceDate: getTodayDateStringIST(),
    notes: '',
  });
  const { lastPurchaseByMedicineId } = useVendorLastPurchases(
    undefined,
    undefined,
    { enabled: true }
  );

  const [items, setItems] = useState<PurchaseInvoiceItem[]>([]);
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [addMedicineDialog, setAddMedicineDialog] = useState(false);
  const [addVendorDialog, setAddVendorDialog] = useState(false);
  /** Keeps a just-created vendor selected even before the vendors query refreshes. */
  const [justCreatedVendor, setJustCreatedVendor] = useState<Vendor | null>(null);
  const emptyNewMedicine = {
    name: '',
    code: '',
    type: '', // Displayed as "Type" but stored as category
    packaging: '',
    manufacturer: '',
    gstRate: '5',
  };
  const [newMedicineData, setNewMedicineData] = useState(emptyNewMedicine);
  const [itemDialog, setItemDialog] = useState<{ open: boolean; itemIndex: number | null }>({
    open: false,
    itemIndex: null,
  });
  const [qrCodeDialog, setQrCodeDialog] = useState<{ open: boolean; qrCode: string | null; itemName: string }>({
    open: false,
    qrCode: null,
    itemName: '',
  });
  const [currentItem, setCurrentItem] = useState<{
    medicineId?: string;
    medicineName?: string;
    batchNumber?: string;
    receivedBatchNumber?: string;
    expiryDate?: string;
    quantity?: string | number;
    freeQuantity?: string | number;
    schemePaidQty?: string | number;
    schemeFreeQty?: string | number;
    unitPrice?: string | number;
    purchasePrice?: string | number;
    mrp?: string | number;
    gstRate?: string | number;
    standardDiscount?: string | number;
    discountPercentage?: string | number;
    nonReturnable?: boolean;
    nrxDrug?: boolean;
  }>({
    medicineId: '',
    medicineName: '',
    batchNumber: '',
    receivedBatchNumber: '',
    expiryDate: '', // MM/YY format
    quantity: '',
    freeQuantity: '',
    schemePaidQty: '',
    schemeFreeQty: '',
    unitPrice: '',
    purchasePrice: '',
    mrp: '',
    gstRate: '',
    standardDiscount: '20',
    discountPercentage: '',
    nonReturnable: false,
    nrxDrug: false,
  });
  const [expiryDateError, setExpiryDateError] = useState<string>('');

  const [medicineSearchInput, setMedicineSearchInput] = useState('');
  const medicineSearchInputElRef = useRef<HTMLInputElement | null>(null);
  const invoiceBatchInputElRef = useRef<HTMLInputElement | null>(null);
  const savingInvoiceRef = useRef(false);

  // Batches for the line being edited (master list has no stockBatches).
  const { data: currentItemMedicineFull } = useMedicine(
    currentItem.medicineId ? String(currentItem.medicineId) : undefined
  );

  useEffect(() => {
    if (currentItemMedicineFull) rememberMedicine(currentItemMedicineFull);
  }, [currentItemMedicineFull, rememberMedicine]);

  const lookupMedicine = useCallback(
    (id: string | undefined | null): Medicine | undefined => {
      if (!id) return undefined;
      if (selectedMedicine?.id === id) return selectedMedicine;
      if (currentItemMedicineFull?.id === id) return currentItemMedicineFull;
      return medicineCache[id];
    },
    [medicineCache, selectedMedicine, currentItemMedicineFull]
  );

  const selectedVendor =
    (justCreatedVendor?.id === invoiceData.vendorId ? justCreatedVendor : null) ||
    vendors?.find((v) => v.id === invoiceData.vendorId) ||
    null;
  const vendorOptions = useMemo(() => {
    const list = vendors?.filter((v) => v.isActive !== false) || [];
    if (selectedVendor && !list.some((v) => v.id === selectedVendor.id)) {
      return [selectedVendor, ...list];
    }
    return list;
  }, [vendors, selectedVendor]);
  const isSavingInvoice = createInvoiceMutation.isPending || updateInvoiceMutation.isPending;

  // Prefill create form when editing an existing invoice (header stays locked).
  useEffect(() => {
    if (!isEditMode || !existingInvoice?.id) return;
    if (hydratedEditRef.current === existingInvoice.id) return;
    hydratedEditRef.current = existingInvoice.id;
    const invDate =
      existingInvoice.invoiceDate instanceof Date
        ? existingInvoice.invoiceDate
        : new Date(existingInvoice.invoiceDate);
    setInvoiceData({
      invoiceNumber: existingInvoice.invoiceNumber || '',
      vendorId: existingInvoice.vendorId || '',
      invoiceDate: getTodayDateStringIST(invDate),
      notes: existingInvoice.notes || '',
    });
    setItems(existingInvoice.items || []);
  }, [isEditMode, existingInvoice]);

  const mainSkip =
    selectedMedicine != null ? getMedicinePickerLabel(selectedMedicine) : undefined;
  const {
    medicines: medicineSearchHits,
    loading: medicineSearchLoading,
  } = useMedicineSearch(medicineSearchInput, {
    hydrate: false,
    limit: 40,
    skipQuery: mainSkip,
  });

  const { pendingMedicines, pendingDemands } = useMedicineResolutionContext();

  const purchaseMedicineOptions = useGroupedMedicineResolveOptions({
    query: medicineSearchInput,
    inventoryHits: medicineSearchHits,
    pendingMedicines,
    pendingDemands,
    selectedMedicine,
  });

  const selectedResolveOption = useMemo((): MedicineResolveOption | null => {
    if (!selectedMedicine) return null;
    return (
      purchaseMedicineOptions.find((o) => o.medicine?.id === selectedMedicine.id) || {
        id: selectedMedicine.id,
        group: 'inventory',
        groupLabel: '3 · Inventory',
        label: getMedicinePickerLabel(selectedMedicine),
        selectable: true,
        medicine: selectedMedicine,
      }
    );
  }, [selectedMedicine, purchaseMedicineOptions]);

  const {
    medicines: addMedicineSearchHits,
  } = useMedicineSearch(newMedicineData.name, {
    hydrate: false,
    limit: 40,
    enabled: addMedicineDialog,
  });

  useEffect(() => {
    rememberMedicines(medicineSearchHits);
  }, [medicineSearchHits, rememberMedicines]);

  useEffect(() => {
    rememberMedicines(pendingMedicines);
  }, [pendingMedicines, rememberMedicines]);

  useEffect(() => {
    rememberMedicines(addMedicineSearchHits);
  }, [addMedicineSearchHits, rememberMedicines]);

  useEffect(() => {
    const t = window.setTimeout(() => medicineSearchInputElRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!itemDialog.open) return;
    const t = window.setTimeout(() => invoiceBatchInputElRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [itemDialog.open]);

  const focusMedicineSearch = () => {
    window.setTimeout(() => medicineSearchInputElRef.current?.focus(), 100);
  };

  const addMedicineOptions = useMemo(() => {
    const q = newMedicineData.name.trim();
    if (q.length >= 2) {
      return addMedicineSearchHits;
    }
    return [];
  }, [newMedicineData.name, addMedicineSearchHits]);

  const calculateTotals = () => {
    // Calculate subtotal: sum of (purchasePrice * quantity) for all items
    const subTotal = items.reduce((sum, item) => {
      const quantity = item.quantity || 0;
      const purchasePrice = item.purchasePrice || 0;
      return sum + (purchasePrice * quantity);
    }, 0);

    // Calculate total discount amount: sum of discount amounts from discount percentage
    const totalDiscount = items.reduce((sum, item) => {
      const quantity = item.quantity || 0;
      const purchasePrice = item.purchasePrice || 0;
      const discountPercentage = item.discountPercentage || 0;
      
      const baseAmount = purchasePrice * quantity;
      const discountAmount = (baseAmount * discountPercentage) / 100;
      
      return sum + discountAmount;
    }, 0);

    // Calculate total tax amount: sum of GST amounts from GST rate
    const totalTax = items.reduce((sum, item) => {
      const quantity = item.quantity || 0;
      const purchasePrice = item.purchasePrice || 0;
      const discountPercentage = item.discountPercentage || 0;
      const gstRate = item.gstRate || 0;
      
      const baseAmount = purchasePrice * quantity;
      const discountAmount = (baseAmount * discountPercentage) / 100;
      const amountAfterDiscount = baseAmount - discountAmount;
      const gstAmount = (amountAfterDiscount * gstRate) / 100;
      
      return sum + gstAmount;
    }, 0);

    // Calculate total: subtotal - discount + tax
    const calculatedTotal = subTotal - totalDiscount + totalTax;
    
    // Calculate round off
    const roundoff = Math.round(calculatedTotal) - calculatedTotal;
    const grandTotal = Math.round(calculatedTotal);

    return { subTotal, totalDiscount, totalTax, roundoff, grandTotal };
  };

  const { subTotal, totalDiscount, totalTax, roundoff, grandTotal } = calculateTotals();

  const parseNumber = (value: string | number | undefined): number => {
    if (value === undefined || value === null || value === '') return 0;
    const parsed = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getCurrentItemGstRate = () => {
    const selectedMed = lookupMedicine(currentItem.medicineId);
    return selectedMed?.gstRate || parseNumber(currentItem.gstRate) || 5;
  };

  const calculatePurchasePriceFromMrpAndDiscount = (
    mrp: number,
    gstRate: number,
    standardDiscount: number
  ): number => {
    if (mrp <= 0) return 0;
    const discountedMrp = mrp * (1 - standardDiscount / 100);
    return discountedMrp / (1 + gstRate / 100);
  };

  const calculateStandardDiscountFromMrpAndPurchasePrice = (
    mrp: number,
    purchasePrice: number,
    gstRate: number
  ): number => {
    if (mrp <= 0 || purchasePrice <= 0) return 20;
    const priceWithGST = purchasePrice * (1 + gstRate / 100);
    return (1 - (priceWithGST / mrp)) * 100;
  };

  const findExistingStockBatch = (
    medicineId: string | undefined,
    batchNumber: string
  ): StockBatch | undefined => {
    const key = batchNumber.trim().toLowerCase();
    if (!medicineId || !key) return undefined;
    const medicine =
      (selectedMedicine?.id === medicineId ? selectedMedicine : undefined) ||
      (currentItemMedicineFull?.id === medicineId ? currentItemMedicineFull : undefined) ||
      lookupMedicine(medicineId);
    return medicine?.stockBatches?.find(
      (b) => String(b.batchNumber || '').trim().toLowerCase() === key
    );
  };

  const existingBatchForCurrentItem = useMemo(
    () =>
      findExistingStockBatch(
        currentItem.medicineId,
        purchaseItemStockBatchNumber({
          batchNumber: String(currentItem.batchNumber || ''),
          receivedBatchNumber: String(currentItem.receivedBatchNumber || ''),
        })
      ),
    [
      medicineCache,
      selectedMedicine,
      currentItemMedicineFull,
      currentItem.medicineId,
      currentItem.batchNumber,
      currentItem.receivedBatchNumber,
    ]
  );

  /** Fill item fields from inventory when batch already exists for this medicine (quantity unchanged). */
  const applyExistingBatchDetails = () => {
    const stockBatchNumber = purchaseItemStockBatchNumber({
      batchNumber: String(currentItem.batchNumber || ''),
      receivedBatchNumber: String(currentItem.receivedBatchNumber || ''),
    });
    if (!currentItem.medicineId || !stockBatchNumber) return;

    const batch = findExistingStockBatch(currentItem.medicineId, stockBatchNumber);
    if (!batch) return;

    const medicine = lookupMedicine(currentItem.medicineId);
    const gstRate = medicine?.gstRate || 5;
    const mrp = batch.mrp && batch.mrp > 0 ? batch.mrp : 0;
    let purchasePrice =
      batch.purchasePrice && batch.purchasePrice > 0 ? batch.purchasePrice : 0;
    const standardDiscountSeed =
      currentItem.standardDiscount !== '' && currentItem.standardDiscount !== undefined
        ? parseNumber(currentItem.standardDiscount)
        : 20;

    if (purchasePrice <= 0 && mrp > 0) {
      purchasePrice = calculatePurchasePriceFromMrpAndDiscount(mrp, gstRate, standardDiscountSeed);
    }

    const standardDiscount =
      mrp > 0 && purchasePrice > 0
        ? calculateStandardDiscountFromMrpAndPurchasePrice(mrp, purchasePrice, gstRate)
        : standardDiscountSeed;

    const batchLegacy = batch as StockBatch & { purchaseSchemeDeal?: number; purchaseSchemeFree?: number };
    const batchSchemePaid = batch.schemePaidQty ?? batchLegacy.purchaseSchemeDeal;
    const batchSchemeFree = batch.schemeFreeQty ?? batchLegacy.purchaseSchemeFree;

    const expiryStr = formatExpiryMmYy(batch.expiryDate);

    setCurrentItem((prev) => ({
      ...prev,
      expiryDate: expiryStr || prev.expiryDate,
      mrp: mrp > 0 ? String(mrp) : prev.mrp,
      purchasePrice: purchasePrice > 0 ? purchasePrice.toFixed(2) : prev.purchasePrice,
      unitPrice: purchasePrice > 0 ? purchasePrice.toFixed(2) : prev.unitPrice,
      standardDiscount: Number.isFinite(standardDiscount) ? standardDiscount.toFixed(2) : prev.standardDiscount,
      discountPercentage:
        batch.discountPercentage != null && batch.discountPercentage > 0
          ? String(batch.discountPercentage)
          : prev.discountPercentage,
      schemePaidQty:
        batchSchemePaid != null && Number(batchSchemePaid) > 0
          ? String(Math.floor(Number(batchSchemePaid)))
          : prev.schemePaidQty,
      schemeFreeQty:
        batchSchemeFree != null && Number(batchSchemeFree) > 0
          ? String(Math.floor(Number(batchSchemeFree)))
          : prev.schemeFreeQty,
      nonReturnable: batch.nonReturnable === true,
      nrxDrug: batch.nrxDrug === true,
      gstRate,
    }));
    setExpiryDateError('');
  };

  const handleAddItem = async () => {
    if (!selectedMedicine) {
      await alert('Please select a medicine', { severity: 'warning' });
      return;
    }
    setExpiryDateError(''); // Clear error when opening dialog
    setCurrentItem({
      medicineId: selectedMedicine.id,
      medicineName: selectedMedicine.name,
      batchNumber: '',
      receivedBatchNumber: '',
      expiryDate: '', // MM/YY format
      quantity: '',
      freeQuantity: '',
      schemePaidQty: '',
      schemeFreeQty: '',
      unitPrice: '',
      purchasePrice: '',
      mrp: '',
      gstRate: selectedMedicine.gstRate || 5, // Get GST rate from medicine master data
      standardDiscount: '20',
      discountPercentage: '',
      nonReturnable: false,
      nrxDrug: false,
    });
    setItemDialog({ open: true, itemIndex: null });
  };

  const generateQRCode = async (data: string): Promise<string> => {
    try {
      const qrDataUrl = await QRCode.toDataURL(data, { width: 200, margin: 1 });
      return qrDataUrl;
    } catch (error) {
      console.error('Error generating QR code:', error);
      return '';
    }
  };

  const handleSaveItem = async () => {
    const qtyRaw = currentItem.quantity;
    const qtyNum =
      typeof qtyRaw === 'number' ? qtyRaw : parseFloat(String(qtyRaw ?? '').trim());
    if (!currentItem.medicineId) {
      await alert('Medicine is missing on this line. Remove and re-add the item.', { severity: 'warning' });
      return;
    }
    if (!String(currentItem.batchNumber || '').trim()) {
      await alert('Please enter batch number.', { severity: 'warning' });
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      await alert('Please enter a valid quantity greater than 0.', { severity: 'warning' });
      return;
    }
    if (!String(currentItem.expiryDate || '').trim()) {
      await alert('Please enter expiry date (MM/YY).', { severity: 'warning' });
      return;
    }
    const expiryInput = String(currentItem.expiryDate).trim();
    const medicineId = String(currentItem.medicineId);
    const batchNumber = String(currentItem.batchNumber || '').trim();
    const priceNum =
      typeof currentItem.purchasePrice === 'number'
        ? currentItem.purchasePrice
        : parseFloat(String(currentItem.purchasePrice ?? '').trim());
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      await alert('Please enter purchase price.', { severity: 'warning' });
      return;
    }

    // Validate expiry date format
    if (expiryDateError) {
      await alert(`Expiry date error: ${expiryDateError}`, { severity: 'warning' });
      return;
    }

    // Parse expiry date from MM/YY format
    const parsedExpiry = parseExpiryMmYy(expiryInput);
    if (!parsedExpiry.ok) {
      setExpiryDateError(parsedExpiry.error);
      await alert(parsedExpiry.error, { severity: 'warning' });
      return;
    }
    const { month: expiryMonth, year: expiryYear } = parsedExpiry;

    const quantity = qtyNum;
    const freeQuantity = currentItem.freeQuantity ? (typeof currentItem.freeQuantity === 'number' ? currentItem.freeQuantity : parseFloat(String(currentItem.freeQuantity || '0'))) : 0;
    const spRaw = currentItem.schemePaidQty !== '' && currentItem.schemePaidQty != null
      ? (typeof currentItem.schemePaidQty === 'number' ? currentItem.schemePaidQty : parseFloat(String(currentItem.schemePaidQty)))
      : NaN;
    const sfRaw = currentItem.schemeFreeQty !== '' && currentItem.schemeFreeQty != null
      ? (typeof currentItem.schemeFreeQty === 'number' ? currentItem.schemeFreeQty : parseFloat(String(currentItem.schemeFreeQty)))
      : NaN;
    const schemePaidQty =
      !isNaN(spRaw) && !isNaN(sfRaw) && spRaw > 0 && sfRaw > 0 ? Math.floor(spRaw) : undefined;
    const schemeFreeQty =
      schemePaidQty != null ? Math.floor(sfRaw) : undefined;
    const purchasePrice = priceNum;
    const mrp = currentItem.mrp ? (typeof currentItem.mrp === 'number' ? currentItem.mrp : parseFloat(String(currentItem.mrp || '0'))) : 0;
    // Get GST rate from medicine master data (from selectedMedicine)
    const selectedMed = lookupMedicine(medicineId);
    const gstRate = selectedMed?.gstRate || (currentItem.gstRate ? (typeof currentItem.gstRate === 'number' ? currentItem.gstRate : parseFloat(String(currentItem.gstRate || '0'))) : 5);
    const discountPercentage = currentItem.discountPercentage ? (typeof currentItem.discountPercentage === 'number' ? currentItem.discountPercentage : parseFloat(String(currentItem.discountPercentage || '0'))) : 0;
    
    const enteredStandardDiscount = parseNumber(currentItem.standardDiscount);
    const standardDiscount =
      currentItem.standardDiscount !== '' && currentItem.standardDiscount !== undefined
        ? enteredStandardDiscount
        : calculateStandardDiscountFromMrpAndPurchasePrice(mrp, purchasePrice, gstRate);
    
    // Calculate total: (purchasePrice * quantity) - discount + GST
    // Formula: Purchase Price - Discount + GST
    const baseAmount = purchasePrice * quantity;
    const discountAmount = (baseAmount * discountPercentage) / 100;
    const amountAfterDiscount = baseAmount - discountAmount;
    const gstAmount = (amountAfterDiscount * gstRate) / 100;
    const totalAmount = amountAfterDiscount + gstAmount;

    // Create expiry date from MM/YY format
    const expiryDate = new Date(expiryYear, expiryMonth - 1, 1);

    // Generate QR code data
    const stockBatchForQr = purchaseItemStockBatchNumber({
      batchNumber,
      receivedBatchNumber: String(currentItem.receivedBatchNumber || '').trim() || undefined,
    });
    const qrData = JSON.stringify({
      medicineId,
      medicineName: currentItem.medicineName,
      batchNumber: stockBatchForQr,
      expiryDate: format(expiryDate, 'MM/yy'),
      quantity,
      freeQuantity,
      schemePaidQty,
      schemeFreeQty,
      purchasePrice,
      mrp: currentItem.mrp ? (typeof currentItem.mrp === 'number' ? currentItem.mrp : parseFloat(String(currentItem.mrp))) : undefined,
    });
    const qrCode = await generateQRCode(qrData);

    const receivedBatchNumber = String(currentItem.receivedBatchNumber || '').trim();
    const newItem: PurchaseInvoiceItem = {
      medicineId,
      medicineName: currentItem.medicineName || '',
      batchNumber,
      ...(receivedBatchNumber ? { receivedBatchNumber } : {}),
      expiryDate,
      quantity,
      freeQuantity: freeQuantity > 0 ? freeQuantity : undefined,
      ...(schemePaidQty != null && schemeFreeQty != null
        ? { schemePaidQty, schemeFreeQty }
        : {}),
      unitPrice: purchasePrice,
      purchasePrice,
      mrp: currentItem.mrp ? (typeof currentItem.mrp === 'number' ? currentItem.mrp : parseFloat(String(currentItem.mrp))) : undefined,
      gstRate: gstRate > 0 ? gstRate : undefined,
      standardDiscount: Number.isFinite(standardDiscount) ? standardDiscount : undefined,
      discountPercentage: discountPercentage > 0 ? discountPercentage : undefined,
      totalAmount,
      qrCode: qrCode || undefined,
      ...(currentItem.nonReturnable === true ? { nonReturnable: true } : {}),
      ...(currentItem.nrxDrug === true ? { nrxDrug: true } : {}),
    };

    if (itemDialog.itemIndex !== null) {
      const newItems = [...items];
      newItems[itemDialog.itemIndex] = newItem;
      setItems(newItems);
    } else {
      setItems([...items, newItem]);
    }

    setItemDialog({ open: false, itemIndex: null });
    setSelectedMedicine(null);
    setMedicineSearchInput('');
    focusMedicineSearch();
    setExpiryDateError(''); // Clear error when dialog closes
    setCurrentItem({
      medicineId: '',
      medicineName: '',
      batchNumber: '',
      receivedBatchNumber: '',
      expiryDate: '',
      quantity: '',
      freeQuantity: '',
      schemePaidQty: '',
      schemeFreeQty: '',
      unitPrice: '',
      purchasePrice: '',
      mrp: '',
      gstRate: selectedMedicine?.gstRate || 5, // Reset to medicine's GST rate
      standardDiscount: '20',
      discountPercentage: '',
      nonReturnable: false,
      nrxDrug: false,
    });
  };

  const handleEditItem = (index: number) => {
    const item = items[index];
    if (!item) return;
    setExpiryDateError('');
    const gstRate = item.gstRate || 5;
    const purchasePrice = Number(item.purchasePrice) || 0;
    const mrp = Number(item.mrp) || 0;
    setCurrentItem({
      medicineId: item.medicineId || '',
      medicineName: item.medicineName || '',
      batchNumber: item.batchNumber || '',
      receivedBatchNumber: item.receivedBatchNumber || '',
      expiryDate: formatExpiryMmYy(item.expiryDate),
      quantity: String(item.quantity ?? ''),
      freeQuantity: item.freeQuantity != null && item.freeQuantity > 0 ? String(item.freeQuantity) : '',
      schemePaidQty: item.schemePaidQty != null ? String(item.schemePaidQty) : '',
      schemeFreeQty: item.schemeFreeQty != null ? String(item.schemeFreeQty) : '',
      unitPrice: String(item.unitPrice ?? purchasePrice),
      purchasePrice: String(purchasePrice),
      mrp: mrp > 0 ? String(mrp) : '',
      gstRate,
      standardDiscount:
        item.standardDiscount !== undefined && item.standardDiscount !== null
          ? String(item.standardDiscount)
          : calculateStandardDiscountFromMrpAndPurchasePrice(mrp, purchasePrice, gstRate).toFixed(2),
      discountPercentage:
        item.discountPercentage != null && item.discountPercentage > 0
          ? String(item.discountPercentage)
          : '',
      nonReturnable: item.nonReturnable === true,
      nrxDrug: item.nrxDrug === true,
    });
    // Keep medicine in picker cache so GST / batch helpers work while editing.
    const cached = lookupMedicine(item.medicineId);
    if (cached) setSelectedMedicine(cached);
    setItemDialog({ open: true, itemIndex: index });
  };

  const handleDeleteItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
  };

  const handleViewQRCode = (qrCode: string | null, itemName: string) => {
    if (qrCode) {
      setQrCodeDialog({ open: true, qrCode, itemName });
    }
  };

  const handleDownloadQRCode = () => {
    if (qrCodeDialog.qrCode) {
      const link = document.createElement('a');
      link.href = qrCodeDialog.qrCode;
      link.download = `qr-code-${qrCodeDialog.itemName.replace(/\s+/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const openAddMedicineDialog = (prefill?: Partial<typeof emptyNewMedicine>) => {
    setNewMedicineData({
      ...emptyNewMedicine,
      ...prefill,
      gstRate: prefill?.gstRate ?? emptyNewMedicine.gstRate,
    });
    setAddMedicineDialog(true);
  };

  const closeAddMedicineDialog = () => {
    setAddMedicineDialog(false);
    setNewMedicineData(emptyNewMedicine);
  };

  const handleAddMedicine = async () => {
    if (!newMedicineData.name || !newMedicineData.code || !newMedicineData.type || !newMedicineData.packaging || !newMedicineData.manufacturer || !newMedicineData.gstRate) {
      await alert('Please fill all required fields', { severity: 'warning' });
      return;
    }

    try {
      // Check if medicine with same name already exists (Typesense — no full catalog scan)
      const existingMedicine = await findMedicineByExactName(newMedicineData.name);

      if (existingMedicine) {
        rememberMedicine(existingMedicine);
        setSelectedMedicine(existingMedicine);
        closeAddMedicineDialog();
        await alert(`Medicine "${existingMedicine.name}" already exists. Selected from existing medicines.`, { severity: 'warning' });
        return;
      }

      // Medicine doesn't exist - create new one
      const medicineId = await createMedicineMutation.mutateAsync({
        name: newMedicineData.name,
        code: newMedicineData.code,
        category: newMedicineData.type, // Store type as category
        unit: newMedicineData.packaging, // Store packaging as unit
        manufacturer: newMedicineData.manufacturer,
        stock: 0,
        currentStock: 0,
        price: 0,
        gstRate: newMedicineData.gstRate ? parseFloat(newMedicineData.gstRate) : 5,
        description: `Packaging: ${newMedicineData.packaging}`,
      });

      const newMedicine = {
        id: medicineId,
        name: newMedicineData.name,
        code: newMedicineData.code,
        category: newMedicineData.type,
        manufacturer: newMedicineData.manufacturer,
        unit: newMedicineData.packaging,
        stock: 0,
        price: 0,
        gstRate: newMedicineData.gstRate ? parseFloat(newMedicineData.gstRate) : 5,
      } as Medicine;

      rememberMedicine(newMedicine);
      setSelectedMedicine(newMedicine);
      closeAddMedicineDialog();
    } catch (error: any) {
      await alert(error.message || 'Failed to add medicine', { severity: 'error' });
    }
  };

  const handleSaveInvoice = async () => {
    if (
      savingInvoiceRef.current ||
      createInvoiceMutation.isPending ||
      updateInvoiceMutation.isPending
    ) {
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      await alert('Please login to continue', { severity: 'warning' });
      return;
    }

    const invoiceNumber = invoiceData.invoiceNumber.trim();
    if (!invoiceNumber || !invoiceData.vendorId || items.length === 0) {
      await alert('Please fill invoice number, select vendor, and add at least one item', { severity: 'warning' });
      return;
    }

    const vendorLabel = selectedVendor?.vendorName || existingInvoice?.vendorName || 'this vendor';
    const confirmed = await confirm(
      isEditMode
        ? `Update purchase invoice ${invoiceNumber} for ${vendorLabel}?\n\n` +
            `${items.length} item${items.length === 1 ? '' : 's'} · Grand total ₹${grandTotal.toFixed(2)}\n\n` +
            `Stock will be adjusted to match these lines.`
        : `Save purchase invoice ${invoiceNumber} for ${vendorLabel}?\n\n` +
            `${items.length} item${items.length === 1 ? '' : 's'} · Grand total ₹${grandTotal.toFixed(2)}\n\n` +
            `Stock will be updated. This cannot be undone from here.`
    );
    if (!confirmed) return;

    savingInvoiceRef.current = true;
    try {
      if (isEditMode && editInvoiceId) {
        const result = await updateInvoiceMutation.mutateAsync({
          invoiceId: editInvoiceId,
          invoiceData: {
            items,
            subTotal,
            taxAmount: totalTax,
            discount: totalDiscount > 0 ? totalDiscount : 0,
            totalAmount: grandTotal,
            notes: invoiceData.notes || undefined,
          },
        });
        if (result.stockSyncErrors.length > 0) {
          await alert(
            `Invoice updated. Stock note:\n${result.stockSyncErrors.slice(0, 5).join('\n')}`,
            { severity: 'warning' }
          );
        } else {
          await alert('Invoice and stock updated successfully.', { severity: 'success' });
        }
        navigate(`/purchases/${editInvoiceId}`);
        return;
      }

      await createInvoiceMutation.mutateAsync({
        invoiceData: {
          invoiceNumber,
          vendorId: invoiceData.vendorId,
          vendorName: selectedVendor?.vendorName || '',
          invoiceDate: new Date(invoiceData.invoiceDate),
          items,
          subTotal,
          taxAmount: totalTax,
          discount: totalDiscount > 0 ? totalDiscount : undefined,
          totalAmount: grandTotal,
          paymentStatus: 'Unpaid',
          notes: invoiceData.notes || undefined,
          createdBy: user.uid,
          createdAt: new Date(),
        },
        updateStock: true,
      });

      navigate('/purchases');
    } catch (error: any) {
      await alert(
        error.message || (isEditMode ? 'Failed to update invoice' : 'Failed to create invoice'),
        { severity: 'error' }
      );
    } finally {
      savingInvoiceRef.current = false;
    }
  };

  if (isEditMode && existingLoading) {
    return <Loading message="Loading invoice..." />;
  }
  if (isEditMode && !existingInvoice) {
    return <Typography color="error">Invoice not found</Typography>;
  }

  return (
    <Box>
      <Breadcrumbs items={[
        { label: 'Purchase Invoices', path: '/purchases' },
        ...(isEditMode && editInvoiceId
          ? [
              { label: `Invoice #${invoiceData.invoiceNumber || editInvoiceId}`, path: `/purchases/${editInvoiceId}` },
              { label: 'Edit' },
            ]
          : [{ label: 'Create Invoice' }]),
      ]} />
      <Box display="flex" alignItems="center" mb={3}>
        <IconButton
          onClick={() => navigate(isEditMode && editInvoiceId ? `/purchases/${editInvoiceId}` : '/purchases')}
          sx={{ mr: 2 }}
        >
          <ArrowBack />
        </IconButton>
        <Typography variant="h4">
          {isEditMode ? 'Edit Purchase Invoice' : 'Create Purchase Invoice'}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="contained"
          startIcon={<Save />}
          onClick={() => void handleSaveInvoice()}
          disabled={isSavingInvoice}
        >
          {isSavingInvoice ? 'Saving...' : isEditMode ? 'Update Invoice' : 'Save Invoice'}
        </Button>
      </Box>

      {isEditMode ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Invoice number, date, and vendor are locked. Edit line items below — stock will sync on update.
        </Alert>
      ) : null}

      <Grid container spacing={3}>
        {/* Left: Invoice Details */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>Invoice Details</Typography>
            <TextField
              fullWidth
              label="Invoice Number"
              required
              placeholder="Enter vendor bill / invoice number"
              value={invoiceData.invoiceNumber}
              onChange={(e) => setInvoiceData({ ...invoiceData, invoiceNumber: e.target.value })}
              disabled={isEditMode}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Invoice Date"
              type="date"
              required
              value={invoiceData.invoiceDate}
              onChange={(e) => setInvoiceData({ ...invoiceData, invoiceDate: e.target.value })}
              InputLabelProps={{ shrink: true }}
              disabled={isEditMode}
              sx={{ mb: 2 }}
            />
            <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'flex-start' }}>
              <Autocomplete
                fullWidth
                options={vendorOptions}
                getOptionLabel={(option) => option.vendorName || ''}
                value={selectedVendor}
                onChange={(event, newValue) => {
                  setJustCreatedVendor(null);
                  setInvoiceData({ ...invoiceData, vendorId: newValue?.id || '' });
                }}
                disabled={isEditMode}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Vendor"
                    required
                    placeholder="Search vendor..."
                  />
                )}
                isOptionEqualToValue={(option, value) => option.id === value.id}
              />
              {!isEditMode && (
                <Button
                  variant="outlined"
                  startIcon={<Add />}
                  onClick={() => setAddVendorDialog(true)}
                  sx={{ mt: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  Add Vendor
                </Button>
              )}
            </Box>
            {selectedVendor && (
              <Card variant="outlined" sx={{ mb: 2, bgcolor: 'rgba(33, 150, 243, 0.05)' }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="subtitle2" gutterBottom>Vendor Info</Typography>
                  <Typography variant="body2">{selectedVendor.vendorName}</Typography>
                  <Typography variant="caption" color="textSecondary">
                    GST: {selectedVendor.gstNumber}
                  </Typography>
                </CardContent>
              </Card>
            )}
            <TextField
              fullWidth
              label="Notes"
              multiline
              rows={3}
              value={invoiceData.notes}
              onChange={(e) => setInvoiceData({ ...invoiceData, notes: e.target.value })}
            />
          </Paper>

          {/* Totals */}
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Invoice Summary</Typography>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Subtotal:</Typography>
              <Typography>₹{subTotal.toFixed(2)}</Typography>
            </Box>
            {totalDiscount > 0 && (
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="textSecondary">Discount:</Typography>
                <Typography color="error">-₹{totalDiscount.toFixed(2)}</Typography>
              </Box>
            )}
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Tax:</Typography>
              <Typography>₹{totalTax.toFixed(2)}</Typography>
            </Box>
            {Math.abs(roundoff) > 0.01 && (
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="textSecondary">Round Off:</Typography>
                <Typography>{roundoff > 0 ? '+' : ''}₹{roundoff.toFixed(2)}</Typography>
              </Box>
            )}
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between">
              <Typography variant="h6">Total:</Typography>
              <Typography variant="h6">₹{grandTotal.toFixed(2)}</Typography>
            </Box>
          </Paper>
        </Grid>

        {/* Right: Items */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Invoice Items</Typography>
              <Box display="flex" gap={2}>
                <Autocomplete
                  loading={medicineSearchLoading}
                  options={purchaseMedicineOptions}
                  groupBy={(o) => o.groupLabel}
                  getOptionLabel={(o) => o.label}
                  getOptionDisabled={(o) => !o.selectable && !o.demand}
                  value={selectedResolveOption}
                  inputValue={medicineSearchInput}
                  onInputChange={(_, newInputValue, reason) => {
                    if (reason === 'clear') {
                      setMedicineSearchInput('');
                      setSelectedMedicine(null);
                      return;
                    }
                    if (reason === 'input') {
                      setMedicineSearchInput(newInputValue);
                      if (
                        selectedMedicine &&
                        newInputValue !== getMedicinePickerLabel(selectedMedicine)
                      ) {
                        setSelectedMedicine(null);
                      }
                      return;
                    }
                    setMedicineSearchInput(newInputValue);
                  }}
                  onChange={(_, newValue) => {
                    if (!newValue) {
                      setSelectedMedicine(null);
                      setMedicineSearchInput('');
                      return;
                    }
                    if (newValue.demand && !newValue.medicine) {
                      const demand = newValue.demand;
                      openAddMedicineDialog({
                        name: demand.productName || '',
                        manufacturer: demand.manufacturerName || '',
                        packaging: demand.requestedUnit || '',
                      });
                      return;
                    }
                    if (!newValue.selectable || !newValue.medicine) {
                      return;
                    }
                    void resolveMedicineAfterPickerSelection(newValue.medicine, undefined).then(
                      (merged) => {
                        rememberMedicine(merged);
                        setSelectedMedicine(merged);
                        setMedicineSearchInput(getMedicinePickerLabel(merged));
                      }
                    );
                  }}
                  filterOptions={(options) => options}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  renderGroup={renderMedicineResolveGroup}
                  renderOption={renderMedicineResolveOption}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      inputRef={medicineSearchInputElRef}
                      label="Search Medicine"
                      placeholder="Pending orders · demands · inventory…"
                      size="small"
                      sx={{ minWidth: 300 }}
                      InputProps={{
                        ...params.InputProps,
                        startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
                      }}
                    />
                  )}
                />
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={handleAddItem}
                  disabled={!selectedMedicine}
                >
                  Add Item
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => openAddMedicineDialog()}
                >
                  Add New Medicine
                </Button>
              </Box>
            </Box>

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
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">GST %</TableCell>
                    <TableCell align="right">Discount %</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="center">QR Code</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={14} align="center">
                        <Typography color="textSecondary" sx={{ py: 2 }}>
                          No items added. Search and add medicines to create invoice.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item, index) => {
                      const expiryLabel = formatExpiryMmYy(item.expiryDate) || '—';
                      const qty = Number(item.quantity) || 0;
                      const freeQty = Number(item.freeQuantity) || 0;
                      const price = Number(item.purchasePrice) || 0;
                      const lineTotal = Number(item.totalAmount) || 0;
                      return (
                      <TableRow key={`${item.medicineId}-${item.batchNumber}-${index}`}>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">{item.medicineName}</Typography>
                          <Typography variant="caption" color="textSecondary">
                            Exp: {expiryLabel}
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
                        <TableCell align="right">{qty}</TableCell>
                        <TableCell align="right">
                          {freeQty > 0 ? freeQty : '-'}
                        </TableCell>
                        <TableCell align="center">
                          <Box display="flex" alignItems="center" justifyContent="center" gap={0.5}>
                            <Typography variant="caption">
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
                            {qty + freeQty}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">₹{price.toFixed(2)}</TableCell>
                        <TableCell align="right">
                          {item.gstRate !== undefined ? `${item.gstRate}%` : '-'}
                        </TableCell>
                        <TableCell align="right">
                          {item.discountPercentage !== undefined ? `${item.discountPercentage}%` : '-'}
                        </TableCell>
                        <TableCell align="right">₹{lineTotal.toFixed(2)}</TableCell>
                        <TableCell align="center">
                          {item.qrCode ? (
                            <IconButton 
                              size="small" 
                              onClick={() => handleViewQRCode(item.qrCode || null, item.medicineName)}
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
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => handleEditItem(index)}
                            title="Edit item"
                            aria-label="Edit item"
                          >
                            <Edit fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteItem(index)}
                            title="Remove item"
                            aria-label="Remove item"
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>

      {/* Add Item Dialog */}
      <Dialog
        open={itemDialog.open}
        disableRestoreFocus
        disableAutoFocus
        TransitionProps={{
          onEntered: () => invoiceBatchInputElRef.current?.focus(),
        }}
        onClose={() => {
        setItemDialog({ open: false, itemIndex: null });
        setExpiryDateError(''); // Clear error when dialog closes
      }} maxWidth="sm" fullWidth>
        <DialogTitle>
          {itemDialog.itemIndex !== null ? 'Edit Item' : 'Add Item'} - {currentItem.medicineName}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                autoFocus
                inputRef={invoiceBatchInputElRef}
                label="Invoice Batch Number"
                required
                value={currentItem.batchNumber}
                onChange={(e) => setCurrentItem({ ...currentItem, batchNumber: e.target.value })}
                onBlur={applyExistingBatchDetails}
                helperText={
                  existingBatchForCurrentItem
                    ? 'Existing stock batch found — other fields filled from inventory (enter quantity for this bill)'
                    : 'Batch as printed on the vendor bill'
                }
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
                onBlur={applyExistingBatchDetails}
                helperText="Physical batch on packs if different from invoice (used for stock)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Quantity"
                type="number"
                required
                value={currentItem.quantity}
                onChange={(e) => {
                  setCurrentItem({ 
                    ...currentItem, 
                    quantity: e.target.value,
                  });
                }}
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
            <Grid item xs={12}>
              <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} sx={{ mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Retailer scheme (optional): e.g. 1 free on 10 strips → pay for = 10, free = 1. Shown in the retailer app for this batch.
                </Typography>
                {currentItem.medicineId ? (
                  <RetailerLastSchemeHint
                    lastScheme={lastPurchaseByMedicineId.get(currentItem.medicineId)}
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
                label="Scheme — pay for (qty)"
                type="number"
                inputProps={{ min: 1 }}
                value={currentItem.schemePaidQty}
                onChange={(e) => setCurrentItem({ ...currentItem, schemePaidQty: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Scheme — get free (qty)"
                type="number"
                inputProps={{ min: 1 }}
                value={currentItem.schemeFreeQty}
                onChange={(e) => setCurrentItem({ ...currentItem, schemeFreeQty: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={currentItem.nonReturnable === true}
                    onChange={(e) => setCurrentItem({ ...currentItem, nonReturnable: e.target.checked })}
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
                    onChange={(e) => setCurrentItem({ ...currentItem, nrxDrug: e.target.checked })}
                  />
                }
                label="NRX drug (Schedule H / restricted)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Expiry Date"
                required
                value={currentItem.expiryDate}
                onChange={(e) => {
                  let value = e.target.value;
                  // Allow only numbers and forward slash
                  value = value.replace(/[^0-9/]/g, '');
                  
                  // Auto-format: insert slash after 2 digits if user types 3 digits without slash
                  if (value.length === 3 && !value.includes('/')) {
                    value = value.substring(0, 2) + '/' + value.substring(2);
                  }
                  
                  // Limit to 5 characters (MM/YY)
                  if (value.length <= 5) {
                    setCurrentItem({ ...currentItem, expiryDate: value });
                    
                    // Clear error while typing if format looks correct
                    if (value.length > 0 && !value.includes('/') && value.length <= 2) {
                      setExpiryDateError('');
                    } else if (value.length === 0) {
                      setExpiryDateError('');
                    }
                  }
                }}
                onBlur={() => {
                  const value = currentItem.expiryDate?.trim() || '';
                  if (value.length === 0) {
                    setExpiryDateError('');
                    return;
                  }
                  const parsed = parseExpiryMmYy(value);
                  setExpiryDateError(parsed.ok ? '' : parsed.error);
                }}
                placeholder="MM/YY"
                error={!!expiryDateError}
                helperText={expiryDateError || EXPIRY_MM_YY_HELPER}
                inputProps={{ maxLength: 5 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="MRP"
                type="number"
                value={currentItem.mrp}
                onChange={(e) => {
                  const mrpValue = e.target.value;
                  const mrp = parseNumber(mrpValue);
                  const gstRate = getCurrentItemGstRate();
                  const standardDiscount =
                    currentItem.standardDiscount === '' || currentItem.standardDiscount === undefined
                      ? 20
                      : parseNumber(currentItem.standardDiscount);
                  const purchasePrice = calculatePurchasePriceFromMrpAndDiscount(mrp, gstRate, standardDiscount);
                  const calculatedPurchasePrice = mrp > 0 ? purchasePrice.toFixed(2) : '';
                  
                  setCurrentItem({ 
                    ...currentItem, 
                    mrp: mrpValue,
                    ...(calculatedPurchasePrice && {
                      purchasePrice: calculatedPurchasePrice,
                      unitPrice: calculatedPurchasePrice,
                    })
                  });
                }}
                InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
                helperText="Purchase Price is calculated from MRP, Standard Discount and GST"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="GST Rate (%)"
                type="number"
                value={(() => {
                  // Get GST rate from medicine master data
                  const selectedMed = lookupMedicine(currentItem.medicineId);
                  return selectedMed?.gstRate || (currentItem.gstRate ? (typeof currentItem.gstRate === 'number' ? currentItem.gstRate : parseFloat(String(currentItem.gstRate || '0'))) : 5);
                })()}
                InputProps={{ 
                  readOnly: true
                }}
                helperText="From medicine master data"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Standard Discount (%)"
                type="number"
                value={currentItem.standardDiscount}
                onChange={(e) => {
                  const standardDiscountValue = e.target.value;
                  const mrp = parseNumber(currentItem.mrp);
                  const gstRate = getCurrentItemGstRate();
                  const standardDiscount = parseNumber(standardDiscountValue);
                  const purchasePrice = calculatePurchasePriceFromMrpAndDiscount(mrp, gstRate, standardDiscount);

                  setCurrentItem({
                    ...currentItem,
                    standardDiscount: standardDiscountValue,
                    ...(mrp > 0 && {
                      purchasePrice: purchasePrice.toFixed(2),
                      unitPrice: purchasePrice.toFixed(2),
                    }),
                  });
                }}
                helperText="Change this to auto-update Purchase Price from MRP"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Purchase Price"
                type="number"
                required
                value={currentItem.purchasePrice}
                onChange={(e) => {
                  const purchasePriceValue = e.target.value;
                  const mrp = parseNumber(currentItem.mrp);
                  const gstRate = getCurrentItemGstRate();
                  const purchasePrice = parseNumber(purchasePriceValue);
                  const standardDiscount = calculateStandardDiscountFromMrpAndPurchasePrice(mrp, purchasePrice, gstRate);

                  setCurrentItem({ 
                    ...currentItem, 
                    purchasePrice: purchasePriceValue,
                    unitPrice: purchasePriceValue,
                    ...(mrp > 0 && {
                      standardDiscount: standardDiscount.toFixed(2),
                    }),
                  });
                }}
                InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
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
              <TextField
                fullWidth
                label="Total Amount"
                value={(() => {
                  const qty = typeof currentItem.quantity === 'number' ? currentItem.quantity : parseFloat(String(currentItem.quantity || '0'));
                  const price = typeof currentItem.purchasePrice === 'number' ? currentItem.purchasePrice : parseFloat(String(currentItem.purchasePrice || '0'));
                  // Get GST rate from medicine master data
                  const selectedMed = lookupMedicine(currentItem.medicineId);
                  const gstRate = selectedMed?.gstRate || (currentItem.gstRate ? (typeof currentItem.gstRate === 'number' ? currentItem.gstRate : parseFloat(String(currentItem.gstRate || '0'))) : 5);
                  const discountPercentage = currentItem.discountPercentage ? (typeof currentItem.discountPercentage === 'number' ? currentItem.discountPercentage : parseFloat(String(currentItem.discountPercentage || '0'))) : 0;
                  
                  // Formula: Purchase Price - Discount + GST
                  // Step 1: Calculate base amount (Purchase Price * Quantity)
                  const baseAmount = price * qty;
                  // Step 2: Calculate discount amount
                  const discountAmount = (baseAmount * discountPercentage) / 100;
                  // Step 3: Subtract discount from base amount
                  const amountAfterDiscount = baseAmount - discountAmount;
                  // Step 4: Calculate GST on discounted amount
                  const gstAmount = (amountAfterDiscount * gstRate) / 100;
                  // Step 5: Add GST to get total amount
                  return (amountAfterDiscount + gstAmount).toFixed(2);
                })()}
                InputProps={{ 
                  readOnly: true,
                  startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography>
                }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemDialog({ open: false, itemIndex: null })}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveItem}>
            {itemDialog.itemIndex !== null ? 'Update' : 'Add'} Item
          </Button>
        </DialogActions>
      </Dialog>

      {/* QR Code View Dialog */}
      <Dialog 
        open={qrCodeDialog.open} 
        onClose={() => setQrCodeDialog({ open: false, qrCode: null, itemName: '' })} 
        maxWidth="xs" 
        fullWidth
      >
        <DialogTitle>QR Code - {qrCodeDialog.itemName}</DialogTitle>
        <DialogContent>
          {qrCodeDialog.qrCode ? (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <img src={qrCodeDialog.qrCode} alt="QR Code" style={{ maxWidth: '100%', marginBottom: 16 }} />
              <Button
                variant="contained"
                fullWidth
                onClick={handleDownloadQRCode}
              >
                Download QR Code
              </Button>
            </Box>
          ) : (
            <Typography>No QR code available</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQrCodeDialog({ open: false, qrCode: null, itemName: '' })}>Close</Button>
        </DialogActions>
      </Dialog>

      <VendorFormDialog
        open={addVendorDialog}
        onClose={() => setAddVendorDialog(false)}
        onCreated={(vendor) => {
          setJustCreatedVendor(vendor);
          setInvoiceData((prev) => ({ ...prev, vendorId: vendor.id }));
        }}
      />

      {/* Add Medicine Dialog */}
      <Dialog open={addMedicineDialog} onClose={closeAddMedicineDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Medicine to Master</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <Autocomplete
                freeSolo
                options={addMedicineOptions}
                getOptionLabel={(option) => {
                  if (typeof option === 'string') return option;
                  return getMedicinePickerLabel(option);
                }}
                inputValue={newMedicineData.name}
                onInputChange={(_, newInputValue) => {
                  setNewMedicineData({ ...newMedicineData, name: newInputValue });
                }}
                filterOptions={(options) => options}
                onChange={(_, newValue) => {
                  if (newValue && typeof newValue === 'object') {
                    const selectedMed = newValue as Medicine;
                    void resolveMedicineAfterPickerSelection(selectedMed, undefined).then(
                      (merged) => {
                        rememberMedicine(merged);
                        setNewMedicineData({
                          name: merged.name || '',
                          code: merged.code || '',
                          type: merged.category || '',
                          packaging: merged.unit || '',
                          manufacturer: merged.manufacturer || '',
                          gstRate: String(merged.gstRate ?? 5),
                        });
                      }
                    );
                  } else if (typeof newValue === 'string') {
                    // User typed new name - keep the typed value
                    setNewMedicineData({ ...newMedicineData, name: newValue });
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    fullWidth
                    label="Medicine Name"
                    required
                    helperText="Type 2+ letters for search; or type a new name"
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="HSN / item code"
                required
                value={newMedicineData.code}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, code: e.target.value })}
                helperText="GST HSN — same value can apply to many products"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Type"
                required
                value={newMedicineData.type}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, type: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Packaging"
                required
                value={newMedicineData.packaging}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, packaging: e.target.value })}
                placeholder="e.g., 10 ml, 15 Tablet, 10 Capsule"
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
                label="GST Rate (%)"
                type="number"
                required
                value={newMedicineData.gstRate}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, gstRate: e.target.value })}
                inputProps={{ min: 0, max: 100, step: 0.01 }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAddMedicineDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleAddMedicine} disabled={createMedicineMutation.isPending}>
            Add to Master
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

