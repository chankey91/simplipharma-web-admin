import { useEffect, useState } from 'react';

export type ConnectionStatus = 'online' | 'weak' | 'offline';

const PROBE_URLS = [
  'https://firestore.googleapis.com/',
  'https://www.gstatic.com/generate_204',
];

/** Abort a probe that has not finished. */
const PROBE_TIMEOUT_MS = 5000;
/** A finished probe slower than this is treated as a weak sample. */
const WEAK_LATENCY_MS = 2500;
/** Slow or failed samples required before pausing the panel. */
const SAMPLES_BEFORE_BLOCK = 2;
const CHECK_ONLINE_MS = 12000;
const CHECK_SUSPECT_MS = 4000;

type ProbeResult = 'ok' | 'slow' | 'down' | 'cancelled';

interface NetworkInformation extends EventTarget {
  effectiveType?: string;
  downlink?: number;
}

function networkConnection(): NetworkInformation | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & { connection?: NetworkInformation };
  return nav.connection ?? null;
}

function browserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Browser-reported 2G / very low throughput. Fast enough to pause immediately. */
function browserHardWeak(): boolean {
  const connection = networkConnection();
  if (!connection) return false;
  if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') return true;
  return (
    typeof connection.downlink === 'number' &&
    connection.downlink > 0 &&
    connection.downlink < 0.3
  );
}

async function probeOnce(parent: AbortSignal): Promise<ProbeResult> {
  if (parent.aborted || browserOffline()) return parent.aborted ? 'cancelled' : 'down';

  const started = performance.now();
  const timeout = new AbortController();
  const onParentAbort = () => timeout.abort();
  parent.addEventListener('abort', onParentAbort);
  const timer = window.setTimeout(() => timeout.abort(), PROBE_TIMEOUT_MS);

  try {
    await new Promise<void>((resolve, reject) => {
      let pending = PROBE_URLS.length;
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        if (ok) {
          settled = true;
          resolve();
          return;
        }
        pending -= 1;
        if (pending === 0) {
          settled = true;
          reject(new Error('unreachable'));
        }
      };
      timeout.signal.addEventListener('abort', () => {
        if (settled) return;
        settled = true;
        reject(new Error('timeout'));
      });
      for (const url of PROBE_URLS) {
        fetch(url, {
          method: 'GET',
          mode: 'no-cors',
          cache: 'no-store',
          signal: timeout.signal,
        }).then(
          () => finish(true),
          () => finish(false)
        );
      }
    });

    const elapsed = performance.now() - started;
    if (elapsed >= WEAK_LATENCY_MS) return 'slow';
    return 'ok';
  } catch {
    if (parent.aborted) return 'cancelled';
    return 'down';
  } finally {
    window.clearTimeout(timer);
    parent.removeEventListener('abort', onParentAbort);
    timeout.abort();
  }
}

/**
 * Online, weak, or offline for the whole panel.
 * Offline is immediate. Weak needs two slow or failed checks so one blip does not pause the screen.
 * A single fast check clears the pause so the same screen can continue.
 */
export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    browserOffline() ? 'offline' : 'online'
  );

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let running = false;
    let queued = false;
    let slowStreak = 0;
    let failStreak = 0;
    let current: ConnectionStatus = browserOffline() ? 'offline' : 'online';
    const lifetime = new AbortController();

    const publish = (next: ConnectionStatus) => {
      if (cancelled || next === current) return;
      current = next;
      setStatus(next);
    };

    const apply = (result: ProbeResult) => {
      if (cancelled || result === 'cancelled') return;

      if (browserOffline()) {
        slowStreak = 0;
        failStreak = 0;
        publish('offline');
        return;
      }

      if (browserHardWeak()) {
        slowStreak = 0;
        failStreak = 0;
        publish('weak');
        return;
      }

      if (result === 'down') {
        failStreak += 1;
        slowStreak = 0;
        if (failStreak >= SAMPLES_BEFORE_BLOCK) publish('weak');
        return;
      }

      if (result === 'slow') {
        slowStreak += 1;
        failStreak = 0;
        if (slowStreak >= SAMPLES_BEFORE_BLOCK) publish('weak');
        return;
      }

      slowStreak = 0;
      failStreak = 0;
      publish('online');
    };

    const delayForNextCheck = () => {
      if (current !== 'online' || failStreak > 0 || slowStreak > 0) return CHECK_SUSPECT_MS;
      return CHECK_ONLINE_MS;
    };

    const run = async () => {
      if (cancelled) return;
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        if (browserOffline()) {
          apply('down');
          return;
        }
        if (document.hidden) return;
        if (browserHardWeak()) publish('weak');
        apply(await probeOnce(lifetime.signal));
      } finally {
        running = false;
        if (cancelled) return;
        if (queued) {
          queued = false;
          void run();
          return;
        }
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          void run();
        }, delayForNextCheck());
      }
    };

    const kick = () => {
      window.clearTimeout(timer);
      void run();
    };

    const onOffline = () => {
      slowStreak = 0;
      failStreak = 0;
      publish('offline');
      kick();
    };

    const connection = networkConnection();
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', kick);
    connection?.addEventListener('change', kick);
    kick();

    return () => {
      cancelled = true;
      lifetime.abort();
      window.clearTimeout(timer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', kick);
      connection?.removeEventListener('change', kick);
    };
  }, []);

  return status;
}

/** True only when the browser reports a network interface. Does not measure quality. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return online;
}
