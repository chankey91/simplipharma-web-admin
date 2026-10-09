import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  IconButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Add, Delete } from '@mui/icons-material';
import {
  usePendingOrderEmailSettings,
  useSavePendingOrderEmailSettings,
} from '../hooks/usePendingOrderEmailSettings';
import { Loading } from './Loading';
import { useAppDialog } from '../context/AppDialogProvider';
import type { PublicHoliday } from '../services/pendingOrderEmailSettings';
import { functions } from '../services/firebase';
import { httpsCallable } from 'firebase/functions';

export const PendingOrderEmailHolidaysTab: React.FC = () => {
  const { data, isLoading, error } = usePendingOrderEmailSettings();
  const saveMutation = useSavePendingOrderEmailSettings();
  const { alert } = useAppDialog();
  const [enabled, setEnabled] = useState(true);
  const [skipSunday, setSkipSunday] = useState(true);
  const [toEmails, setToEmails] = useState('satishyadav4446@gmail.com');
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setSkipSunday(data.skipSunday);
    setToEmails(data.toEmails.join(', '));
    setHolidays(data.holidays);
  }, [data]);

  const addHoliday = () => {
    const date = newDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (holidays.some((h) => h.date === date)) return;
    setHolidays((prev) =>
      [...prev, { date, name: newName.trim() || date }].sort((a, b) => a.date.localeCompare(b.date))
    );
    setNewDate('');
    setNewName('');
  };

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync({
        enabled,
        skipSunday,
        toEmails: toEmails.split(/[,;\s]+/).filter(Boolean),
        holidays,
      });
      await alert('Holiday and email settings saved.', { severity: 'success' });
    } catch (e: unknown) {
      await alert(e instanceof Error ? e.message : 'Failed to save', { severity: 'error' });
    }
  };

  if (isLoading) return <Loading message="Loading holiday settings…" />;
  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Failed to load settings. Deploy latest Firestore rules if this is a new collection.
      </Alert>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Pending order summary email
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Daily at 3:33 PM IST, the same Excel as Orders → Export Product Summary is emailed for all
        currently pending orders. Sundays and dates listed below are skipped.
      </Typography>

      <FormControlLabel
        control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
        label="Send daily email"
      />
      <FormControlLabel
        control={<Switch checked={skipSunday} onChange={(e) => setSkipSunday(e.target.checked)} />}
        label="Skip Sunday"
      />

      <TextField
        fullWidth
        size="small"
        label="Recipients"
        helperText="Comma-separated emails"
        value={toEmails}
        onChange={(e) => setToEmails(e.target.value)}
        sx={{ mt: 2, mb: 3, maxWidth: 560 }}
      />

      <Typography variant="subtitle1" gutterBottom>
        Public holidays
      </Typography>
      <Box display="flex" gap={1} flexWrap="wrap" alignItems="center" sx={{ mb: 2 }}>
        <TextField
          size="small"
          type="date"
          label="Date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          size="small"
          label="Name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. Diwali"
        />
        <Button
          variant="outlined"
          startIcon={<Add />}
          onClick={addHoliday}
          disabled={!newDate}
        >
          Add holiday
        </Button>
      </Box>

      <TableContainer sx={{ mb: 2, maxWidth: 640 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Name</TableCell>
              <TableCell align="right"> </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {holidays.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>
                  <Typography color="text.secondary">No holidays configured.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              holidays.map((h) => (
                <TableRow key={h.date}>
                  <TableCell>{h.date}</TableCell>
                  <TableCell>{h.name}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => setHolidays((prev) => prev.filter((x) => x.date !== h.date))}
                    >
                      <Delete />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Box display="flex" gap={1} flexWrap="wrap">
        <Button variant="contained" onClick={() => void handleSave()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save settings'}
        </Button>
        <Button
          variant="outlined"
          disabled={sending}
          onClick={async () => {
            setSending(true);
            try {
              const fn = httpsCallable(functions, 'sendPendingOrderSummaryNow', { timeout: 180000 });
              const res = await fn({});
              const data = (res.data || {}) as { orders?: number; rows?: number; to?: string[] };
              await alert(
                `Email sent to ${(data.to || []).join(', ') || 'recipient'} (${data.rows ?? 0} product rows, ${data.orders ?? 0} pending orders).`,
                { severity: 'success' }
              );
            } catch (e: unknown) {
              await alert(e instanceof Error ? e.message : 'Failed to send test email', {
                severity: 'error',
              });
            } finally {
              setSending(false);
            }
          }}
        >
          {sending ? 'Sending…' : 'Send now (test)'}
        </Button>
      </Box>
    </Box>
  );
};
