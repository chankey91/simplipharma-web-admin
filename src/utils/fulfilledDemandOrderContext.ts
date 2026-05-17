import { OrderMedicine, ProductDemand, Medicine, PurchaseInvoice } from '../types';
import { collectPurchaseInvoicesForDemands } from '../services/purchaseInvoices';
import { syncDemandPurchaseInvoiceRefs } from '../services/productDemands';
import { repairFulfilledDemandOrderLines } from './productDemandOrderLine';

/** Load referenced PIs, sync demand refs, and rebuild fulfilled product-request order lines. */
export async function prepareFulfilledDemandOrderMedicines(
  orderMedicines: OrderMedicine[],
  orderId: string,
  demands: ProductDemand[],
  medicineList: Medicine[],
  baseInvoices: PurchaseInvoice[] | undefined
): Promise<{
  demands: ProductDemand[];
  invoices: PurchaseInvoice[];
  medicines: OrderMedicine[];
  changed: boolean;
}> {
  const orderDemands = demands.filter(
    (d) => d.orderId === orderId || orderMedicines.some((m) => m.productDemandId === d.id)
  );
  const mergedInvoices = await collectPurchaseInvoicesForDemands(baseInvoices, orderDemands);
  const demandsWithPi = await syncDemandPurchaseInvoiceRefs(
    orderDemands,
    mergedInvoices,
    orderMedicines
  );
  const { medicines, changed } = repairFulfilledDemandOrderLines(
    orderMedicines,
    demandsWithPi,
    medicineList,
    mergedInvoices,
    orderId
  );
  return { demands: demandsWithPi, invoices: mergedInvoices, medicines, changed };
}
