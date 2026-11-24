import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material';
import { Build, LockOpen, Mail } from '@mui/icons-material';
import { format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppDialog } from '../context/AppDialogProvider';
import {
  callableErrorMessage,
  disableRetailerMaintenance,
  enableRetailerMaintenance,
  getRetailerMaintenance,
  requestRetailerMaintenanceOtp,
} from '../services/retailerMaintenance';

export const RetailerMaintenanceCard: React.FC = () => {
  const queryClient = useQueryClient();
  const { alert, confirm } = useAppDialog();
  const [message, setMessage] = useState('');
  const [otp, setOtp] = useState('');
  const [sentTo, setSentTo] = useState('');
  const seededMessage = useRef(false);

  const statusQuery = useQuery({
    queryKey: ['retailerMaintenance'],
    queryFn: getRetailerMaintenance,
  });

  useEffect(() => {
    if (!statusQuery.data || seededMessage.current) return;
    seededMessage.current = true;
    setMessage(statusQuery.data.message);
  }, [statusQuery.data]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['retailerMaintenance'] });
  };

  const requestMutation = useMutation({
    mutationFn: requestRetailerMaintenanceOtp,
    onSuccess: async (result) => {
      setSentTo(result.sentTo);
      setOtp('');
      await alert(`Code sent to ${result.sentTo}. It expires in 10 minutes.`, { severity: 'success' });
    },
    onError: (err: unknown) => {
      void alert(callableErrorMessage(err, 'Could not send the code'));
    },
  });

  const enableMutation = useMutation({
    mutationFn: () => enableRetailerMaintenance(otp, message),
    onSuccess: async () => {
      setOtp('');
      setSentTo('');
      await refresh();
      await alert('Retailer app is now in maintenance.', { severity: 'success' });
    },
    onError: (err: unknown) => {
      void alert(callableErrorMessage(err, 'Could not enable maintenance'));
    },
  });

  const disableMutation = useMutation({
    mutationFn: disableRetailerMaintenance,
    onSuccess: async () => {
      setOtp('');
      setSentTo('');
      await refresh();
      await alert('Retailer app is live again.', { severity: 'success' });
    },
    onError: (err: unknown) => {
      void alert(callableErrorMessage(err, 'Could not turn maintenance off'));
    },
  });

  const enabled = statusQuery.data?.enabled === true;
  const updatedAt = statusQuery.data?.updatedAt;
  const busy = requestMutation.isPending || enableMutation.isPending || disableMutation.isPending;

  const handleDisable = async () => {
    const ok = await confirm(
      'Turn maintenance off? Retailers will see the app again immediately.'
    );
    if (!ok) return;
    disableMutation.mutate();
  };

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={1} flexWrap="wrap">
          <Build color={enabled ? 'warning' : 'primary'} />
          <Typography variant="h6">Retailer maintenance</Typography>
          {statusQuery.isLoading ? (
            <CircularProgress size={18} />
          ) : (
            <Chip
              size="small"
              color={enabled ? 'warning' : 'success'}
              label={enabled ? 'Maintenance on' : 'App live'}
            />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Retailer accounts see only a maintenance screen — no home, orders, or account pages.
          Sales officer and area manager workspaces stay open. Turning this on emails a code to
          your admin address. It is enabled only after that code matches.
        </Typography>

        {statusQuery.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Could not load maintenance status. Deploy the latest Firestore rules if this is a
            permission error.
          </Alert>
        )}

        {enabled && updatedAt && (
          <Typography variant="body2" sx={{ mb: 2 }}>
            On since {format(updatedAt, 'dd MMM yyyy HH:mm')}
            {statusQuery.data?.message ? ` · ${statusQuery.data.message}` : ''}
          </Typography>
        )}

        <TextField
          fullWidth
          label="Message on the retailer screen (optional)"
          placeholder="We are updating the catalog and will be back by 6 PM."
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 400))}
          multiline
          rows={2}
          disabled={enabled || busy}
          sx={{ mb: 2 }}
        />

        {enabled ? (
          <Button
            variant="contained"
            color="success"
            startIcon={disableMutation.isPending ? <CircularProgress size={18} /> : <LockOpen />}
            disabled={busy}
            onClick={() => void handleDisable()}
          >
            {disableMutation.isPending ? 'Turning off…' : 'Turn maintenance off'}
          </Button>
        ) : (
          <Box display="flex" flexDirection="column" gap={2} alignItems="flex-start">
            <Button
              variant="outlined"
              startIcon={requestMutation.isPending ? <CircularProgress size={18} /> : <Mail />}
              disabled={busy}
              onClick={() => requestMutation.mutate()}
            >
              {requestMutation.isPending ? 'Sending code…' : 'Send code to my email'}
            </Button>
            {sentTo && (
              <Alert severity="info" sx={{ width: '100%' }}>
                Code sent to {sentTo}. Enter it below to turn maintenance on. It expires in 10
                minutes.
              </Alert>
            )}
            <TextField
              label="Email code"
              placeholder="6-digit code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputProps={{ inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 6 }}
              sx={{ maxWidth: 220 }}
              disabled={busy}
            />
            <Button
              variant="contained"
              color="warning"
              disabled={otp.length !== 6 || busy}
              onClick={() => enableMutation.mutate()}
            >
              {enableMutation.isPending ? 'Checking code…' : 'Turn maintenance on'}
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};
