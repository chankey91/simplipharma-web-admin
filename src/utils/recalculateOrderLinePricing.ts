import { Medicine, OrderMedicine } from '../types';
import {
  type PurchaseBatchDiscountLookup,
  findStockBatch,
  resolveOrderLineTradeDiscountPct,
  resolveSellDiscountPct,
  toSellDiscountBatch,
  unitPriceFromBatch,
} from './orderFulfillmentDiscount';

const toNum = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
};

/** Recompute sell unit price + discount % from current inventory batch standard discount. */
export function recalculateFulfillmentMedicinePricing(
  line: OrderMedicine,
  medicine: Medicine | undefined,
  purchaseLookup: PurchaseBatchDiscountLookup
): OrderMedicine {
  if (line.lineType === 'product_demand' && !line.medicineId) return line;
  if (!line.medicineId) return line;

  const defaultGst = toNum(medicine?.gstRate) || toNum(line.gstRate) || 5;

  const pricingForBatch = (
    batchNumber: string,
    allocMrp?: number,
    allocGst?: number
  ): { purchasePrice: number; discountPercentage: number; mrp?: number; gstRate: number } => {
    const stockBatch = findStockBatch(medicine, batchNumber);
    const gstRate = allocGst && allocGst > 0 ? allocGst : defaultGst;
    const mrp = toNum(allocMrp) || toNum(stockBatch?.mrp) || toNum(line.mrp);
    const sellBatch = toSellDiscountBatch(stockBatch, batchNumber, mrp, gstRate);

    const discountPercentage = resolveOrderLineTradeDiscountPct({
      batch: sellBatch,
      medicineId: line.medicineId,
      batchNumber,
      purchaseLookup,
    });
    const purchasePrice =
      mrp > 0
        ? unitPriceFromBatch(sellBatch, gstRate, { medicineId: line.medicineId, purchaseLookup })
        : toNum(stockBatch?.purchasePrice) || toNum(line.price);

    return {
      purchasePrice,
      discountPercentage,
      mrp: mrp > 0 ? mrp : undefined,
      gstRate,
    };
  };

  if (line.batchAllocations && line.batchAllocations.length > 0) {
    const batchAllocations = line.batchAllocations.map((a) => {
      const p = pricingForBatch(a.batchNumber, a.mrp, a.gstRate);
      return {
        ...a,
        mrp: p.mrp ?? a.mrp,
        gstRate: p.gstRate,
        purchasePrice: p.purchasePrice,
        discountPercentage: p.discountPercentage,
      };
    });
    return {
      ...line,
      batchAllocations,
      price:
        batchAllocations.length === 1
          ? toNum(batchAllocations[0].purchasePrice)
          : line.price,
      mrp: batchAllocations[0]?.mrp ?? line.mrp,
      discountPercentage: batchAllocations[0]?.discountPercentage,
      gstRate: batchAllocations[0]?.gstRate ?? line.gstRate,
      discountManuallySet: false,
    };
  }

  if (line.batchNumber) {
    const p = pricingForBatch(line.batchNumber, line.mrp, line.gstRate);
    return {
      ...line,
      price: p.purchasePrice,
      mrp: p.mrp ?? line.mrp,
      discountPercentage: p.discountPercentage,
      gstRate: p.gstRate,
      discountManuallySet: false,
    };
  }

  return line;
}

export function recalculateMedicinesPricingFromInventory(
  lines: OrderMedicine[],
  medicines: Medicine[] | undefined,
  purchaseLookup: PurchaseBatchDiscountLookup
): OrderMedicine[] {
  const medById = new Map((medicines || []).map((m) => [m.id, m]));
  return lines.map((line) =>
    recalculateFulfillmentMedicinePricing(line, medById.get(line.medicineId), purchaseLookup)
  );
}
