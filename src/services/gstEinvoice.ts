import { loadGstPeriodBooks, gstDocDate } from './gstPeriodBooks';
import { getAllStores } from './stores';
import { hasGstSnapshot } from '../utils/gstSnapshot';
import { buildEinvoicePayload, type EinvoiceExportResult } from '../utils/einvoiceJson';
import { gstinStateCode } from '../utils/gstin';

export async function buildEinvoiceExport(date = new Date()): Promise<EinvoiceExportResult> {
  const [books, stores] = await Promise.all([loadGstPeriodBooks(date), getAllStores()]);
  const storeById = new Map(stores.map((s) => [s.id, s]));

  const invoices = books.orders
    .filter(
      (order) =>
        order.invoiceNumber &&
        order.status !== 'Pending' &&
        order.status !== 'Cancelled' &&
        hasGstSnapshot(order) &&
        order.gst?.invoiceType === 'B2B'
    )
    .map((order) => {
      const store = storeById.get(order.retailerId);
      return {
        number: order.invoiceNumber as string,
        date: gstDocDate(order.orderDate),
        totalAmount: order.totalAmount || 0,
        gst: order.gst!,
        buyerName: store?.shopName || store?.displayName || order.retailerName,
        buyerAddress: store?.address,
        buyerPincode: undefined,
        buyerStateCode: gstinStateCode(store?.gst) || order.gst?.placeOfSupplyStateCode,
        hsn: order.medicines?.find((m) => m.hsn)?.hsn,
      };
    });

  return buildEinvoicePayload({
    settings: books.settings,
    invoices,
    date,
  });
}
