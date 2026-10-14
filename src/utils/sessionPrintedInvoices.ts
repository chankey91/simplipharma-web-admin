import { useMemo, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'simplipharma.printedInvoices.session';
const CHANGE_EVENT = 'sp-printed-invoices-changed';

type PrintedMap = Record<string, string>;

function readMap(): PrintedMap {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PrintedMap;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeMap(map: PrintedMap): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

export function markOrderInvoicePrinted(orderId: string): void {
  const id = String(orderId || '').trim();
  if (!id) return;
  const map = readMap();
  map[id] = new Date().toISOString();
  writeMap(map);
}

export function getOrderInvoicePrintedAt(orderId: string): Date | null {
  const iso = readMap()[String(orderId || '').trim()];
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function subscribePrintedInvoices(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(CHANGE_EVENT, onStoreChange);
}

export function getPrintedInvoicesSnapshot(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || '{}';
  } catch {
    return '{}';
  }
}

const getServerSnapshot = () => '{}';

export function useSessionPrintedAt(orderId: string | undefined): Date | null {
  const raw = useSyncExternalStore(
    subscribePrintedInvoices,
    getPrintedInvoicesSnapshot,
    getServerSnapshot
  );
  return useMemo(() => {
    if (!orderId) return null;
    try {
      const iso = (JSON.parse(raw) as PrintedMap)[orderId];
      if (!iso) return null;
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }, [raw, orderId]);
}

export function useSessionPrintedIds(): Set<string> {
  const raw = useSyncExternalStore(
    subscribePrintedInvoices,
    getPrintedInvoicesSnapshot,
    getServerSnapshot
  );
  return useMemo(() => {
    try {
      return new Set(Object.keys(JSON.parse(raw) as PrintedMap));
    } catch {
      return new Set<string>();
    }
  }, [raw]);
}
