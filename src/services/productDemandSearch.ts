import { ProductDemandStatus } from '../types';
import { makeTypesenseSearch, makeReindexCallable, rawStr, rawNum } from './typesenseSearch';

/** Lightweight row from the Typesense index (full doc fetched by id when needed). */
export interface ProductDemandRow {
  id: string;
  productName: string;
  manufacturerName: string;
  retailerName: string;
  retailerEmail: string;
  requestedQuantity: number;
  requestedUnit: string;
  status: ProductDemandStatus;
  /** Created at as epoch milliseconds. */
  createdAt: number;
}

export const searchProductDemandsTypesense = makeTypesenseSearch<ProductDemandRow>(
  'searchProductDemandsTypesense',
  (raw) => ({
    id: rawStr(raw.id || raw.docId),
    productName: rawStr(raw.productName),
    manufacturerName: rawStr(raw.manufacturerName),
    retailerName: rawStr(raw.retailerName),
    retailerEmail: rawStr(raw.retailerEmail),
    requestedQuantity: rawNum(raw.requestedQuantity),
    requestedUnit: rawStr(raw.requestedUnit),
    status: rawStr(raw.status) as ProductDemandStatus,
    createdAt: rawNum(raw.createdAt),
  })
);

export const reindexProductDemandsTypesense = makeReindexCallable(
  'adminReindexProductDemandsTypesense'
);
