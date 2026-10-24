import { useEffect, useState } from 'react';

export type ConnectionStatus = 'online' | 'weak' | 'offline';

/** Public connectivity check. Not a Firestore read. */
const PROBE_URL = 'https://www.gstatic.com/generate_204';

/** Round-trip at or above this is a weak signal sample. */
const WEAK_RTT_MS = 1500;
/** Download speed below this (and above 0) is a weak signal sample. */
const WEAK_DOWNLINK_MBPS = 0.4;
/** A check slower than this confirms a weak signal when the browser has no signal API. */
const WEAK_PROBE_MS = 2500;
/** A check faster than this means a stale "weak" reading can be cleared. */
const HEALTHY_PROBE_MS = 1500;
const PROBE_TIMEOUT_MS = 5000;
/** Weak samples required before the popup opens. */
const SAMPLES_BEFORE_POPUP = 2;
/** Fast samples required before a stale weak reading is ignored. */
const FAST_SAMPLES_TO_CLEAR = 2;
const CHECK_HEALTHY_MS = 12000;
const CHECK_WEAK_MS = 2000;

type ProbeResult = { kind: 'ok'; elapsed: number } | { kind: 'down' } | { kind: 'cancelled' };
type SignalReading = 'weak' | 'ok' | 'unknown';

interface NetworkInformation extends EventTarget {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
}

function networkConnection(): NetworkInformation | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & { connection?: NetworkInformation };
  return nav.connection ?? null;
}

/** Browser signal reading. `unknown` when this browser does not expose it. */
function readSignal(): SignalReading {
  const connection = networkConnection();
  if (!connection) return 'unknown';
  if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') return 'weak';
  if (typeof connection.rtt === 'number' && connection.rtt >= WEAK_RTT_MS) return 'weak';
  if (
    typeof connection.downlink === 'number' &&
    connection.downlink > 0 &&
    connection.downlink < WEAK_DOWNLINK_MBPS
  ) {
    return 'weak';
  }
  return 'ok';
}

async function probeOnce(parent: AbortSignal): Promise<ProbeResult> {
  if (parent.aborted) return { kind: 'cancelled' };

  const timeout = new AbortController();
  const onParentAbort = () => timeout.abort();
  parent.addEventListener('abort', onParentAbort);
  const timer = window.setTimeout(() => timeout.abort(), PROBE_TIMEOUT_MS);
  const started = performance.now();

  try {
    await fetch(`${PROBE_URL}?t=${Date.now()}`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: timeout.signal,
    });
    return { kind: 'ok', elapsed: performance.now() - started };
  } catch {
    if (parent.aborted) return { kind: 'cancelled' };
    return { kind: 'down' };
  } finally {
    window.clearTimeout(timer);
    parent.removeEventListener('abort', onParentAbort);
    timeout.abort();
  }
}

/**
 * Popup only when the signal itself is too weak.
 * A normal link, and a failed request on a normal link, leave the panel usable.
 * A fast check clears a stale weak reading so the popup does not stay up.
 */
export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('online');

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let running = false;
    let queued = false;
    let weakStreak = 0;
    let fastStreak = 0;
    let current: ConnectionStatus = 'online';
    let attempt = new AbortController();

    const publish = (next: ConnectionStatus) => {
      if (cancelled || next === current) return;
      current = next;
      setStatus(next);
    };

    const apply = (result: ProbeResult) => {
      if (cancelled || result.kind === 'cancelled') return;

      const signal = readSignal();
      const fast = result.kind === 'ok' && result.elapsed < HEALTHY_PROBE_MS;
      const slow =
        result.kind === 'down' || (result.kind === 'ok' && result.elapsed >= WEAK_PROBE_MS);

      if (signal === 'ok' || fast) {
        weakStreak = 0;
        if (signal === 'ok') {
          fastStreak = 0;
          publish('online');
          return;
        }
        fastStreak += 1;
        if (fastStreak >= FAST_SAMPLES_TO_CLEAR) publish('online');
        return;
      }

      fastStreak = 0;
      if (signal === 'weak' || slow) {
        weakStreak += 1;
        if (weakStreak >= SAMPLES_BEFORE_POPUP) publish('weak');
      }
    };

    const delayForNextCheck = () => {
      const signalHealthy = readSignal() === 'ok' || fastStreak >= FAST_SAMPLES_TO_CLEAR;
      return current === 'online' && signalHealthy ? CHECK_HEALTHY_MS : CHECK_WEAK_MS;
    };

    const run = async () => {
      if (cancelled) return;
      if (running) {
        queued = true;
        return;
      }
      running = true;
      const signal = attempt.signal;
      try {
        if (document.hidden) return;
        if (readSignal() === 'ok') {
          weakStreak = 0;
          fastStreak = 0;
          publish('online');
          return;
        }
        apply(await probeOnce(signal));
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

    const connection = networkConnection();
    window.addEventListener('online', kick);
    window.addEventListener('offline', kick);
    document.addEventListener('visibilitychange', kick);
    connection?.addEventListener('change', kick);
    kick();

    return () => {
      cancelled = true;
      attempt.abort();
      window.clearTimeout(timer);
      window.removeEventListener('online', kick);
      window.removeEventListener('offline', kick);
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
