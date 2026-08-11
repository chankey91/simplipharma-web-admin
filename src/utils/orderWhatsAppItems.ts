import { formatOrderNumberForDisplay } from './orderDisplay';
import { hasBatchAssignment } from './orderTotals';
import { orderedUnitsFromAllocation } from './schemeFulfillment';

export type WhatsAppOrderLine = {
  name?: string;
  quantity?: number;
  freeQuantity?: number;
  originalQuantity?: number;
  medicineId?: string;
  lineType?: string;
  batchNumber?: string;
  batchAllocations?: Array<{
    quantity?: number;
    allocationFreeQty?: number;
    freeQuantity?: number;
  }>;
  verified?: boolean;
};

function lineName(line: WhatsAppOrderLine): string {
  return String(line.name || '').trim() || 'Unknown item';
}

/** Ordered / requested physical qty for the line. */
export function getLineRequiredQty(line: WhatsAppOrderLine): number {
  const original = Number(line.originalQuantity);
  if (Number.isFinite(original) && original > 0) return Math.floor(original);
  const paid = Number(line.quantity) || 0;
  const free = Number(line.freeQuantity) || 0;
  return Math.max(0, Math.floor(paid + free));
}

/** Physical qty currently batch-assigned (0 if none). */
export function getLineAllocatedQty(line: WhatsAppOrderLine): number {
  if (line.lineType === 'product_demand') return 0;
  const allocs = line.batchAllocations;
  if (Array.isArray(allocs) && allocs.length > 0) {
    return allocs.reduce((sum, a) => sum + orderedUnitsFromAllocation(a), 0);
  }
  if (line.batchNumber) {
    const paid = Number(line.quantity) || 0;
    const free = Number(line.freeQuantity) || 0;
    return Math.max(0, Math.floor(paid + free));
  }
  return 0;
}

/**
 * Not fulfilled (no batch) or partially fulfilled (allocated &lt; required).
 * Product-demand lines always count as short.
 */
export function isShortfallOrderLine(line: WhatsAppOrderLine): boolean {
  if (line.lineType === 'product_demand') return true;
  if (!hasBatchAssignment(line as Parameters<typeof hasBatchAssignment>[0])) return true;
  const required = getLineRequiredQty(line);
  const allocated = getLineAllocatedQty(line);
  return allocated + 0.001 < required;
}

export function formatOrderItemsWhatsAppList(
  orderId: string,
  lines: WhatsAppOrderLine[],
  options?: { storeName?: string }
): string {
  const rows = (lines || []).filter((l) => isShortfallOrderLine(l));

  const headerBits = [
    `Order #${formatOrderNumberForDisplay(orderId)}`,
    options?.storeName?.trim() ? options.storeName.trim() : null,
  ].filter(Boolean);

  const title = `Short / pending items — ${headerBits.join(' · ')}`;

  if (rows.length === 0) {
    return `${title}\n\n(No short or pending items right now.)`;
  }

  const body = rows
    .map((l, i) => {
      const required = getLineRequiredQty(l);
      const allocated = getLineAllocatedQty(l);
      const shortQty = Math.max(0, required - allocated);
      if (allocated > 0 && shortQty > 0) {
        return `${i + 1}. ${lineName(l)} — short Qty ${shortQty} (ordered ${required}, allocated ${allocated})`;
      }
      return `${i + 1}. ${lineName(l)}${shortQty > 0 ? ` — Qty ${shortQty}` : ''}`;
    })
    .join('\n');

  return `${title}\n\n${body}`;
}

/** Digits-only international number (defaults India +91 for 10-digit mobiles). */
export function normalizeWhatsAppPhone(raw: string | undefined | null): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** Always opens WhatsApp Web (not the desktop/mobile app deep link). */
export function buildWhatsAppUrl(phone: string, text: string): string {
  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
}
