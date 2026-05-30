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
  Download,
  PostAdd,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOrderReturnRequests,
  approveOrderReturnRequest,
  rejectOrderReturnRequest,
  recordOrderReturnPayment,
  OrderReturnRequest,
  OrderReturnStatus,
} from '../services/orderReturns';
import { getCreditNoteById } from '../services/creditNotes';
import { sendCreditNotePdfToRetailer } from '../services/creditNoteEmail';
import { generateCreditNotePdf, generateCreditNotePdfDataUri } from '../utils/creditNote';
import { useIssueCreditNoteForReturn } from '../hooks/useCreditNotes';
import { Loading } from '../components/Loading';
import { format } from 'date-fns';
import { getTodayDateStringIST } from '../utils/dateTime';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';

const STATUS_OPTIONS: { value: OrderReturnStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending_so', label: 'With SO' },
  { value: 'pending_admin', label: 'Admin queue' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'paid', label: 'Paid' },
];

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'NEFT', 'UPI', 'Other'];

export const OrderReturnsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<OrderReturnStatus | 'all'>('pending_admin');
  const [selectedRequest, setSelectedRequest] = useState<OrderReturnRequest | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentDate, setPaymentDate] = useState(getTodayDateStringIST());
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer');
  const [downloadingCreditNote, setDownloadingCreditNote] = useState(false);
  const issueCreditNoteMutation = useIssueCreditNoteForReturn();
  const { alert, confirm, prompt } = useAppDialog();

  const { data: requests, isLoading, error, refetch } = useQuery({
    queryKey: ['orderReturns', statusFilter],
    queryFn: () =>
      statusFilter === 'all' ? getOrderReturnRequests('all') : getOrderReturnRequests(statusFilter as OrderReturnStatus),
  });

  const approveMutation = useMutation({
    mutationFn: approveOrderReturnRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderReturns'] });
      queryClient.invalidateQueries({ queryKey: ['creditNotes'] });
      setSelectedRequest(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason?: string }) =>
      rejectOrderReturnRequest(requestId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderReturns'] });
      setSelectedRequest(null);
    },
  });

  const { sortKey, sortDirection, requestSort } = useTableSort('createdAt', 'desc');

  const sortedRequests = useMemo(() => {
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
        case 'order':
          return applyDirection(compareAsc(a.orderId || '', b.orderId || ''), sortDirection);
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
      recordOrderReturnPayment(requestId, {
        paymentReferenceNumber,
        paymentDate,
        paymentMethod,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderReturns'] });
      setSelectedRequest(null);
      setPaymentDialogOpen(false);
      setPaymentRef('');
      setPaymentDate(getTodayDateStringIST());
      setPaymentMethod('Bank Transfer');
    },
  });

  const handleApprove = async (req: OrderReturnRequest) => {
    if (!(await confirm('Approve this order return? A credit note will be generated for the retailer.'))) return;
    try {
      const result = await approveMutation.mutateAsync(req.id);
      let emailMessage = 'Credit note email could not be sent automatically.';
      try {
        const note = await getCreditNoteById(result.creditNoteId);
        if (!note) {
          emailMessage = 'Credit note generated, but email skipped because credit note was not found.';
        } else if (!note.retailerEmail) {
          emailMessage = 'Credit note generated, but retailer email is missing so email was skipped.';
        } else {
          const pdfDataUri = await generateCreditNotePdfDataUri(note);
          const fileName = `credit-note-${result.creditNoteNumber}.pdf`;
          const emailRes = await sendCreditNotePdfToRetailer(result.creditNoteId, pdfDataUri, fileName);
          emailMessage = emailRes?.ok
            ? `Email sent to ${emailRes.emailedTo || note.retailerEmail}.`
            : 'Credit note generated, but email sending failed.';
        }
      } catch (emailErr: any) {
        emailMessage = emailErr?.message || emailMessage;
      }

      await alert(
        `Return approved. Credit note ${result.creditNoteNumber} has been generated. ${emailMessage} Record payment when the refund is made offline.`,
        { severity: 'success' }
      );
    } catch (err: any) {
      await alert(err.message || 'Failed to approve', { severity: 'error' });
    }
  };

  const handleDownloadCreditNote = async (req: OrderReturnRequest) => {
    if (!req.creditNoteId && !req.creditNoteNumber) {
      await alert('No credit note found for this return.', { severity: 'warning' });
      return;
    }
    setDownloadingCreditNote(true);
    try {
      const note = req.creditNoteId ? await getCreditNoteById(req.creditNoteId) : null;
      if (!note) {
        await alert('Credit note not found.', { severity: 'error' });
        return;
      }
      await generateCreditNotePdf(note);
    } catch (err: any) {
      await alert(err.message || 'Failed to download credit note', { severity: 'error' });
    } finally {
      setDownloadingCreditNote(false);
    }
  };

  const handleGenerateCreditNote = async (req: OrderReturnRequest) => {
    if (!(await confirm('Generate credit note for this return?'))) return;
    try {
      const result = await issueCreditNoteMutation.mutateAsync(req.id);
      await alert(
        result.created
          ? `Credit note ${result.creditNoteNumber} created.`
          : `Credit note ${result.creditNoteNumber} is already linked.`,
        { severity: 'success' }
      );
      setSelectedRequest((prev) =>
        prev?.id === req.id
          ? { ...prev, creditNoteId: result.creditNoteId, creditNoteNumber: result.creditNoteNumber }
          : prev
      );
    } catch (err: any) {
      await alert(err.message || 'Failed to generate credit note', { severity: 'error' });
    }
  };

  const needsCreditNote = (req: OrderReturnRequest) =>
    (req.status === 'approved' || req.status === 'paid') &&
    !req.creditNoteId &&
    !req.creditNoteNumber;

  const handleReject = async (req: OrderReturnRequest) => {
    const reason = await prompt('Optional: Enter reason for rejection');
    try {
      await rejectMutation.mutateAsync({ requestId: req.id, reason: reason || '' });
      await alert('Request rejected', { severity: 'success' });
    } catch (err: any) {
      await alert(err.message || 'Failed to reject', { severity: 'error' });
    }
  };

  const openPaymentDialog = (req: OrderReturnRequest) => {
    setSelectedRequest(req);
    setPaymentRef('');
    setPaymentDate(getTodayDateStringIST());
    setPaymentMethod('Bank Transfer');
    setPaymentDialogOpen(true);
  };

  const handleRecordPayment = async () => {
    if (!selectedRequest) return;
    if (!paymentRef.trim()) {
      await alert('Payment reference number is required', { severity: 'warning' });
      return;
    }
    try {
      await paymentMutation.mutateAsync({
        requestId: selectedRequest.id,
        paymentReferenceNumber: paymentRef.trim(),
        paymentDate: new Date(paymentDate),
        paymentMethod: paymentMethod,
      });
      await alert('Payment recorded successfully', { severity: 'success' });
    } catch (err: any) {
      await alert(err.message || 'Failed to record payment', { severity: 'error' });
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
      case 'pending_so':
        return 'warning';
      case 'pending_admin':
        return 'info';
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

  if (isLoading) return <Loading message="Loading order returns..." />;
  if (error) return <Typography color="error">Failed to load order return requests</Typography>;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Order Returns (Delivered)</Typography>
        <Button variant="outlined" startIcon={<Refresh />} onClick={() => refetch()}>
          Refresh
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Returns from delivered orders: the Sales Officer verifies batches vs invoice and forwards here. Approve, then
        record payment when the refund is settled offline (same as expiry returns).
      </Typography>

      <Tabs value={statusFilter} onChange={(_, v) => setStatusFilter(v)} sx={{ mb: 2 }}>
        {STATUS_OPTIONS.map((opt) => (
          <Tab key={opt.value} label={opt.label} value={opt.value} />
        ))}
      </Tabs>

      {sortedRequests.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No {statusFilter === 'all' ? '' : statusFilter} requests.
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <SortableTableHeadCell
                columnId="retailer"
                label="Retailer"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="order"
                label="Order"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="amount"
                label="Amount"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="items"
                label="Items"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="status"
                label="Status"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <TableCell>Credit note</TableCell>
              <SortableTableHeadCell
                columnId="createdAt"
                label="Submitted"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRequests.map((req) => (
              <TableRow key={req.id} hover>
                <TableCell>
                  <Typography fontWeight={500}>{req.retailerName || req.retailerEmail || 'Retailer'}</Typography>
                  {req.retailerEmail && (
                    <Typography variant="body2" color="text.secondary">
                      {req.retailerEmail}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{req.orderId?.slice(0, 10)}…</Typography>
                  {req.invoiceNumber && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Inv: {req.invoiceNumber}
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
                <TableCell>
                  {req.creditNoteNumber ? (
                    <Typography variant="body2">{req.creditNoteNumber}</Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      —
                    </Typography>
                  )}
                </TableCell>
                <TableCell>{formatDate(req.createdAt)}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="primary" onClick={() => setSelectedRequest(req)} title="View Details">
                    <Visibility />
                  </IconButton>
                  {req.status === 'pending_admin' && (
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
                    <IconButton size="small" color="primary" onClick={() => openPaymentDialog(req)} title="Record Payment">
                      <Payment />
                    </IconButton>
                  )}
                  {needsCreditNote(req) && (
                    <IconButton
                      size="small"
                      color="secondary"
                      onClick={() => handleGenerateCreditNote(req)}
                      disabled={issueCreditNoteMutation.isPending}
                      title="Generate credit note"
                    >
                      <PostAdd />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!selectedRequest && !paymentDialogOpen} onClose={() => setSelectedRequest(null)} maxWidth="md" fullWidth>
        {selectedRequest && !paymentDialogOpen && (
          <>
            <DialogTitle>Order Return Details</DialogTitle>
            <DialogContent>
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Retailer
                </Typography>
                <Typography>
                  {selectedRequest.retailerName || selectedRequest.retailerEmail} ({selectedRequest.retailerEmail})
                </Typography>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  Order
                </Typography>
                <Typography>{selectedRequest.orderId}</Typography>
                {selectedRequest.invoiceNumber && (
                  <Typography variant="body2">Invoice: {selectedRequest.invoiceNumber}</Typography>
                )}
                {selectedRequest.soForwardedAt && (
                  <Typography variant="body2" color="text.secondary">
                    Forwarded by SO: {formatDate(selectedRequest.soForwardedAt)}
                  </Typography>
                )}
                {selectedRequest.soEvidenceUploadedAt && (
                  <Typography variant="body2" color="text.secondary">
                    Evidence uploaded: {formatDate(selectedRequest.soEvidenceUploadedAt)}
                  </Typography>
                )}
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
                  SO Verification Evidence
                </Typography>
                {selectedRequest.soEvidenceUrls && selectedRequest.soEvidenceUrls.length > 0 ? (
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 1.5, mt: 1 }}>
                    {selectedRequest.soEvidenceUrls.map((url, idx) => (
                      <Box key={`${url}-${idx}`} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5 }}>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={url}
                            alt={`SO evidence ${idx + 1}`}
                            style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 6 }}
                          />
                        </a>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    No SO evidence uploaded.
                  </Alert>
                )}
                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  Items
                </Typography>
                {selectedRequest.items?.some((it) => !String(it.batchNumber || '').trim()) && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    One or more return lines have missing batch number. Approval will be blocked until batch is captured.
                  </Alert>
                )}
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
                        <TableRow
                          key={idx}
                          sx={{
                            bgcolor: !String(it.batchNumber || '').trim()
                              ? 'rgba(255, 152, 0, 0.10)'
                              : 'inherit',
                          }}
                        >
                          <TableCell>{it.medicineName}</TableCell>
                          <TableCell>
                            {String(it.batchNumber || '').trim() || (
                              <Typography variant="caption" color="error">
                                Missing
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">{it.quantity}</TableCell>
                          <TableCell align="right">₹{it.unitRefundPrice}</TableCell>
                          <TableCell align="right">{formatAmount(it.refundAmount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {needsCreditNote(selectedRequest) && (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    No credit note yet for this approved return.
                  </Alert>
                )}
                {(selectedRequest.creditNoteNumber || selectedRequest.creditNoteId) && (
                  <>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                      Credit note
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography>{selectedRequest.creditNoteNumber || 'Issued'}</Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<Download />}
                        disabled={downloadingCreditNote}
                        onClick={() => handleDownloadCreditNote(selectedRequest)}
                      >
                        Download PDF
                      </Button>
                    </Box>
                  </>
                )}
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
              {needsCreditNote(selectedRequest) && (
                <Button
                  startIcon={<PostAdd />}
                  variant="contained"
                  disabled={issueCreditNoteMutation.isPending}
                  onClick={() => handleGenerateCreditNote(selectedRequest)}
                >
                  Generate credit note
                </Button>
              )}
              {(selectedRequest.creditNoteNumber || selectedRequest.creditNoteId) && (
                <Button
                  startIcon={<Download />}
                  disabled={downloadingCreditNote}
                  onClick={() => handleDownloadCreditNote(selectedRequest)}
                >
                  Credit note PDF
                </Button>
              )}
              {selectedRequest.status === 'pending_admin' && (
                <>
                  <Button color="error" variant="outlined" onClick={() => handleReject(selectedRequest)} disabled={rejectMutation.isPending}>
                    Reject
                  </Button>
                  <Button color="success" variant="contained" onClick={() => handleApprove(selectedRequest)} disabled={approveMutation.isPending}>
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
            Enter the payment reference (UTR, cheque no, etc.) used for the refund to the retailer.
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
