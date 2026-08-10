import { formatOrderNumberForDisplay } from './orderDisplay';
import { hasBatchAssignment } from './orderTotals';

export type WhatsAppOrderLine = {
  name?: string;
  quantity?: number;
  freeQuantity?: number;
  originalQuantity?: number;
  medicineId?: string;
  lineType?: string;
  batchNumber?: string;
  batchAllocations?: unknown[];
  verified?: boolean;
};

function lineQty(line: WhatsAppOrderLine): number {
  const original = Number(line.originalQuantity);
  if (Number.isFinite(original) && original > 0) return Math.floor(original);
  const paid = Number(line.quantity) || 0;
  const free = Number(line.freeQuantity) || 0;
  return Math.max(0, Math.floor(paid + free));
}

function lineName(line: WhatsAppOrderLine): string {
  return String(line.name || '').trim() || 'Unknown item';
}

/** Lines not ready for fulfill (no batch) — typical shortfall list for retailer WhatsApp. */
export function isShortfallOrderLine(line: WhatsAppOrderLine): boolean {
  if (line.lineType === 'product_demand') return true;
  return !hasBatchAssignment(line as Parameters<typeof hasBatchAssignment>[0]);
}

export function formatOrderItemsWhatsAppList(
  orderId: string,
  lines: WhatsAppOrderLine[],
  options?: { shortfallsOnly?: boolean; storeName?: string }
): string {
  const shortfallsOnly = options?.shortfallsOnly === true;
  const rows = (lines || [])
    .filter((l) => lineName(l) !== 'Unknown item' || lineQty(l) > 0)
    .filter((l) => (shortfallsOnly ? isShortfallOrderLine(l) : true));

  const headerBits = [
    `Order #${formatOrderNumberForDisplay(orderId)}`,
    options?.storeName?.trim() ? options.storeName.trim() : null,
  ].filter(Boolean);

  const title = shortfallsOnly
    ? `Short / unavailable items — ${headerBits.join(' · ')}`
    : `Order items — ${headerBits.join(' · ')}`;

  if (rows.length === 0) {
    return shortfallsOnly
      ? `${title}\n\n(No short items right now.)`
      : `${title}\n\n(No items.)`;
  }

  const body = rows
    .map((l, i) => {
      const qty = lineQty(l);
      return `${i + 1}. ${lineName(l)}${qty > 0 ? ` — Qty ${qty}` : ''}`;
    })
    .join('\n');

  return `${title}\n\n${body}`;
}

/** Digits-only international number for wa.me (defaults India +91 for 10-digit mobiles). */
export function normalizeWhatsAppPhone(raw: string | undefined | null): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export function buildWhatsAppUrl(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
