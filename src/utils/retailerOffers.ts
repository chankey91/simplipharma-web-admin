export type RetailerOfferType = 'buy_get_free' | 'combo' | 'percent_discount';

export type RetailerOffer = {
  id: string;
  title: string;
  subtitle?: string;
  type: RetailerOfferType;
  isActive: boolean;
  sortOrder: number;
  medicineIds: string[];
  medicineNames: string[];
  paidQty?: number;
  freeQty?: number;
  discountPct?: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export type AppliedOfferRef = {
  id: string;
  title: string;
  type: RetailerOfferType;
};

export type CartLineInput = {
  medicineId: string;
  quantity: number;
};

export type LineOfferPatch = {
  medicineId: string;
  offerId: string;
  offerTitle: string;
  offerType: RetailerOfferType;
  orderSchemeApplied?: boolean;
  orderSchemeManuallySet?: boolean;
  orderSchemePaidQty?: number;
  orderSchemeFreeQty?: number;
  discountPercentage?: number;
  discountManuallySet?: boolean;
};

export const OFFER_TYPE_LABEL: Record<RetailerOfferType, string> = {
  buy_get_free: 'Buy get free',
  combo: 'Combo',
  percent_discount: '% discount',
};

function toTime(value: Date | null | undefined): number | null {
  if (!value) return null;
  const t = value.getTime();
  return Number.isFinite(t) ? t : null;
}

export function isOfferLive(offer: Pick<RetailerOffer, 'isActive' | 'startsAt' | 'endsAt'>, now = new Date()): boolean {
  if (!offer.isActive) return false;
  const t = now.getTime();
  const start = toTime(offer.startsAt);
  const end = toTime(offer.endsAt);
  if (start != null && t < start) return false;
  if (end != null && t > end) return false;
  return true;
}

export function formatOfferBadge(offer: Pick<RetailerOffer, 'type' | 'title' | 'paidQty' | 'freeQty' | 'discountPct'>): string {
  if (offer.type === 'buy_get_free' && (offer.paidQty || 0) > 0 && (offer.freeQty || 0) > 0) {
    return `${Math.floor(offer.paidQty!)}+${Math.floor(offer.freeQty!)}`;
  }
  if (offer.type === 'percent_discount' && (offer.discountPct || 0) > 0) {
    return `${Number(offer.discountPct)}% off`;
  }
  if (offer.type === 'combo' && (offer.discountPct || 0) > 0) {
    return `Combo ${Number(offer.discountPct)}% off`;
  }
  if (offer.type === 'combo') return 'Combo';
  return offer.title;
}

function offerValue(offer: RetailerOffer): number {
  if (offer.type === 'buy_get_free') {
    const paid = Number(offer.paidQty) || 0;
    const free = Number(offer.freeQty) || 0;
    if (paid <= 0 || free <= 0) return 0;
    return free / (paid + free);
  }
  return Math.max(0, Number(offer.discountPct) || 0) / 100;
}

function comboQualified(offer: RetailerOffer, qtyById: Map<string, number>): boolean {
  if (offer.type !== 'combo' || offer.medicineIds.length < 2) return false;
  return offer.medicineIds.every((id) => (qtyById.get(id) || 0) >= 1);
}

export function matchOffersToCart(
  lines: CartLineInput[],
  offers: RetailerOffer[],
  now = new Date()
): { patches: LineOfferPatch[]; appliedOffers: AppliedOfferRef[] } {
  const qtyById = new Map<string, number>();
  for (const line of lines) {
    const id = line.medicineId?.trim();
    if (!id) continue;
    qtyById.set(id, (qtyById.get(id) || 0) + Math.max(0, line.quantity));
  }

  const live = offers.filter((o) => isOfferLive(o, now)).sort((a, b) => a.sortOrder - b.sortOrder);
  const assigned = new Map<string, LineOfferPatch>();
  const usedOfferIds = new Set<string>();

  for (const offer of live.filter((o) => comboQualified(o, qtyById))) {
    const pct = Number(offer.discountPct) || 0;
    if (pct <= 0) continue;
    for (const medicineId of offer.medicineIds) {
      if (assigned.has(medicineId)) continue;
      assigned.set(medicineId, {
        medicineId,
        offerId: offer.id,
        offerTitle: offer.title,
        offerType: 'combo',
        discountPercentage: pct,
        discountManuallySet: true,
      });
    }
    usedOfferIds.add(offer.id);
  }

  for (const medicineId of qtyById.keys()) {
    if (assigned.has(medicineId)) continue;
    let best: RetailerOffer | null = null;
    let bestValue = -1;
    for (const offer of live) {
      if (offer.type === 'combo') continue;
      if (!offer.medicineIds.includes(medicineId)) continue;
      if (offer.type === 'buy_get_free') {
        const paid = Number(offer.paidQty) || 0;
        const free = Number(offer.freeQty) || 0;
        if (paid <= 0 || free <= 0) continue;
      } else if ((Number(offer.discountPct) || 0) <= 0) {
        continue;
      }
      const value = offerValue(offer);
      if (value > bestValue) {
        best = offer;
        bestValue = value;
      }
    }
    if (!best) continue;
    usedOfferIds.add(best.id);
    if (best.type === 'buy_get_free') {
      assigned.set(medicineId, {
        medicineId,
        offerId: best.id,
        offerTitle: best.title,
        offerType: 'buy_get_free',
        orderSchemeApplied: true,
        orderSchemeManuallySet: true,
        orderSchemePaidQty: Math.floor(Number(best.paidQty)),
        orderSchemeFreeQty: Math.floor(Number(best.freeQty)),
      });
    } else {
      assigned.set(medicineId, {
        medicineId,
        offerId: best.id,
        offerTitle: best.title,
        offerType: 'percent_discount',
        discountPercentage: Number(best.discountPct),
        discountManuallySet: true,
      });
    }
  }

  const appliedOffers: AppliedOfferRef[] = live
    .filter((o) => usedOfferIds.has(o.id))
    .map((o) => ({ id: o.id, title: o.title, type: o.type }));

  return { patches: [...assigned.values()], appliedOffers };
}
