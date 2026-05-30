import React, { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { format } from 'date-fns';
import { auth } from '../services/firebase';
import {
  useApprovePaymentRequest,
  usePaymentRequests,
  useRejectPaymentRequest,
} from '../hooks/usePaymentRequests';
import { useOrders } from '../hooks/useOrders';

type RequestTab = 'pending_admin_review' | 'approved' | 'rejected';

const formatCurrency = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const methodLabel = (method: string) => (method === 'online' ? 'Online' : 'Cash');

export const PaymentRequestsPage: React.FC = () => {
  const { data, isLoading, error, refetch } = usePaymentRequests();
  const { data: orders } = useOrders();
  const approveMutation = useApprovePaymentRequest();
  const rejectMutation = useRejectPaymentRequest();
  const [tab, setTab] = useState<RequestTab>('pending_admin_review');
  const [rejectReasonById, setRejectReasonById] = useState<Record<string, string>>({});

  const orderPaymentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders ?? []) {
      map.set(o.id, o.paymentStatus || 'Unpaid');
    }
    return map;
  }, [orders]);

  const filtered = useMemo(
    () => (data ?? []).filter((r) => r.status === tab),
    [data, tab]
  );

  const handleApprove = async (requestId: string) => {
    try {
      const result = await approveMutation.mutateAsync({
        requestId,
        reviewedBy: auth.currentUser?.email || auth.currentUser?.uid || 'admin',
      });
      if (result?.paymentStatus === 'Paid') {
        alert('Payment approved. Order is now marked as Paid.');
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to approve payment request');
    }
  };

  const handleReject = async (requestId: string) => {
    const reason = rejectReasonById[requestId]?.trim();
    if (!reason) {
      alert('Please enter rejection reason.');
      return;
    }
    try {
      await rejectMutation.mutateAsync({
        requestId,
        reviewedBy: auth.currentUser?.email || auth.currentUser?.uid || 'admin',
        rejectionReason: reason,
      });
      setRejectReasonById((prev) => ({ ...prev, [requestId]: '' }));
    } catch (err: any) {
      alert(err?.message || 'Failed to reject payment request');
    }
  };

  if (isLoading) return <Typography>Loading payment requests...</Typography>;
  if (error) {
    const msg =
      (error as { message?: string })?.message || 'Failed to load payment requests.';
    return (
      <Alert severity="error">
        {msg}
      </Alert>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">Payment requests</Typography>
        <Button variant="outlined" startIcon={<Refresh />} onClick={() => refetch()}>
          Refresh
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Retailer-submitted payment requests for delivered invoices. Approve to post payment on order,
        or reject with reason.
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="pending_admin_review" label={`Pending (${(data ?? []).filter((r) => r.status === 'pending_admin_review').length})`} />
        <Tab value="approved" label={`Approved (${(data ?? []).filter((r) => r.status === 'approved').length})`} />
        <Tab value="rejected" label={`Rejected (${(data ?? []).filter((r) => r.status === 'rejected').length})`} />
      </Tabs>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Invoice</TableCell>
              <TableCell>Retailer</TableCell>
              <TableCell>Method</TableCell>
              <TableCell align="right">Requested</TableCell>
              <TableCell align="right">Due snapshot</TableCell>
              <TableCell>Transaction / Ref</TableCell>
              <TableCell>Screenshot</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Request</TableCell>
              <TableCell>Order payment</TableCell>
              <TableCell align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    No requests in this status.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>
                    <Link component={RouterLink} to={`/orders/${r.orderId}`} underline="hover">
                      {r.invoiceNumber || r.orderId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Typography fontWeight={500}>{r.retailerName || '—'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {r.retailerEmail || r.retailerId}
                    </Typography>
                  </TableCell>
                  <TableCell>{methodLabel(r.method)}</TableCell>
                  <TableCell align="right">{formatCurrency(r.requestedAmount)}</TableCell>
                  <TableCell align="right">{formatCurrency(r.dueBeforeRequestSnapshot || 0)}</TableCell>
                  <TableCell>{r.transactionId || r.cashReference || '—'}</TableCell>
                  <TableCell>
                    {r.screenshotUrl ? (
                      <Link href={r.screenshotUrl} target="_blank" rel="noreferrer">
                        View
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    {r.createdAt ? format(r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt), 'dd MMM yyyy, HH:mm') : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={r.status.replace(/_/g, ' ')}
                      color={
                        r.status === 'approved'
                          ? 'success'
                          : r.status === 'rejected'
                            ? 'error'
                            : 'warning'
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={orderPaymentById.get(r.orderId) || '—'}
                      color={
                        orderPaymentById.get(r.orderId) === 'Paid'
                          ? 'success'
                          : orderPaymentById.get(r.orderId) === 'Partial'
                            ? 'warning'
                            : 'default'
                      }
                    />
                  </TableCell>
                  <TableCell align="right">
                    {r.status === 'pending_admin_review' ? (
                      <Box display="flex" justifyContent="flex-end" gap={1}>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => handleApprove(r.id)}
                          disabled={approveMutation.isPending || rejectMutation.isPending}
                        >
                          Approve
                        </Button>
                        <TextField
                          size="small"
                          placeholder="Reject reason"
                          value={rejectReasonById[r.id] || ''}
                          onChange={(e) =>
                            setRejectReasonById((prev) => ({ ...prev, [r.id]: e.target.value }))
                          }
                        />
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          onClick={() => handleReject(r.id)}
                          disabled={approveMutation.isPending || rejectMutation.isPending}
                        >
                          Reject
                        </Button>
                      </Box>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};
