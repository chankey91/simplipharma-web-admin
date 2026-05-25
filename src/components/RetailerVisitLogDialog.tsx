import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { format } from 'date-fns';
import { getVisitLogsForRetailer, SoVisitLog } from '../services/visitLogs';
import { User } from '../types';

type Props = {
  open: boolean;
  store: User | null;
  salesOfficerNameById: Record<string, string>;
  onClose: () => void;
};

export const RetailerVisitLogDialog: React.FC<Props> = ({
  open,
  store,
  salesOfficerNameById,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<SoVisitLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !store?.id) {
      setLogs([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getVisitLogsForRetailer(store.id)
      .then((rows) => {
        if (!cancelled) setLogs(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load visit logs');
          setLogs([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, store?.id]);

  const title = store?.shopName || store?.displayName || store?.email || 'Store';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Visit log — {title}</DialogTitle>
      <DialogContent>
        {store?.email ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {store.email}
            {store.storeCode ? ` · ${store.storeCode}` : ''}
          </Typography>
        ) : null}
        {loading ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress size={32} />
          </Box>
        ) : error ? (
          <Typography color="error">{error}</Typography>
        ) : logs.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No visits logged for this store yet.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Visited</TableCell>
                  <TableCell>Sales officer</TableCell>
                  <TableCell>Note</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {format(log.visitedAt, 'dd MMM yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      {salesOfficerNameById[log.salesOfficerId] || log.salesOfficerId || '—'}
                    </TableCell>
                    <TableCell>{log.note || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
