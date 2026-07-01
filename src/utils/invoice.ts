import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Order, PurchaseInvoice, ProductDemand, Medicine } from '../types';
import {
  billablePaidFromAllocationSums,
  orderedUnitsFromAllocation,
  orderLinePhysicalO,
  orderLineSchemeDisplayPhysical,
  schemeOrderLineDisplayTotals,
} from './schemeFulfillment';
import { format } from 'date-fns';
import { getVendorById } from '../services/vendors';
import { getUserProfile } from '../services/firebase';
import { getMedicineById, getAllMedicines } from '../services/inventory';
import { getProductDemandsByIds } from '../services/productDemands';
import { invoiceStateHtml, resolveInvoiceState, COMPANY_INVOICE_DETAILS } from './invoicePartyDefaults';
import { getAllPurchaseInvoices, collectPurchaseInvoicesForDemands } from '../services/purchaseInvoices';
import { tryPromoteFulfilledDemandLine } from './productDemandOrderLine';
import { formatOrderInvoiceLabel } from './orderDisplay';
import { sendOrderInvoicePdfToRetailer } from '../services/orderInvoiceEmail';
import { appAlert } from './appDialog';
import {
  buildPurchaseBatchDiscountLookup,
  resolveOrderLineDiscountPct,
  resolveOrderLineDisplayDiscountPct,
  resolveSellDiscountPct,
  unitPriceFromMrp,
} from './orderFulfillmentDiscount';
import {
  GST_INVOICE_STYLES,
  buildGstInvoiceTitleCell,
  formatInvoiceProductName,
  formatInvoiceLineGst,
  buildGstInvoiceFooter,
  buildGstInvoiceItemTableHtml,
  buildGstInvoiceTotalsSection,
  type GstInvoiceLineItem,
} from './gstInvoiceTemplate';

// Function to convert number to words
const numberToWords = (num: number): string => {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  
  if (num === 0) return 'Zero';
  
  const convertHundreds = (n: number): string => {
    let result = '';
    if (n >= 100) {
      result += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      result += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n > 0) {
      result += ones[n] + ' ';
    }
    return result.trim();
  };
  
  let words = '';
  const crore = Math.floor(num / 10000000);
  if (crore > 0) {
    words += convertHundreds(crore) + 'Crore ';
    num %= 10000000;
  }
  
  const lakh = Math.floor(num / 100000);
  if (lakh > 0) {
    words += convertHundreds(lakh) + 'Lakh ';
    num %= 100000;
  }
  
  const thousand = Math.floor(num / 1000);
  if (thousand > 0) {
    words += convertHundreds(thousand) + 'Thousand ';
    num %= 1000;
  }
  
  if (num > 0) {
    words += convertHundreds(num);
  }
  
  return words.trim() + ' Rupees Only';
};

// HTML Template for Order Invoice

type OrderInvoiceLineItem = GstInvoiceLineItem;
export type OrderInvoicePrepared = {
  items: OrderInvoiceLineItem[];
  summary: {
    subTotal: string;
    discount: string;
    sgst: string;
    cgst: string;
    roundOff: string;
    grandTotal: string;
    amountInWords: string;
  };
  tax: { taxable: string; cgst: string; sgst: string; rate: string };
  invoiceData: {
    no: string;
    date: string;
    dueDate: string;
    user: string;
    tray: string;
    processedBy: string;
  };
  company: {
    name: string;
    address: string;
    phone: string;
    email: string;
    dl: string;
    gstin: string;
  };
  party: {
    name: string;
    address: string;
    state: string;
    stateCode: string;
    phone: string;
    dl: string;
    gstin: string;
  };
  /** Order GST % used on tax summary (same as invoice template) */
  gstRatePercent: number;
};

async function prepareOrderInvoiceData(order: Order): Promise<OrderInvoicePrepared> {
  const invoiceDate = order.orderDate instanceof Date ? order.orderDate : new Date(order.orderDate);

  const toNumber = (value: unknown): number => {
    if (value === undefined || value === null || value === '') return 0;
    const parsed = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getSchemePair = (source: any) => {
    return {
      paid: source?.schemePaidQty ?? source?.purchaseSchemeDeal,
      free: source?.schemeFreeQty ?? source?.purchaseSchemeFree,
    };
  };
  
  const productDemandIds = [
    ...new Set(
      order.medicines.map((m) => m.productDemandId).filter((id): id is string => Boolean(id))
    ),
  ];
  const demandById = await getProductDemandsByIds(productDemandIds);

  const relevantDemands: ProductDemand[] = productDemandIds
    .map((id) => demandById.get(id))
    .filter((d): d is ProductDemand => d != null);

  let mergedInvoices: PurchaseInvoice[] = [];
  let medicineList: Medicine[] = [];

  if (relevantDemands.some((d) => d.status === 'fulfilled')) {
    const [baseInvoices, meds] = await Promise.all([
      getAllPurchaseInvoices(),
      getAllMedicines(),
    ]);
    mergedInvoices = await collectPurchaseInvoicesForDemands(baseInvoices, relevantDemands);
    medicineList = meds;
  }

  /**
   * Legacy rows still marked product_demand: rebuild with the same PI + inventory rules as
   * fulfillProductDemand / prepareFulfilledDemandOrderMedicines (no separate "pick any batch" path).
   */
  const invoiceMedicines: Order['medicines'] = order.medicines.map((item) => {
    if (item.lineType !== 'product_demand') return item;
    const demand = item.productDemandId ? demandById.get(item.productDemandId) : undefined;
    if (!demand || demand.status !== 'fulfilled' || medicineList.length === 0) return item;
    return tryPromoteFulfilledDemandLine(item, relevantDemands, medicineList, mergedInvoices, order.id);
  });

  // Fetch all medicines to get packaging info
  const medicineMap = new Map<string, string>();
  const medicineDetailsMap = new Map<string, any>();
  await Promise.all(
    invoiceMedicines.map(async (item) => {
      if (item.medicineId) {
        try {
          const medicine = await getMedicineById(item.medicineId);
          if (medicine) {
            medicineDetailsMap.set(item.medicineId, medicine);
            // Check unit field first
            let packaging = medicine.unit;
            
            // If unit is not available, check description for "Packaging: " pattern
            if (!packaging && medicine.description) {
              const packagingMatch = medicine.description.match(/Packaging:\s*(.+)/i);
              if (packagingMatch && packagingMatch[1]) {
                packaging = packagingMatch[1].trim();
              }
            }
            
            if (packaging) {
              medicineMap.set(item.medicineId, packaging);
            } else {
              medicineMap.set(item.medicineId, '-');
            }
          } else {
            medicineMap.set(item.medicineId, '-');
          }
        } catch (error) {
          console.warn(`Failed to fetch medicine ${item.medicineId}:`, error);
          medicineMap.set(item.medicineId, '-');
        }
      } else {
        medicineMap.set('', '-');
      }
    })
  );

  let purchaseDiscountLookup = buildPurchaseBatchDiscountLookup([]);
  try {
    const invoicesForDiscount =
      mergedInvoices.length > 0 ? mergedInvoices : await getAllPurchaseInvoices();
    purchaseDiscountLookup = buildPurchaseBatchDiscountLookup(invoicesForDiscount);
  } catch (error) {
    console.warn('Failed to load purchase invoices for invoice discount resolution:', error);
  }
  
  // Calculate totals
  let totalSubTotal = 0;
  let totalProductDiscount = 0;
  
  const items = invoiceMedicines.map((item, index) => {
    if (item.lineType === 'product_demand') {
      const gstRate =
        (item as any).gstRate !== undefined ? (item as any).gstRate : order.taxPercentage || 5;
      const demand = item.productDemandId ? demandById.get(item.productDemandId) : undefined;
      const isRejected = demand?.status === 'rejected';
      const qty = toNumber(item.quantity);
      const nameBase = formatInvoiceProductName(item.name || 'Product request');
      return {
        sn: index + 1,
        name: isRejected ? `${nameBase} — not supplied` : `${nameBase} (product request)`,
        pack: '—',
        hsn: '—',
        batch: '—',
        exp: '—',
        qty: qty.toFixed(2),
        free: '0.00',
        totalQty: qty.toFixed(2),
        mrp: '-',
        rate: '0.00',
        disc: '0.00',
        gst: formatInvoiceLineGst(gstRate),
        amount: '0.00',
        rowClass: isRejected ? 'line-rejected' : '',
      };
    }

    const medicineDetails = item.medicineId ? medicineDetailsMap.get(item.medicineId) : undefined;

    /** Resolve P/F from batch allocations + inventory (same as fulfillment). */
    const resolveSchemePF = (
      allocations: any[] | undefined,
      batchNumber?: string
    ): { p?: number; f?: number; totalO: number } => {
      let p: number | undefined;
      let f: number | undefined;
      if (allocations && allocations.length > 0) {
        for (const allocation of allocations) {
          const batchFromInventory = medicineDetails?.stockBatches?.find(
            (b: any) => b.batchNumber === allocation.batchNumber
          );
          const allocationScheme = getSchemePair(allocation);
          const inventoryScheme = getSchemePair(batchFromInventory);
          const pp = toNumber(allocationScheme.paid ?? inventoryScheme.paid);
          const ff = toNumber(allocationScheme.free ?? inventoryScheme.free);
          if (pp > 0 && ff > 0) {
            p = pp;
            f = ff;
            break;
          }
        }
      } else {
        const stockBatch = medicineDetails?.stockBatches?.find((b: any) => b.batchNumber === batchNumber);
        const pair = getSchemePair(stockBatch);
        p = toNumber(pair.paid) || undefined;
        f = toNumber(pair.free) || undefined;
      }
      const totalO = orderLineSchemeDisplayPhysical(item, p, f);
      return { p, f, totalO };
    };

    const allocs = item.batchAllocations;
    const { p: schemeP, f: schemeF, totalO } = resolveSchemePF(allocs, item.batchNumber);

    const displayCols = schemeOrderLineDisplayTotals(totalO, schemeP, schemeF);

    let paidQty: number;
    let freeQty: number;
    let physicalQty: number;

    if (schemeP !== undefined && schemeF !== undefined && schemeP > 0 && schemeF > 0 && totalO > 0) {
      paidQty = displayCols.billQty;
      freeQty = displayCols.freeQty;
      physicalQty = totalO;
    } else if (allocs && allocs.length > 0) {
      const sumPaid = allocs.reduce((s: number, a: any) => s + toNumber(a.quantity), 0);
      const sumFree = allocs.reduce((s: number, a: any) => s + toNumber(a.allocationFreeQty ?? 0), 0);
      const physicalO = orderLinePhysicalO(item);
      paidQty = billablePaidFromAllocationSums(item, sumPaid, sumFree);
      freeQty = sumFree;
      physicalQty = physicalO;
    } else {
      paidQty = toNumber(item.quantity);
      freeQty =
        item.freeQuantity !== undefined && item.freeQuantity !== null
          ? toNumber(item.freeQuantity)
          : 0;
      physicalQty = paidQty + freeQty;
    }
    const quantity = paidQty;
    const freeQuantity = freeQty;
    const totalQty = physicalQty;

    const primaryBatchNumber =
      item.batchNumber || (allocs && allocs.length > 0 ? allocs[0].batchNumber : undefined);
    const primaryBatch = primaryBatchNumber
      ? medicineDetails?.stockBatches?.find((b: any) => b.batchNumber === primaryBatchNumber)
      : undefined;

    const firstPositiveFromAllocs = (key: 'mrp' | 'discountPercentage' | 'gstRate' | 'purchasePrice') => {
      if (!allocs || allocs.length === 0) return 0;
      for (const allocation of allocs) {
        const n = toNumber(allocation?.[key]);
        if (n > 0) return n;
      }
      return 0;
    };

    let mrp = toNumber((item as any).mrp);
    if (mrp <= 0) mrp = firstPositiveFromAllocs('mrp');
    if (mrp <= 0) mrp = toNumber(primaryBatch?.mrp);
    if (mrp <= 0) mrp = toNumber(medicineDetails?.mrp);

    let gstRate =
      (item as any).gstRate !== undefined
        ? toNumber((item as any).gstRate)
        : 0;
    if (gstRate <= 0) gstRate = firstPositiveFromAllocs('gstRate');
    if (gstRate <= 0) {
      gstRate = toNumber(medicineDetails?.gstRate);
    }
    if (gstRate <= 0) {
      gstRate = order.taxPercentage || 5;
    }

    let discountPercentage = 0;
    let displayDiscountPercentage = 0;
    const discountManuallySet = (item as { discountManuallySet?: boolean }).discountManuallySet === true;
    if (allocs && allocs.length > 0) {
      discountPercentage = allocs.reduce((best: number, a: any) => {
        const batchFromInventory = medicineDetails?.stockBatches?.find(
          (b: any) => b.batchNumber === a.batchNumber
        );
        const pct = resolveOrderLineDiscountPct({
          itemDiscount: (item as any).discountPercentage,
          allocationDiscount: a.discountPercentage,
          medicineId: item.medicineId,
          batchNumber: a.batchNumber,
          purchaseLookup: purchaseDiscountLookup,
          batch: batchFromInventory
            ? {
                mrp: batchFromInventory.mrp,
                purchasePrice: batchFromInventory.purchasePrice,
                discountPercentage: batchFromInventory.discountPercentage,
                batchNumber: a.batchNumber,
              }
            : undefined,
          gstRate,
          discountManuallySet,
        });
        return Math.max(best, pct);
      }, 0);
      displayDiscountPercentage = allocs.reduce((best: number, a: any) => {
        const batchFromInventory = medicineDetails?.stockBatches?.find(
          (b: any) => b.batchNumber === a.batchNumber
        );
        const pct = resolveOrderLineDisplayDiscountPct({
          itemDiscount: (item as any).discountPercentage,
          allocationDiscount: a.discountPercentage,
          medicineId: item.medicineId,
          batchNumber: a.batchNumber,
          purchaseLookup: purchaseDiscountLookup,
          batch: batchFromInventory
            ? {
                mrp: batchFromInventory.mrp,
                purchasePrice: batchFromInventory.purchasePrice,
                discountPercentage: batchFromInventory.discountPercentage,
                batchNumber: a.batchNumber,
              }
            : undefined,
          gstRate,
          discountManuallySet,
        });
        return Math.max(best, pct);
      }, 0);
    } else {
      discountPercentage = resolveOrderLineDiscountPct({
        itemDiscount: (item as any).discountPercentage,
        medicineId: item.medicineId,
        batchNumber: primaryBatchNumber,
        purchaseLookup: purchaseDiscountLookup,
        batch: primaryBatch
          ? {
              mrp: primaryBatch.mrp,
              purchasePrice: primaryBatch.purchasePrice,
              discountPercentage: primaryBatch.discountPercentage,
              batchNumber: primaryBatchNumber,
            }
          : undefined,
        gstRate,
        discountManuallySet,
      });
      displayDiscountPercentage = resolveOrderLineDisplayDiscountPct({
        itemDiscount: (item as any).discountPercentage,
        medicineId: item.medicineId,
        batchNumber: primaryBatchNumber,
        purchaseLookup: purchaseDiscountLookup,
        batch: primaryBatch
          ? {
              mrp: primaryBatch.mrp,
              purchasePrice: primaryBatch.purchasePrice,
              discountPercentage: primaryBatch.discountPercentage,
              batchNumber: primaryBatchNumber,
            }
          : undefined,
        gstRate,
        discountManuallySet,
      });
    }

    let price = 0;
    if (allocs && allocs.length === 1 && toNumber(allocs[0].purchasePrice) > 0) {
      price = toNumber(allocs[0].purchasePrice);
    } else if (allocs && allocs.length > 1) {
      const sumPaid = allocs.reduce((s: number, a: any) => s + toNumber(a.quantity), 0);
      const sumAmount = allocs.reduce(
        (s: number, a: any) => s + toNumber(a.purchasePrice) * toNumber(a.quantity),
        0
      );
      if (sumPaid > 0 && sumAmount > 0) price = sumAmount / sumPaid;
    }
    if (price <= 0 && allocs && allocs.length === 1 && toNumber(primaryBatch?.purchasePrice) > 0) {
      price = toNumber(primaryBatch?.purchasePrice);
    }
    if (price <= 0) {
      price = firstPositiveFromAllocs('purchasePrice');
    }
    if (price <= 0 && toNumber(item.price) > 0) {
      price = toNumber(item.price);
    }
    if (price <= 0 && mrp > 0) {
      const sellDisc = resolveSellDiscountPct({
        batch: primaryBatch
          ? {
              mrp,
              purchasePrice: primaryBatch.purchasePrice,
              discountPercentage: primaryBatch.discountPercentage,
              batchNumber: primaryBatchNumber,
            }
          : { mrp, purchasePrice: toNumber(item.price) },
        gstRate,
        medicineId: item.medicineId,
        batchNumber: primaryBatchNumber,
        purchaseLookup: purchaseDiscountLookup,
      });
      price = unitPriceFromMrp(mrp, gstRate, sellDisc);
    }
    
    // Total Amount = Price × billable (paid) qty — free units are not charged
    const totalAmount = price * paidQty;
    
    // Discount = Total Amount * discountPercentage / 100
    const discountAmount = discountPercentage > 0 && totalAmount > 0
      ? (totalAmount * discountPercentage) / 100
      : 0;
    
    // Item amount in table = Price * Quantity (simple calculation - matches "Total" column)
    const itemAmount = totalAmount;
    
    // Subtotal = Sum of all "Total" column values (Price * Quantity)
    totalSubTotal += totalAmount;
    totalProductDiscount += discountAmount;
    
    // Format expiry date
    const resolvedExpiry =
      item.expiryDate ||
      allocs?.[0]?.expiryDate ||
      primaryBatch?.expiryDate;
    let expDate = '-';
    if (resolvedExpiry) {
      let exp: Date;
      if (resolvedExpiry instanceof Date) {
        exp = resolvedExpiry;
      } else if (resolvedExpiry && typeof resolvedExpiry.toDate === 'function') {
        exp = resolvedExpiry.toDate();
      } else if (typeof resolvedExpiry === 'string' || typeof resolvedExpiry === 'number') {
        exp = new Date(resolvedExpiry);
      } else {
        exp = new Date();
      }
      expDate = format(exp, 'MM/yy');
    }
    
    // Get packaging from medicine master data
    const packaging = item.medicineId ? (medicineMap.get(item.medicineId) || '-') : '-';

    return {
      sn: index + 1,
      name: formatInvoiceProductName(item.name || 'Unknown'),
      pack: packaging,
      hsn: (item as any).hsn || '300490',
      batch:
        item.batchNumber ||
        (allocs && allocs.length > 0
          ? allocs
              .map((a: any) => a.batchNumber)
              .filter((b: unknown): b is string => Boolean(b))
              .join(', ') || '-'
          : '-'),
      exp: expDate,
      qty: quantity.toFixed(2),
      free: freeQuantity > 0 ? freeQuantity.toFixed(2) : '0.00',
      totalQty: totalQty.toFixed(2),
      mrp: mrp > 0 ? mrp.toFixed(2) : '-',
      rate: price.toFixed(2), // Price is already after discount
      disc: displayDiscountPercentage > 0 ? displayDiscountPercentage.toFixed(2) : '0.00',
      gst: formatInvoiceLineGst(gstRate),
      amount: itemAmount.toFixed(2),
      rowClass: '',
    };
  });
  
  // Subtotal is sum of all "Total" column values (Price * Quantity)
  // Calculate tax on (Subtotal - Product Discount) using order's tax percentage
  // Note: Bill discount has been removed from calculations
  const amountAfterDiscount = totalSubTotal - totalProductDiscount;
  const taxPercentage = order.taxPercentage || 5;
  const totalGST = (amountAfterDiscount * taxPercentage) / 100;
  const totalSGST = totalGST / 2;
  const totalCGST = totalGST / 2;
  const calculatedTotal = amountAfterDiscount + totalGST;
  const roundoff = Math.round(calculatedTotal) - calculatedTotal;
  const grandTotal = Math.round(calculatedTotal);

  // Company details
  const company = { ...COMPANY_INVOICE_DETAILS };
  
  // Party/Retailer details - fetch from user if retailerId is available
  let party = {
    name: order.retailerName || order.retailerEmail || 'N/A',
    address: order.deliveryAddress || '',
    ...resolveInvoiceState(),
    phone: '',
    dl: '',
    gstin: '',
  };

  // Try to fetch retailer details if retailerId is available
  if (order.retailerId) {
    try {
      const retailer = await getUserProfile(order.retailerId);
      if (retailer) {
        const resolvedState = resolveInvoiceState();
        party = {
          name: retailer.shopName || retailer.displayName || retailer.email || party.name,
          address: retailer.address || retailer.location?.address || order.deliveryAddress || party.address,
          ...resolvedState,
          phone: retailer.phoneNumber || party.phone,
          dl: retailer.licenceNumber || retailer.licenceHolderName || party.dl,
          gstin: retailer.gst || party.gstin,
        };
      }
    } catch (error) {
      console.warn('Failed to fetch retailer details:', error);
      // Continue with order data
    }
  }

  // Invoice details
  const invoiceData = {
    no: formatOrderInvoiceLabel(order),
    date: format(invoiceDate, 'yyyy-MM-dd'),
    dueDate: format(invoiceDate, 'yyyy-MM-dd'),
    user: 'Admin',
    tray: order.trayNumber || '-',
    processedBy: order.processedBy || '-'
  };
  
  // Tax summary
  const tax = {
    taxable: amountAfterDiscount.toFixed(2),
    cgst: totalCGST.toFixed(2),
    sgst: totalSGST.toFixed(2),
    rate: taxPercentage.toFixed(0),
  };

  // Summary
  const summary = {
    subTotal: totalSubTotal.toFixed(2),
    discount: totalProductDiscount.toFixed(2),
    sgst: totalSGST.toFixed(2),
    cgst: totalCGST.toFixed(2),
    roundOff: roundoff.toFixed(2),
    grandTotal: grandTotal.toFixed(2),
    amountInWords: numberToWords(grandTotal),
  };

  return {
    items,
    summary,
    tax,
    invoiceData,
    company,
    party,
    gstRatePercent: taxPercentage,
  };
};

const getOrderInvoiceHTML = async (order: Order) => {
  const {
    items,
    summary,
    tax,
    invoiceData,
    company,
    party,
    gstRatePercent,
  } = await prepareOrderInvoiceData(order);

  const companyState = resolveInvoiceState();

  // Complete HTML template
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Sales GST Invoice</title>
<style>${GST_INVOICE_STYLES}</style>
</head>
<body>
<div class="invoice-box">
<!-- HEADER -->
<table>
  <tr>
    <td width="50%">
      <b>${company.name}</b><br>
      ${company.address}<br>
      ${invoiceStateHtml(companyState.state, companyState.stateCode)}
      Phone: ${company.phone}<br>
      Email: ${company.email}
    </td>
    <td width="50%">
      <b>${party.name}</b><br>
      Party Address: ${party.address}<br>
      ${invoiceStateHtml(party.state, party.stateCode)}
      Ph.No: ${party.phone}<br>
      Party D.L No: ${party.dl}<br>
      GST No: ${party.gstin}
    </td>
  </tr>
</table>
<!-- INVOICE INFO -->
<table>
  <tr>
    ${buildGstInvoiceTitleCell('SALES GST INVOICE', company.dl, company.gstin)}
    <td>
      Invoice No: ${invoiceData.no}<br>
      Due Date: ${invoiceData.dueDate}<br>
      User: ${invoiceData.user}
    </td>
    <td>
      Date: ${invoiceData.date}<br>
      Tray No: ${invoiceData.tray}<br>
      Processed By: ${invoiceData.processedBy}
    </td>
  </tr>
</table>
<!-- ITEM TABLE -->
${buildGstInvoiceItemTableHtml(items)}
<!-- TOTAL SECTION -->
${buildGstInvoiceTotalsSection(tax, summary, gstRatePercent / 2)}
<!-- FOOTER -->
${buildGstInvoiceFooter(order.dispatchNotes || '', summary.amountInWords, company.name)}
</div>
</body>
</html>
  `;
};

function escapeCsvField(value: string | number): string {
  const s = String(value ?? '');
  if (/[",\r\n\u2028\u2029]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Excel-friendly comma-separated invoice (matches PDF line-item columns plus header metadata). UTF-8 BOM. */
export function formatOrderInvoiceAsCsv(data: OrderInvoicePrepared): string {
  const { items, summary, tax, invoiceData, company, party, gstRatePercent } = data;

  const rows: string[][] = [
    ['Company Name', company.name],
    ['Company Address', company.address],
    ['Company GSTIN', company.gstin],
    ['Party Name', party.name],
    ['Party Address', party.address],
    ['Party GSTIN', party.gstin],
    ['Invoice No', invoiceData.no],
    ['Invoice Date', invoiceData.date],
    [],
    [
      'SN',
      'PRODUCT NAME',
      'PACK',
      'HSN',
      'BATCH',
      'EXP',
      'QTY',
      'FREE',
      'TQT',
      'MRP',
      'RATE',
      'DISC',
      'GST',
      'AMOUNT',
    ],
    ...items.map((it) => [
      String(it.sn),
      it.name,
      it.pack,
      it.hsn,
      it.batch,
      it.exp,
      it.qty,
      it.free,
      it.totalQty,
      it.mrp,
      it.rate,
      it.disc,
      it.gst,
      it.amount,
    ]),
    [],
    [
      'Tax summary',
      `Amt ${tax.rate}%: ${tax.taxable}; CGST ${(gstRatePercent / 2).toFixed(1)}%: ${tax.cgst}; SGST ${(
        gstRatePercent / 2
      ).toFixed(1)}%: ${tax.sgst}`,
    ],
    ['SUB TOTAL', summary.subTotal],
    ['PRODUCT DISCOUNT', summary.discount],
    ['SGST', summary.sgst],
    ['CGST', summary.cgst],
    ['ROUND OFF', summary.roundOff],
    ['GRAND TOTAL', summary.grandTotal],
  ];

  const body = rows.map((r) => r.map((c) => escapeCsvField(c)).join(',')).join('\r\n');
  return `\uFEFF${body}`;
}

export async function buildOrderInvoiceCsv(order: Order): Promise<string> {
  const data = await prepareOrderInvoiceData(order);
  return formatOrderInvoiceAsCsv(data);
}

export function csvUtf8ToDataUriBase64(csv: string): string {
  const utf8Bytes = new TextEncoder().encode(csv);
  let binary = '';
  utf8Bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return `data:text/csv;charset=utf-8;base64,${btoa(binary)}`;
}

function sanitizedOrderInvoicePdfFileName(order: Order): string {
  const raw = formatOrderInvoiceLabel(order)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = raw.length > 0 ? raw.slice(0, 80) : `order_${String(order.id).slice(0, 16)}`;
  return `${base}.pdf`;
}

function sanitizedOrderInvoiceCsvFileName(order: Order): string {
  const raw = formatOrderInvoiceLabel(order)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = raw.length > 0 ? raw.slice(0, 80) : `order_${String(order.id).slice(0, 16)}`;
  return `${base}.csv`;
}

export type GenerateOrderInvoiceOptions = {
  /**
   * Email PDF + CSV to `order.retailerEmail` via Cloud Function SMTP.
   * Runs after the file download; send happens in the background (promise resolves once PDF saves).
   */
  emailPdfToRetailer?: boolean;
};

export const generateOrderInvoice = async (
  order: Order,
  options?: GenerateOrderInvoiceOptions
) => {
  const html = await getOrderInvoiceHTML(order);
  
  // Create a temporary element to render HTML
  const element = document.createElement('div');
  element.innerHTML = html;
  element.style.width = '210mm'; // A4 width
  element.style.padding = '0';
  element.style.margin = '0';
  element.style.position = 'absolute';
  element.style.left = '-9999px';
  element.style.top = '0';
  document.body.appendChild(element);
  
  try {
    // Convert HTML to canvas
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      width: element.scrollWidth,
      height: element.scrollHeight
    });
    
    // Convert canvas to image
    const imgData = canvas.toDataURL('image/png');
    
    // Calculate PDF dimensions
    const imgWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    
    // Create PDF
    const pdf = new jsPDF('p', 'mm', 'a4');
    let position = 0;
    
    // Add first page
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    
    // Add additional pages if needed
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    
    // Save PDF
    pdf.save(`order-invoice-${order.id}.pdf`);

    if (options?.emailPdfToRetailer) {
      const em = order.retailerEmail?.trim();
      if (!em || !em.includes('@')) {
        await appAlert(
          'Invoice downloaded, but this order has no retailer email — the PDF could not be emailed.'
        );
      } else {
        // Snapshot PDF payload before teardown; SMTP + CSV can run slow — do not block download UX.
        const dataUri = pdf.output('datauristring');
        const fileName = sanitizedOrderInvoicePdfFileName(order);
        const csvFileName = sanitizedOrderInvoiceCsvFileName(order);
        void (async () => {
          try {
            const csvText = await buildOrderInvoiceCsv(order);
            const csvDataUri = csvUtf8ToDataUriBase64(csvText);
            const res = await sendOrderInvoicePdfToRetailer(order.id, dataUri, fileName, {
              csvBase64Uri: csvDataUri,
              csvFileName,
            });
            if (res.ok && res.emailedTo) {
              await appAlert(`Invoice emailed to ${res.emailedTo} (PDF and CSV).`);
            } else {
              await appAlert(
                'Invoice was downloaded but email delivery could not be confirmed — check Firebase logs.'
              );
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('Email invoice failed:', err);
            await appAlert(`Invoice downloaded, but emailing the retailer failed: ${message}`);
          }
        })();
      }
    }
  } catch (error) {
    console.error('Error generating PDF:', error);
    await appAlert('Failed to generate invoice. Please try again.');
  } finally {
    // Clean up
    document.body.removeChild(element);
  }
};

// HTML Template for Purchase Invoice
const getInvoiceHTML = async (invoice: PurchaseInvoice) => {
  const invoiceDate = invoice.invoiceDate instanceof Date ? invoice.invoiceDate : new Date(invoice.invoiceDate);
  
  // Calculate totals
  let totalSubTotal = 0;
  let totalProductDiscount = 0;
  // Note: totalGST will be calculated once at the end based on (Subtotal - Discount)
  
  // Fetch all medicines to get packaging info
  const medicineMap = new Map<string, string>();
  await Promise.all(
    invoice.items.map(async (item) => {
      if (item.medicineId) {
        try {
          const medicine = await getMedicineById(item.medicineId);
          if (medicine) {
            // Check unit field first
            let packaging = medicine.unit;
            
            // If unit is not available, check description for "Packaging: " pattern
            if (!packaging && medicine.description) {
              const packagingMatch = medicine.description.match(/Packaging:\s*(.+)/i);
              if (packagingMatch && packagingMatch[1]) {
                packaging = packagingMatch[1].trim();
              }
            }
            
            // Debug logging
            if (!packaging) {
              console.log(`No packaging found for medicine ${item.medicineId} (${item.medicineName}):`, {
                unit: medicine.unit,
                description: medicine.description,
                medicineData: medicine
              });
            }
            
            if (packaging) {
              medicineMap.set(item.medicineId, packaging);
            } else {
              // Set empty string so we know we tried
              medicineMap.set(item.medicineId, '-');
            }
          } else {
            console.warn(`Medicine not found for ID: ${item.medicineId}`);
            medicineMap.set(item.medicineId, '-');
          }
        } catch (error) {
          console.warn(`Failed to fetch medicine ${item.medicineId}:`, error);
          medicineMap.set(item.medicineId, '-');
        }
      } else {
        medicineMap.set('', '-');
      }
    })
  );
  
  const items = invoice.items.map((item, index) => {
    const quantity = item.quantity || 0;
    const freeQuantity = item.freeQuantity || 0;
    const totalQty = quantity + freeQuantity;
    const mrp = item.mrp || 0;
    const discountPercentage = item.discountPercentage || 0;
    const standardDiscount = (item as any).standardDiscount ?? 20;
    const gstRate = item.gstRate || 5;
    
    // Calculate price from MRP: apply item standard discount (fallback 20%), then remove inclusive GST.
    let price = 0;
    if (mrp > 0) {
      const afterDiscount = mrp * (1 - standardDiscount / 100);
      price = afterDiscount / (1 + gstRate / 100); // Remove inclusive GST
    } else {
      price = item.purchasePrice || 0;
    }
    
    // Total Amount = Price * Quantity (this is what's shown in the "Total" column)
    const totalAmount = price * quantity;
    
    // Discount = Total Amount * discountPercentage / 100
    const discountAmount = discountPercentage > 0 && totalAmount > 0
      ? (totalAmount * discountPercentage) / 100
      : 0;
    
    // Item amount in table = Price * Quantity (simple calculation - matches "Total" column)
    const itemAmount = totalAmount;
    
    // Subtotal = Sum of all "Total" column values (Price * Quantity)
    totalSubTotal += totalAmount;
    totalProductDiscount += discountAmount;
    
    // Format expiry date
    let expDate = '-';
    if (item.expiryDate) {
      let exp: Date;
      if (item.expiryDate instanceof Date) {
        exp = item.expiryDate;
      } else if (item.expiryDate && typeof item.expiryDate.toDate === 'function') {
        exp = item.expiryDate.toDate();
      } else if (typeof item.expiryDate === 'string' || typeof item.expiryDate === 'number') {
        exp = new Date(item.expiryDate);
      } else {
        exp = new Date();
      }
      expDate = format(exp, 'MM/yy');
    }
    
    // Get packaging from medicine master data
    const packaging = item.medicineId ? (medicineMap.get(item.medicineId) || '-') : '-';
    
    return {
      sn: index + 1,
      name: formatInvoiceProductName(item.medicineName || 'Unknown'),
      pack: packaging,
      hsn: (item as any).hsn || '300490',
      batch: item.batchNumber || '-',
      exp: expDate,
      qty: quantity.toFixed(2),
      free: freeQuantity > 0 ? freeQuantity.toFixed(2) : '0.00',
      totalQty: totalQty.toFixed(2),
      mrp: mrp > 0 ? mrp.toFixed(2) : '-',
      rate: price.toFixed(2),
      disc: discountPercentage > 0 ? discountPercentage.toFixed(2) : '0.00',
      gst: formatInvoiceLineGst(gstRate),
      amount: itemAmount.toFixed(2)
    };
  });
  
  // Subtotal is sum of all "Total" column values (Price * Quantity)
  // Calculate tax on (Subtotal - Product Discount) using average GST rate
  // Note: Bill discount has been removed from calculations
  const amountAfterDiscount = totalSubTotal - totalProductDiscount;
  const avgGstRate = invoice.items.length > 0
    ? invoice.items.reduce((sum, item) => sum + (item.gstRate || 5), 0) / invoice.items.length
    : 5;
  const totalGST = (amountAfterDiscount * avgGstRate) / 100;
  const totalSGST = totalGST / 2;
  const totalCGST = totalGST / 2;
  const calculatedTotal = amountAfterDiscount + totalGST;
  const roundoff = Math.round(calculatedTotal) - calculatedTotal;
  const grandTotal = Math.round(calculatedTotal);
  
  // Tax summary
  const taxableAmount = amountAfterDiscount;
  const tax = {
    taxable: taxableAmount.toFixed(2),
    cgst: totalCGST.toFixed(2),
    sgst: totalSGST.toFixed(2),
    rate: avgGstRate.toFixed(0)
  };
  
  // Summary (calculated after tax calculations)
  const summary = {
    subTotal: totalSubTotal.toFixed(2),
    discount: totalProductDiscount.toFixed(2),
    sgst: totalSGST.toFixed(2),
    cgst: totalCGST.toFixed(2),
    roundOff: roundoff.toFixed(2),
    grandTotal: grandTotal.toFixed(2),
    amountInWords: numberToWords(grandTotal),
  };
  
  // Party details - buyer (SimpliPharma / Sanchet on purchase invoices)
  const party = { ...COMPANY_INVOICE_DETAILS, ...resolveInvoiceState() };

  // Company/Vendor details - fetch from vendor if vendorId is available (on top left)
  let company = {
    name: invoice.vendorName || 'N/A',
    address: (invoice as any).vendorAddress || '',
    phone: (invoice as any).vendorPhone || (invoice as any).phoneNumber || '',
    email: (invoice as any).vendorEmail || '',
    dl: (invoice as any).vendorDL || (invoice as any).drugLicenseNumber || '',
    gstin: (invoice as any).vendorGST || (invoice as any).gstNumber || '',
    ...resolveInvoiceState(),
  };
  
  // Try to fetch vendor details if vendorId is available
  if (invoice.vendorId) {
    try {
      const vendor = await getVendorById(invoice.vendorId);
      if (vendor) {
        company = {
          name: vendor.vendorName || company.name,
          address: vendor.address || company.address,
          phone: vendor.phoneNumber || company.phone,
          email: vendor.email || company.email,
          dl: vendor.drugLicenseNumber || company.dl,
          gstin: vendor.gstNumber || company.gstin,
          ...resolveInvoiceState(),
        };
      }
    } catch (error) {
      console.warn('Failed to fetch vendor details:', error);
      // Continue with invoice data
    }
  }
  
  // Invoice details
  const invoiceData = {
    no: invoice.invoiceNumber,
    date: format(invoiceDate, 'yyyy-MM-dd'),
    dueDate: format(invoiceDate, 'yyyy-MM-dd'),
    user: invoice.createdBy || 'Admin',
    tray: '-'
  };
  
  // Complete HTML template
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Purchase GST Invoice</title>
<style>${GST_INVOICE_STYLES}</style>
</head>
<body>
<div class="invoice-box">
<!-- HEADER -->
<table>
  <tr>
    <td width="50%">
      <b>${company.name}</b><br>
      ${company.address}<br>
      ${invoiceStateHtml(company.state, company.stateCode)}
      Phone: ${company.phone}<br>
      Email: ${company.email}
    </td>
    <td width="50%">
      <b>${party.name}</b><br>
      Party Address: ${party.address}<br>
      ${invoiceStateHtml(party.state, party.stateCode)}
      Ph.No: ${party.phone}<br>
      Party D.L No: ${party.dl}<br>
      GST No: ${party.gstin}
    </td>
  </tr>
</table>
<!-- INVOICE INFO -->
<table>
  <tr>
    ${buildGstInvoiceTitleCell('PURCHASE GST INVOICE', company.dl, company.gstin)}
    <td>
      Invoice No: ${invoiceData.no}<br>
      Due Date: ${invoiceData.dueDate}<br>
      User: ${invoiceData.user}
    </td>
    <td>
      Date: ${invoiceData.date}
    </td>
  </tr>
</table>
<!-- ITEM TABLE -->
${buildGstInvoiceItemTableHtml(items)}
<!-- TOTAL SECTION -->
${buildGstInvoiceTotalsSection(tax, summary, avgGstRate / 2)}
<!-- FOOTER -->
${buildGstInvoiceFooter(invoice.notes || '', summary.amountInWords, party.name)}
</div>
</body>
</html>
  `;
};

export const generatePurchaseInvoice = async (invoice: PurchaseInvoice) => {
  const html = await getInvoiceHTML(invoice);
  
  // Create a temporary element to render HTML
  const element = document.createElement('div');
  element.innerHTML = html;
  element.style.width = '210mm'; // A4 width
  element.style.padding = '0';
  element.style.margin = '0';
  element.style.position = 'absolute';
  element.style.left = '-9999px';
  element.style.top = '0';
  document.body.appendChild(element);
  
  try {
    // Convert HTML to canvas
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      width: element.scrollWidth,
      height: element.scrollHeight
    });
    
    // Convert canvas to image
    const imgData = canvas.toDataURL('image/png');
    
    // Calculate PDF dimensions
    const imgWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    
    // Create PDF
    const pdf = new jsPDF('p', 'mm', 'a4');
    let position = 0;
    
    // Add first page
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    
    // Add additional pages if needed
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    
    // Save PDF
    pdf.save(`purchase-invoice-${invoice.invoiceNumber}.pdf`);
  } catch (error) {
    console.error('Error generating PDF:', error);
    await appAlert('Failed to generate invoice. Please try again.');
  } finally {
    // Clean up
    document.body.removeChild(element);
  }
};
