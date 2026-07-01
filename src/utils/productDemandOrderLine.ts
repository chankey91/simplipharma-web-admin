import {
  OrderMedicine,
  ProductDemand,
  Medicine,
  StockBatch,
  PurchaseInvoice,
  PurchaseInvoiceItem,
} from '../types';

import {
  resolveSellDiscountPct,
  unitPriceFromBatch,
  unitPriceFromMrp,
} from './orderFulfillmentDiscount';

const toNumber = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

function toDateMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') return maybe.toDate().getTime();
  const t = new Date(value as string | number).getTime();
  return Number.isFinite(t) ? t : 0;
}

function normalizeName(value: string | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Strict product name match (exact or clear prefix variant, e.g. "dolofresh sp" / "dolofresh sp tablet"). */
function namesMatchProduct(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (!longer.startsWith(shorter)) return false;
  return longer.length === shorter.length || longer[shorter.length] === ' ';
}

/** Looser match for linking order lines to demand docs by retailer-entered name. */
function namesMatchLoose(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return namesMatchProduct(a, b);
}

/** Prefer in-stock batches; newest purchase date first (this medicine only). */
export function pickBestStockBatch(med: Medicine): StockBatch | undefined {
  const batches = med.stockBatches || [];
  if (!batches.length) return undefined;
  const withStock = batches.filter((b) => toNumber(b.quantity) > 0);
  const pool = withStock.length > 0 ? withStock : batches;
  return [...pool].sort((a, b) => toDateMs(b.purchaseDate) - toDateMs(a.purchaseDate))[0];
}

export function purchasePriceFromMrp(
  mrp: number,
  gstRate: number,
  batch?: Pick<StockBatch, 'purchasePrice' | 'discountPercentage' | 'batchNumber'>,
  medicineId?: string
): number {
  if (mrp <= 0) return 0;
  if (batch) {
    return unitPriceFromBatch({ ...batch, mrp }, gstRate, { medicineId });
  }
  return unitPriceFromMrp(mrp, gstRate, resolveSellDiscountPct({ batch: { mrp }, gstRate }));
}

export function medicinePriceForOrderLine(med: Pick<Medicine, 'salesPrice' | 'price'>): number {
  const sales = toNumber(med.salesPrice);
  if (sales > 0) return sales;
  return toNumber(med.price);
}

/**
 * On a single PI, pick the line for this demand — requested product name wins over medicineId
 * (avoids copying another product's line when the wrong master medicine was linked at fulfill).
 */
function findItemOnInvoice(
  inv: PurchaseInvoice,
  demand: ProductDemand,
  orderLineName?: string
): PurchaseInvoiceItem | undefined {
  if (!inv.items?.length) return undefined;

  const nameCandidates = [
    demand.productName,
    orderLineName,
    demand.fulfilledMedicineName,
  ].filter((n): n is string => Boolean(n?.trim()));

  for (const candidate of nameCandidates) {
    const match = inv.items.find((item) => namesMatchProduct(item.medicineName, candidate));
    if (match) return match;
  }

  if (demand.fulfilledMedicineId) {
    const byMedId = inv.items.find((item) => item.medicineId === demand.fulfilledMedicineId);
    if (byMedId && namesMatchProduct(byMedId.medicineName, demand.productName)) return byMedId;
  }

  return undefined;
}

/**
 * Find PI line for a fulfilled demand. Uses purchaseInvoiceId (Firestore doc id or invoice number).
 */
/** When demand has no PI ref, use the only PI that contains a line for the requested product. */
export function inferPurchaseInvoiceIdForDemand(
  demand: ProductDemand,
  invoices: PurchaseInvoice[],
  orderLineName?: string
): string | undefined {
  let foundId: string | undefined;
  for (const inv of invoices) {
    const item = findItemOnInvoice(inv, demand, orderLineName);
    if (!item) continue;
    if (foundId && foundId !== inv.id) return undefined;
    foundId = inv.id;
  }
  return foundId;
}

export function withInferredPurchaseInvoiceId(
  demand: ProductDemand,
  invoices: PurchaseInvoice[] | undefined,
  orderLineName?: string
): ProductDemand {
  if (demand.purchaseInvoiceId?.trim() || !invoices?.length) return demand;
  const inferred = inferPurchaseInvoiceIdForDemand(demand, invoices, orderLineName);
  return inferred ? { ...demand, purchaseInvoiceId: inferred } : demand;
}

export function findPiItemForFulfilledDemand(
  invoices: PurchaseInvoice[] | undefined,
  demand: ProductDemand,
  orderLineName?: string
): PurchaseInvoiceItem | undefined {
  if (!invoices?.length) return undefined;

  const ref = demand.purchaseInvoiceId?.trim();
  const ordered = [...invoices].sort(
    (a, b) => toDateMs(b.invoiceDate) - toDateMs(a.invoiceDate)
  );

  if (ref) {
    const scoped = ordered.filter((i) => i.id === ref || i.invoiceNumber === ref);
    for (const inv of scoped) {
      const item = findItemOnInvoice(inv, demand, orderLineName);
      if (item) return item;
    }
    return undefined;
  }

  for (const inv of ordered) {
    const item = findItemOnInvoice(inv, demand, orderLineName);
    if (item) return item;
  }

  return undefined;
}

function stockBatchForPiLine(med: Medicine, piItem: PurchaseInvoiceItem): StockBatch | undefined {
  const onHand = med.stockBatches?.find((b) => b.batchNumber === piItem.batchNumber);
  if (onHand) return onHand;
  return {
    id: piItem.batchNumber,
    batchNumber: piItem.batchNumber,
    quantity: piItem.quantity,
    expiryDate: piItem.expiryDate,
    mfgDate: piItem.mfgDate,
    purchasePrice: piItem.purchasePrice,
    mrp: piItem.mrp,
    discountPercentage: piItem.discountPercentage,
    schemePaidQty: piItem.schemePaidQty,
    schemeFreeQty: piItem.schemeFreeQty,
  };
}

/** Resolve demand for an order line (by id or product name on this order). */
export function findDemandForOrderLine(
  line: OrderMedicine,
  demands: ProductDemand[] | undefined,
  orderId?: string
): ProductDemand | undefined {
  if (!demands?.length) return undefined;
  if (line.productDemandId) {
    const linked = demands.find((d) => d.id === line.productDemandId);
    if (linked) return linked;
  }
  if (!orderId || !normalizeName(line.name)) return undefined;
  const byName = demands.filter(
    (d) =>
      d.orderId === orderId &&
      d.status === 'fulfilled' &&
      namesMatchLoose(d.productName, line.name)
  );
  if (byName.length === 1) return byName[0];
  if (line.lineType === 'product_demand') {
    return demands.find(
      (d) =>
        d.orderId === orderId &&
        d.status === 'fulfilled' &&
        namesMatchLoose(d.productName, line.name)
    );
  }
  return undefined;
}

function pricingSignature(line: OrderMedicine): string {
  const a = line.batchAllocations?.[0];
  return [
    line.medicineId,
    line.name,
    line.price,
    line.mrp,
    a?.batchNumber,
    a?.purchasePrice,
    a?.mrp,
  ].join('|');
}

export function fulfilledDemandLineChanged(before: OrderMedicine, after: OrderMedicine): boolean {
  return pricingSignature(before) !== pricingSignature(after);
}

function resolveMedicineForPiItem(
  piItem: PurchaseInvoiceItem | undefined,
  demand: ProductDemand,
  medicines: Medicine[] | undefined,
  fallbackMed: Medicine | undefined
): Medicine | undefined {
  if (piItem?.medicineId && medicines) {
    const fromPi = medicines.find((m) => m.id === piItem.medicineId);
    if (fromPi) return fromPi;
  }
  if (fallbackMed) return fallbackMed;
  if (demand.fulfilledMedicineId && medicines) {
    return medicines.find((m) => m.id === demand.fulfilledMedicineId);
  }
  return undefined;
}

/**
 * Build order line from fulfilled demand + PI line (requested product name on PI is authoritative).
 */
export function buildFulfilledDemandOrderLine(
  line: OrderMedicine,
  demand: ProductDemand,
  invoices: PurchaseInvoice[] | undefined,
  medicines: Medicine[] | undefined,
  quantityOverride?: number
): OrderMedicine {
  const qty =
    quantityOverride != null && quantityOverride > 0
      ? Math.floor(quantityOverride)
      : Math.max(
          1,
          Math.floor(
            toNumber(demand.fulfilledCartQuantity) ||
              toNumber(line.quantity) ||
              demand.requestedQuantity ||
              1
          )
        );

  const hasPiRef = Boolean(demand.purchaseInvoiceId?.trim());
  const fallbackMed = medicines?.find((m) => m.id === demand.fulfilledMedicineId);
  const piItem = findPiItemForFulfilledDemand(invoices, demand, line.name);
  const med = resolveMedicineForPiItem(piItem, demand, medicines, piItem ? undefined : fallbackMed);

  if (hasPiRef && !piItem) {
    return {
      ...line,
      lineType: undefined,
      medicineId: line.medicineId || demand.fulfilledMedicineId || '',
      name: demand.productName || line.name,
      productDemandId: demand.id,
      quantity: qty,
      originalQuantity: line.originalQuantity || qty,
      batchAllocations: undefined,
      batchNumber: undefined,
      expiryDate: undefined,
      mrp: undefined,
      price: line.price,
      gstRate: line.gstRate,
      discountPercentage: line.discountPercentage,
      freeQuantity: line.freeQuantity ?? 0,
    };
  }

  if (!med) {
    return {
      ...line,
      lineType: undefined,
      medicineId: demand.fulfilledMedicineId || line.medicineId,
      name: demand.fulfilledMedicineName || demand.productName || line.name,
      productDemandId: demand.id,
    };
  }

  const stockBatch = piItem
    ? stockBatchForPiLine(med, piItem)
    : hasPiRef
      ? undefined
      : pickBestStockBatch(med);

  const gstRate = piItem?.gstRate ?? med.gstRate ?? line.gstRate ?? 5;

  let mrp = toNumber(piItem?.mrp);
  if (mrp <= 0 && stockBatch?.mrp) mrp = toNumber(stockBatch.mrp);
  if (mrp <= 0) mrp = toNumber(med.mrp);

  let price = toNumber(piItem?.purchasePrice);
  if (price <= 0 && stockBatch?.purchasePrice) price = toNumber(stockBatch.purchasePrice);
  if (price <= 0 && mrp > 0 && !piItem) {
    price = purchasePriceFromMrp(mrp, gstRate, stockBatch, med.id);
  }
  if (price <= 0) price = medicinePriceForOrderLine(med);

  let discountPct =
    stockBatch && mrp > 0
      ? resolveSellDiscountPct({
          batch: { ...stockBatch, mrp, batchNumber: stockBatch.batchNumber },
          gstRate,
          medicineId: med.id,
        })
      : piItem?.discountPercentage ?? stockBatch?.discountPercentage ?? line.discountPercentage ?? 0;

  const displayName =
    piItem?.medicineName ||
    med.name ||
    demand.fulfilledMedicineName ||
    demand.productName ||
    line.name;

  const result: OrderMedicine = {
    medicineId: piItem?.medicineId || med.id,
    name: displayName,
    price,
    quantity: qty,
    originalQuantity: line.originalQuantity || qty,
    mrp: mrp > 0 ? mrp : undefined,
    gstRate,
    productDemandId: demand.id,
    notes: line.notes ?? demand.notes,
    freeQuantity: 0,
    discountPercentage: discountPct,
    batchAllocations: undefined,
    batchNumber: undefined,
    expiryDate: undefined,
  };

  const batchNumber = piItem?.batchNumber || stockBatch?.batchNumber;
  if (batchNumber) {
    const batchMrp = toNumber(piItem?.mrp) || toNumber(stockBatch?.mrp) || mrp;
    const batchPrice = toNumber(piItem?.purchasePrice) || toNumber(stockBatch?.purchasePrice) || price;
    result.batchAllocations = [
      {
        batchNumber,
        quantity: qty,
        expiryDate: piItem?.expiryDate ?? stockBatch?.expiryDate,
        mrp: batchMrp > 0 ? batchMrp : undefined,
        purchasePrice: batchPrice > 0 ? batchPrice : undefined,
        gstRate,
        discountPercentage: piItem?.discountPercentage ?? stockBatch?.discountPercentage,
        schemePaidQty: piItem?.schemePaidQty ?? stockBatch?.schemePaidQty,
        schemeFreeQty: piItem?.schemeFreeQty ?? stockBatch?.schemeFreeQty,
      },
    ];
    result.expiryDate = result.batchAllocations[0].expiryDate;
  }

  return result;
}

export function tryPromoteFulfilledDemandLine(
  line: OrderMedicine,
  demands: ProductDemand[] | undefined,
  medicines: Medicine[] | undefined,
  invoices?: PurchaseInvoice[],
  orderId?: string
): OrderMedicine {
  if (!demands?.length) return line;

  const demand = findDemandForOrderLine(line, demands, orderId);
  if (!demand || demand.status !== 'fulfilled') return line;

  const demandWithPi = withInferredPurchaseInvoiceId(demand, invoices, line.name);
  const rebuilt = buildFulfilledDemandOrderLine(line, demandWithPi, invoices, medicines);
  if (!line.productDemandId) {
    rebuilt.productDemandId = demand.id;
  }
  return rebuilt;
}

export function repairFulfilledDemandOrderLines(
  medicines: OrderMedicine[],
  demands: ProductDemand[],
  medicineList: Medicine[],
  invoices: PurchaseInvoice[] | undefined,
  orderId?: string
): { medicines: OrderMedicine[]; changed: boolean } {
  let changed = false;
  const next = medicines.map((m) => {
    const repaired = tryPromoteFulfilledDemandLine(m, demands, medicineList, invoices, orderId);
    if (fulfilledDemandLineChanged(m, repaired)) changed = true;
    return repaired;
  });
  return { medicines: next, changed };
}

export function orderLineFromFulfilledDemand(
  line: OrderMedicine,
  demand: ProductDemand,
  med: Medicine,
  quantityOverride?: number,
  invoices?: PurchaseInvoice[],
  medicines?: Medicine[]
): OrderMedicine {
  return buildFulfilledDemandOrderLine(line, demand, invoices, medicines, quantityOverride);
}

export function serializePromotedDemandLine(line: OrderMedicine): Record<string, unknown> {
  const out: Record<string, unknown> = {
    medicineId: line.medicineId,
    name: line.name,
    price: line.price,
    quantity: line.quantity,
    originalQuantity: line.originalQuantity ?? line.quantity,
    freeQuantity: line.freeQuantity ?? 0,
    productDemandId: line.productDemandId,
  };
  if (line.notes) out.notes = line.notes;
  if (line.mrp != null) out.mrp = line.mrp;
  if (line.gstRate != null) out.gstRate = line.gstRate;
  if (line.discountPercentage != null) out.discountPercentage = line.discountPercentage;
  if (line.batchNumber) out.batchNumber = line.batchNumber;
  if (line.expiryDate) out.expiryDate = line.expiryDate;
  if (line.batchAllocations?.length) {
    out.batchAllocations = line.batchAllocations.map((a) => {
      const alloc: Record<string, unknown> = {
        batchNumber: a.batchNumber,
        quantity: a.quantity,
      };
      if (a.expiryDate) alloc.expiryDate = a.expiryDate;
      if (a.mrp != null) alloc.mrp = a.mrp;
      if (a.purchasePrice != null) alloc.purchasePrice = a.purchasePrice;
      if (a.gstRate != null) alloc.gstRate = a.gstRate;
      if (a.discountPercentage != null) alloc.discountPercentage = a.discountPercentage;
      if (a.schemePaidQty != null) alloc.schemePaidQty = a.schemePaidQty;
      if (a.schemeFreeQty != null) alloc.schemeFreeQty = a.schemeFreeQty;
      if (a.allocationFreeQty != null) alloc.allocationFreeQty = a.allocationFreeQty;
      return alloc;
    });
  }
  return out;
}
