import { doc, getDoc, setDoc, serverTimestamp, db, auth } from './firebase';
import { stripUndefinedDeep } from '../utils/firestorePayload';
import {
  DEFAULT_ORDER_TRADE_DISCOUNT_BANDS,
  normalizeOrderTradeDiscountBands,
  setOrderTradeDiscountBands,
  type OrderTradeDiscountBand,
} from '../utils/orderFulfillmentDiscount';

export const ORDER_TRADE_DISCOUNT_DOC = 'app_settings/orderTradeDiscount';

export type OrderTradeDiscountSettings = {
  bands: OrderTradeDiscountBand[];
};

export const DEFAULT_ORDER_TRADE_DISCOUNT_SETTINGS: OrderTradeDiscountSettings = {
  bands: [...DEFAULT_ORDER_TRADE_DISCOUNT_BANDS],
};

function parseSettings(data: Record<string, unknown> | undefined): OrderTradeDiscountSettings {
  const raw = Array.isArray(data?.bands) ? (data!.bands as unknown[]) : [];
  const bands = normalizeOrderTradeDiscountBands(
    raw.map((row) => {
      const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
      return { minVendorPct: Number(r.minVendorPct), givePct: Number(r.givePct) };
    })
  );
  return {
    bands: bands.length ? bands : [...DEFAULT_ORDER_TRADE_DISCOUNT_BANDS],
  };
}

export async function getOrderTradeDiscountSettings(): Promise<OrderTradeDiscountSettings> {
  const snap = await getDoc(doc(db, 'app_settings', 'orderTradeDiscount'));
  const settings = snap.exists()
    ? parseSettings(snap.data() as Record<string, unknown>)
    : { ...DEFAULT_ORDER_TRADE_DISCOUNT_SETTINGS, bands: [...DEFAULT_ORDER_TRADE_DISCOUNT_BANDS] };
  setOrderTradeDiscountBands(settings.bands);
  return settings;
}

export async function saveOrderTradeDiscountSettings(
  settings: OrderTradeDiscountSettings
): Promise<OrderTradeDiscountSettings> {
  const bands = normalizeOrderTradeDiscountBands(settings.bands);
  if (bands.length === 0) {
    throw new Error('Add at least one discount band');
  }
  await setDoc(
    doc(db, 'app_settings', 'orderTradeDiscount'),
    stripUndefinedDeep({
      bands,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || undefined,
    }),
    { merge: true }
  );
  setOrderTradeDiscountBands(bands);
  return { bands };
}
