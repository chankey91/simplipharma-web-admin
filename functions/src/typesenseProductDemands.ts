/** Typesense sync + search for `product_demands` (see typesenseSync.ts). */
import { createTypesenseSync, tsMillis } from './typesenseSync';

const productDemandSync = createTypesenseSync({
  collectionName: 'product_demands',
  fields: [
    { name: 'docId', type: 'string', sort: true },
    { name: 'productName', type: 'string', sort: true },
    { name: 'manufacturerName', type: 'string', optional: true, sort: true },
    { name: 'retailerName', type: 'string', optional: true, sort: true },
    { name: 'retailerEmail', type: 'string', optional: true, sort: true },
    { name: 'retailerSort', type: 'string', optional: true, sort: true },
    { name: 'search_blob', type: 'string', optional: true },
    { name: 'status', type: 'string', facet: true, sort: true },
    { name: 'requestedQuantity', type: 'int32', sort: true },
    { name: 'requestedUnit', type: 'string', optional: true },
    { name: 'createdAt', type: 'int64', sort: true },
  ],
  queryBy: 'search_blob,productName,manufacturerName,retailerName,retailerEmail',
  sortableFields: [
    'docId',
    'productName',
    'manufacturerName',
    'retailerName',
    'retailerSort',
    'requestedQuantity',
    'status',
    'createdAt',
  ],
  defaultSort: 'createdAt',
  facetField: 'status',
  buildDoc: (id, data) => {
    if (!data) return null;
    const productName = String(data.productName || '');
    const manufacturerName = String(data.manufacturerName || '');
    const retailerName = String(data.retailerName || '');
    const retailerEmail = String(data.retailerEmail || '');
    const notes = typeof data.notes === 'string' ? data.notes : '';
    const searchBlob = [productName, manufacturerName, retailerName, retailerEmail, notes]
      .filter((x) => x && String(x).trim() !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    const rqRaw = data.requestedQuantity;
    let requestedQuantity = 1;
    if (typeof rqRaw === 'number' && Number.isFinite(rqRaw)) {
      requestedQuantity = Math.max(1, Math.floor(rqRaw));
    } else if (rqRaw != null && rqRaw !== '') {
      const p = parseInt(String(rqRaw), 10);
      if (!isNaN(p) && p >= 1) requestedQuantity = p;
    }

    return {
      id,
      docId: id,
      productName,
      manufacturerName,
      retailerName,
      retailerEmail,
      retailerSort: (retailerName || retailerEmail).toLowerCase(),
      search_blob: searchBlob,
      status: String(data.status || ''),
      requestedQuantity,
      requestedUnit: String(data.requestedUnit || '—'),
      createdAt: tsMillis(data.createdAt),
    };
  },
});

export const onProductDemandWriteTypesense = productDemandSync.onWrite;
export const searchProductDemandsTypesense = productDemandSync.search;
export const adminReindexProductDemandsTypesense = productDemandSync.reindex;
