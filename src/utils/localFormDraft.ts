const PREFIX = 'sp-form-draft:';

export type LocalFormDraft<T> = {
  updatedAt: number;
  data: T;
};

function storageKey(key: string): string {
  return `${PREFIX}${key}`;
}

export function readLocalFormDraft<T>(key: string): LocalFormDraft<T> | null {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalFormDraft<T>;
    if (!parsed || typeof parsed !== 'object' || parsed.data == null) return null;
    return parsed;
  } catch {
    try {
      localStorage.removeItem(storageKey(key));
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function writeLocalFormDraft<T>(key: string, data: T): void {
  try {
    const payload: LocalFormDraft<T> = { updatedAt: Date.now(), data };
    localStorage.setItem(storageKey(key), JSON.stringify(payload));
  } catch (err) {
    console.warn('Failed to save local draft:', err);
  }
}

export function clearLocalFormDraft(key: string): void {
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    /* ignore */
  }
}

export function isOfflineOrNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = error instanceof Error ? error.message : String(error || '');
  return /failed to fetch|network|unavailable|offline|client is offline/i.test(msg);
}
