import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Tabs,
  Tab,
  TextField,
  Alert,
} from '@mui/material';
import {
  CheckCircle,
  Cancel,
  Visibility,
  Refresh,
  Payment,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getExpiryReturnRequests,
  approveExpiryReturnRequest,
  rejectExpiryReturnRequest,
  recordExpiryReturnPayment,
  ExpiryReturnRequest,
  ExpiryReturnStatus,
} from '../services/expiryReturns';
import { Loading } from '../components/Loading';
import { format } from 'date-fns';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';

const STATUS_OPTIONS: { value: ExpiryReturnStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'paid', label: 'Paid' },
];

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'NEFT', 'UPI', 'Other'];

export const ExpiryReturnsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ExpiryReturnStatus | 'all'>('pending');
  const [selectedRequest, setSelectedRequest] = useState<ExpiryReturnRequest | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer');

  const { data: requests, isLoading, error, refetch } = useQuery({
    queryKey: ['expiryReturns', statusFilter],
    queryFn: () =>
      statusFilter === 'all'
        ? getExpiryReturnRequests()
        : getExpiryReturnRequests(statusFilter as ExpiryReturnStatus),
  });

  const approveMutation = useMutation({
    mutationFn: approveExpiryReturnRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expiryReturns'] });
      setSelectedRequest(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason?: string }) =>
      rejectExpiryReturnRequest(requestId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expiryReturns'] });
      setSelectedRequest(null);
    },
  });

  const { sortKey, sortDirection, requestSort } = useTableSort('createdAt', 'desc');

  const sortedExpiryRequests = useMemo(() => {
    const list = [...(requests || [])];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'retailer':
          return applyDirection(
            compareAsc(
              `${a.retailerName || ''} ${a.retailerEmail || ''}`.toLowerCase(),
              `${b.retailerName || ''} ${b.retailerEmail || ''}`.toLowerCase()
            ),
            sortDirection
          );
        case 'amount':
          return applyDirection(compareAsc(a.totalRefundAmount ?? 0, b.totalRefundAmount ?? 0), sortDirection);
        case 'items':
          return applyDirection(compareAsc(a.items?.length ?? 0, b.items?.length ?? 0), sortDirection);
        case 'status':
          return applyDirection(compareAsc(a.status, b.status), sortDirection);
        case 'createdAt':
          return applyDirection(compareAsc(toTimeMs(a.createdAt), toTimeMs(b.createdAt)), sortDirection);
        default:
          return applyDirection(compareAsc(toTimeMs(a.createdAt), toTimeMs(b.createdAt)), 'desc');
      }
    });
    return list;
  }, [requests, sortKey, sortDirection]);

  const paymentMutation = useMutation({
    mutationFn: ({
      requestId,
      paymentReferenceNumber,
      paymentDate,
      paymentMethod,
    }: {
      requestId: string;
      paymentReferenceNumber: string;
      paymentDate: Date;
      paymentMethod: string;
    }) =>
      recordExpiryReturnPayment(requestId, {
        paymentReferenceNumber,
        paymentDate,
        paymentMethod,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expiryReturns'] });
      setSelectedRequest(null);
      setPaymentDialogOpen(false);
      setPaymentRef('');
      setPaymentDate(new Date().toISOString().slice(0, 10));
      setPaymentMethod('Bank Transfer');
    },
  });

  const handleApprove = async (req: ExpiryReturnRequest) => {
    if (!confirm('Approve this expiry return request? The retailer can then receive payment.')) return;
    try {
      await approveMutation.mutateAsync(req.id);
      alert('Request approved. You can now record payment when it is done offline.');
    } catch (err: any) {
      alert(err.message || 'Failed to approve');
    }
  };

  const handleReject = async (req: ExpiryReturnRequest) => {
    const reason = prompt('Optional: Enter reason for rejection');
    try {
      await rejectMutation.mutateAsync({ requestId: req.id, reason: reason || '' });
      alert('Request rejected');
    } catch (err: any) {
      alert(err.message || 'Failed to reject');
    }
  };

  const openPaymentDialog = (req: ExpiryReturnRequest) => {
    setSelectedRequest(req);
    setPaymentRef('');
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentMethod('Bank Transfer');
    setPaymentDialogOpen(true);
  };

  const handleRecordPayment = async () => {
    if (!selectedRequest) return;
    if (!paymentRef.trim()) {
      alert('Payment reference number is required');
      return;
    }
    try {
      await paymentMutation.mutateAsync({
        requestId: selectedRequest.id,
        paymentReferenceNumber: paymentRef.trim(),
        paymentDate: new Date(paymentDate),
        paymentMethod: paymentMethod,
      });
      alert('Payment recorded successfully');
    } catch (err: any) {
      alert(err.message || 'Failed to record payment');
    }
  };

  const formatDate = (d: any) => {
    if (!d) return 'N/A';
    try {
      const date = d instanceof Date ? d : d?.toDate?.() || new Date(d);
      return format(date, 'dd MMM yyyy, HH:mm');
    } catch {
      return 'N/A';
    }
  };

  const formatAmount = (n: number) => `₹${n?.toLocaleString('en-IN') || '0'}`;

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'pending':
        return 'warning';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'error';
      case 'paid':
        return 'info';
      default:
        return 'default';
    }
  };

  if (isLoading) return <Loading message="Loading expiry returns..." />;
  if (error) return <Typography color="error">Failed to load expiry return requests</Typography>;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Expiry Returns</Typography>
        <Button variant="outlined" startIcon={<Refresh />} onClick={() => refetch()}>
          Refresh
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Expiry return requests from retailers. Approve requests, then record payment reference when payment is made offline.
      </Typography>

      <Tabs value={statusFilter} onChange={(_, v) => setStatusFilter(v)} sx={{ mb: 2 }}>
        {STATUS_OPTIONS.map((opt) => (
          <Tab key={opt.value} label={opt.label} value={opt.value} />
        ))}
      </Tabs>

      {sortedExpiryRequests.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No {statusFilter === 'all' ? '' : statusFilter} requests.
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <SortableTableHeadCell columnId="retailer" label="Retailer" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
              <SortableTableHeadCell columnId="amount" label="Amount" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
              <SortableTableHeadCell columnId="items" label="Items" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
              <SortableTableHeadCell columnId="status" label="Status" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
              <SortableTableHeadCell columnId="createdAt" label="Submitted" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedExpiryRequests.map((req) => (
              <TableRow key={req.id} hover>
                <TableCell>
                  <Typography fontWeight={500}>
                    {req.retailerName || req.retailerEmail || 'Retailer'}
                  </Typography>
                  {req.retailerEmail && (
                    <Typography variant="body2" color="text.secondary">
                      {req.retailerEmail}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Typography fontWeight={600}>{formatAmount(req.totalRefundAmount)}</Typography>
                </TableCell>
                <TableCell>{req.items?.length || 0} item(s)</TableCell>
                <TableCell>
                  <Chip label={req.status} color={getStatusColor(req.status) as any} size="small" />
                </TableCell>
                <TableCell>{formatDate(req.createdAt)}</TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => setSelectedRequest(req)}
                    title="View Details"
                  >
                    <Visibility />
                  </IconButton>
                  {req.status === 'pending' && (
                    <>
                      <IconButton
                        size="small"
                        color="success"
                        onClick={() => handleApprove(req)}
                        disabled={approveMutation.isPending}
                        title="Approve"
                      >
                        <CheckCircle />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleReject(req)}
                        disabled={rejectMutation.isPending}
                        title="Reject"
                      >
                        <Cancel />
                      </IconButton>
                    </>
                  )}
                  {req.status === 'approved' && (
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => openPaymentDialog(req)}
                      title="Record Payment"
                    >
                      <Payment />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Detail Dialog */}
      <Dialog open={!!selectedRequest && !paymentDialogOpen} onClose={() => setSelectedRequest(null)} maxWidth="md" fullWidth>
        {selectedRequest && !paymentDialogOpen && (
          <>
            <DialogTitle>Expiry Return Details</DialogTitle>
            <DialogContent>
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Retailer
                </Typography>
                <Typography>
                  {selectedRequest.retailerName || selectedRequest.retailerEmail} ({selectedRequest.retailerEmail})
                </Typography>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  Total Amount
                </Typography>
                <Typography variant="h6">{formatAmount(selectedRequest.totalRefundAmount)}</Typography>
                {selectedRequest.soNotes && (
                  <>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                      SO Notes
                    </Typography>
                    <Typography>{selectedRequest.soNotes}</Typography>
                  </>
                )}
                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  Items
                </Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Medicine</TableCell>
                        <TableCell>Batch</TableCell>
                        <TableCell align="right">Qty</TableCell>
                        <TableCell align="right">Unit Price</TableCell>
                        <TableCell align="right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedRequest.items?.map((it, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{it.medicineName}</TableCell>
                          <TableCell>{it.batchNumber}</TableCell>
                          <TableCell align="right">{it.quantity}</TableCell>
                          <TableCell align="right">₹{it.unitRefundPrice}</TableCell>
                          <TableCell align="right">{formatAmount(it.refundAmount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {selectedRequest.status === 'paid' && selectedRequest.paymentReferenceNumber && (
                  <>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                      Payment
                    </Typography>
                    <Typography>
                      Ref: {selectedRequest.paymentReferenceNumber} | {selectedRequest.paymentMethod || 'N/A'} |{' '}
                      {formatDate(selectedRequest.paymentDate)}
                    </Typography>
                  </>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedRequest(null)}>Close</Button>
              {selectedRequest.status === 'pending' && (
                <>
                  <Button
                    color="error"
                    variant="outlined"
                    onClick={() => handleReject(selectedRequest)}
                    disabled={rejectMutation.isPending}
                  >
                    Reject
                  </Button>
                  <Button
                    color="success"
                    variant="contained"
                    onClick={() => handleApprove(selectedRequest)}
                    disabled={approveMutation.isPending}
                  >
                    {approveMutation.isPending ? 'Approving...' : 'Approve'}
                  </Button>
                </>
              )}
              {selectedRequest.status === 'approved' && (
                <Button color="primary" variant="contained" onClick={() => openPaymentDialog(selectedRequest)}>
                  Record Payment
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Record Payment Dialog */}
      <Dialog
        open={paymentDialogOpen}
        onClose={() => {
          setPaymentDialogOpen(false);
          setSelectedRequest(null);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Record Payment (Offline)</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Payment is made offline. Enter the payment reference number (UTR, cheque no, receipt no, etc.) for audit.
          </Typography>
          <TextField
            fullWidth
            label="Payment Reference Number *"
            value={paymentRef}
            onChange={(e) => setPaymentRef(e.target.value)}
            placeholder="e.g. UTR123456789, CHQ001"
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Payment Date"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            select
            label="Payment Method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            SelectProps={{ native: true }}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setPaymentDialogOpen(false);
              setSelectedRequest(null);
            }}
          >
            Cancel
          </Button>
          <Button
            color="primary"
            variant="contained"
            onClick={handleRecordPayment}
            disabled={!paymentRef.trim() || paymentMutation.isPending}
          >
            {paymentMutation.isPending ? 'Saving...' : 'Record Payment'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
