import React from 'react';
import { Alert } from '@mui/material';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

/** Global notice while the browser reports no network. Form drafts stay on this device. */
export const OfflineBanner: React.FC = () => {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      You are offline. Purchase and order work stays on this device — do not close this tab.
      When internet returns, save or fulfill again so the server is updated.
    </Alert>
  );
};
