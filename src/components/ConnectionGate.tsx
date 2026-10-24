import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, CircularProgress, Paper, Snackbar, Typography } from '@mui/material';
import { WifiOff } from '@mui/icons-material';
import { onlineManager } from '@tanstack/react-query';
import { useConnectionStatus } from '../hooks/useOnlineStatus';

const GATE_ID = 'connection-gate';

/**
 * Pauses the whole panel when the connection is weak or gone.
 * The screen underneath stays mounted, so the user continues in place when the connection returns.
 */
export const ConnectionGate: React.FC = () => {
  const status = useConnectionStatus();
  const blocked = status !== 'online';
  const wasBlocked = useRef(false);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [restoredOpen, setRestoredOpen] = useState(false);

  useEffect(() => {
    onlineManager.setOnline(!blocked);
  }, [blocked]);

  useEffect(() => {
    if (blocked) {
      wasBlocked.current = true;
      setRestoredOpen(false);
      return;
    }
    if (wasBlocked.current) {
      wasBlocked.current = false;
      setRestoredOpen(true);
    }
  }, [blocked]);

  useEffect(() => {
    if (!blocked) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const title = document.getElementById(`${GATE_ID}-title`);
    title?.focus();
    return () => {
      const previous = restoreFocus.current;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [blocked]);

  useEffect(() => {
    if (!blocked) return;

    const touched: Element[] = [];
    const markInert = () => {
      const gate = document.getElementById(GATE_ID);
      for (const child of Array.from(document.body.children)) {
        if (gate && (child === gate || child.contains(gate))) continue;
        if (child.hasAttribute('data-connection-inert')) continue;
        if (child.hasAttribute('inert')) continue;
        child.setAttribute('inert', '');
        child.setAttribute('data-connection-inert', '');
        touched.push(child);
      }
    };

    const blurExceptGate = () => {
      const gate = document.getElementById(GATE_ID);
      for (const child of Array.from(document.body.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (gate && (child === gate || child.contains(gate))) continue;
        if (child.dataset.connectionBlur === '1') continue;
        const tag = child.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK') continue;
        child.dataset.connectionBlur = '1';
        child.dataset.connectionFilter = child.style.filter;
        child.style.filter = 'blur(6px)';
        child.style.pointerEvents = 'none';
      }
    };

    markInert();
    blurExceptGate();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const observer = new MutationObserver(() => {
      markInert();
      blurExceptGate();
    });
    observer.observe(document.body, { childList: true });

    const stopKeys = (event: Event) => {
      const gate = document.getElementById(GATE_ID);
      if (event.target instanceof Node && gate?.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', stopKeys, true);
    window.addEventListener('keyup', stopKeys, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', stopKeys, true);
      window.removeEventListener('keyup', stopKeys, true);
      for (const el of touched) {
        el.removeAttribute('inert');
        el.removeAttribute('data-connection-inert');
      }
      for (const child of Array.from(document.body.children)) {
        if (!(child instanceof HTMLElement) || child.dataset.connectionBlur !== '1') continue;
        child.style.filter = child.dataset.connectionFilter ?? '';
        child.style.pointerEvents = '';
        delete child.dataset.connectionBlur;
        delete child.dataset.connectionFilter;
      }
      document.body.style.overflow = previousOverflow;
    };
  }, [blocked]);

  const detail =
    status === 'offline'
      ? 'The device is offline. This screen is paused until the internet is back.'
      : 'The connection is too weak to continue. This screen is paused until it is stable.';

  return (
    <>
      {blocked
        ? createPortal(
            <Box
              id={GATE_ID}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={`${GATE_ID}-title`}
              aria-describedby={`${GATE_ID}-detail`}
              sx={{
                position: 'fixed',
                inset: 0,
                zIndex: 20000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: 2,
                backgroundColor: 'rgba(13, 27, 77, 0.35)',
              }}
            >
              <Paper
                elevation={8}
                sx={{
                  maxWidth: 440,
                  width: '100%',
                  px: 4,
                  py: 4,
                  textAlign: 'center',
                  borderRadius: 2,
                }}
              >
                <Box
                  sx={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    bgcolor: '#FFF4E5',
                    color: '#ED6C02',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mx: 'auto',
                    mb: 2,
                  }}
                >
                  <WifiOff sx={{ fontSize: 36 }} />
                </Box>
                <Typography id={`${GATE_ID}-title`} variant="h6" tabIndex={-1} sx={{ mb: 1, outline: 'none' }}>
                  Internet connection is weak
                </Typography>
                <Typography id={`${GATE_ID}-detail`} variant="body1" color="text.secondary" sx={{ mb: 1.5 }}>
                  {detail}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                  Your place on this screen is kept. You can continue from here once the internet is back.
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
                  <CircularProgress size={22} />
                  <Typography variant="body2">Checking connection…</Typography>
                </Box>
              </Paper>
            </Box>,
            document.body
          )
        : null}
      <Snackbar
        open={restoredOpen && !blocked}
        autoHideDuration={4000}
        onClose={() => setRestoredOpen(false)}
        message="Internet is back. You can continue from here."
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
};
