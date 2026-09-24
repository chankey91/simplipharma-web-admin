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
  Tooltip,
  Typography,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { format } from 'date-fns';
import { auth } from '../services/firebase';
import {
  useApprovePaymentRequest,
  usePaymentRequestsByStatus,
  usePaymentRequestStatusCounts,
  useOrderPaymentStatuses,
  useRejectPaymentRequest,
  useRevertPaymentRequest,
} from '../hooks/usePaymentRequests';
import { useAppDialog } from '../context/AppDialogProvider';
import type { PaymentRequest } from '../types';

type RequestTab = 'pending_admin_review' | 'approved' | 'rejected';

const formatCurrency = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const methodLabel = (
  method: string,
  requestedAmount = 0,
  walletAmount = 0
) => {
  if (method === 'wallet' || (requestedAmount <= 0.01 && walletAmount > 0.01)) return 'Wallet';
  if (method === 'online') return 'Online';
  return 'Cash';
};

function requestedWallet(r: { creditApplications?: { requestedApplyAmount?: number }[] }) {
  return (r.creditApplications || []).reduce(
    (sum, a) => sum + Math.max(0, Number(a.requestedApplyAmount || 0)),
    0
  );
}

export const PaymentRequestsPage: React.FC = () => {
  const [tab, setTab] = useState<RequestTab>('pending_admin_review');
  const { data: rows, isLoading, error, refetch } = usePaymentRequestsByStatus(tab);
  const { data: statusCounts } = usePaymentRequestStatusCounts();
  const orderIds = useMemo(() => [...new Set((rows ?? []).map((r) => r.orderId))], [rows]);
  const { data: orderPaymentByIdMap } = useOrderPaymentStatuses(orderIds);
  const approveMutation = useApprovePaymentRequest();
  const rejectMutation = useRejectPaymentRequest();
  const revertMutation = useRevertPaymentRequest();
  const { alert, confirm } = useAppDialog();
  const [rejectReasonById, setRejectReasonById] = useState<Record<string, string>>({});
  const actionPending =
    approveMutation.isPending || rejectMutation.isPending || revertMutation.isPending;

  const handleApprove = async (requestId: string, resettle = false) => {
    try {
      const result = await approveMutation.mutateAsync({
        requestId,
        reviewedBy: auth.currentUser?.email || auth.currentUser?.uid || 'admin',
        resettle,
      });
      if (result?.paymentStatus === 'Paid') {
        await alert('Payment applied. Order is now marked as Paid.', { severity: 'success' });
      } else if (result?.paymentStatus === 'Partial') {
        await alert('Payment applied. Order is partially paid.', { severity: 'success' });
      } else {
        await alert(
          'Request saved, but the invoice is still unpaid. Check wallet credit notes and try Apply to invoice.',
          { severity: 'warning' }
        );
      }
    } catch (err: any) {
      await alert(err?.message || 'Failed to approve payment request', { severity: 'error' });
    }
  };

  const handleReject = async (requestId: string) => {
    const reason = rejectReasonById[requestId]?.trim();
    if (!reason) {
      await alert('Please enter rejection reason.', { severity: 'warning' });
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
      await alert(err?.message || 'Failed to reject payment request', { severity: 'error' });
    }
  };

  const handleRevert = async (request: PaymentRequest) => {
    if (request.remittanceStatus === 'remitted') {
      await alert(
        'Cannot revert: sales officer cash for this request has already been remitted to office.',
        { severity: 'warning' }
      );
      return;
    }
    const cash = Number(request.approvedAmount ?? request.requestedAmount ?? 0);
    const wallet = Number(request.approvedCreditAmount ?? requestedWallet(request));
    const ok = await confirm(
      `Revert this approved payment? This undoes posted cash/online (${formatCurrency(cash)}) and wallet credit (${formatCurrency(wallet)}), restores credit notes, and recalculates the invoice. The request returns to pending.`,
      { title: 'Revert approved payment', confirmLabel: 'Revert', destructive: true }
    );
    if (!ok) return;
    try {
      const result = await revertMutation.mutateAsync({
        requestId: request.id,
        reviewedBy: auth.currentUser?.email || auth.currentUser?.uid || 'admin',
      });
      await alert(
        `Payment reverted. Invoice is now ${result.paymentStatus}. The request is back in pending.`,
        { severity: 'success' }
      );
    } catch (err: any) {
      await alert(err?.message || 'Failed to revert payment request', { severity: 'error' });
    }
  };

  const handleRefresh = () => {
    refetch();
  };

  if (isLoading) return <Typography>Loading payment requests...</Typography>;
  if (error) {
    const msg =
      (error as { message?: string })?.message || 'Failed to load payment requests.';
    return <Alert severity="error">{msg}</Alert>;
  }

  const pendingCount = statusCounts?.pending_admin_review ?? 0;
  const approvedCount = statusCounts?.approved ?? 0;
  const rejectedCount = statusCounts?.rejected ?? 0;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">Payment requests</Typography>
        <Button variant="outlined" startIcon={<Refresh />} onClick={handleRefresh}>
          Refresh
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Retailer/SO payment requests for delivered invoices. Approve posts cash/online plus wallet
        credit. Wallet-only requests show ₹0.00 requested — they still settle the invoice when
        approved. Revert on an approved request undoes those postings unless SO cash is already
        remitted.
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="pending_admin_review" label={`Pending (${pendingCount})`} />
        <Tab value="approved" label={`Approved (${approvedCount})`} />
        <Tab value="rejected" label={`Rejected (${rejectedCount})`} />
      </Tabs>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Invoice</TableCell>
                  <TableCell>Retailer</TableCell>
              <TableCell>Submitted by</TableCell>
              <TableCell>Method</TableCell>
              <TableCell align="right">Cash / online</TableCell>
              <TableCell align="right">Wallet</TableCell>
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
            {(rows ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    No requests in this status.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              (rows ?? []).map((r) => (
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
                  <TableCell>
                    {r.submittedByRole === 'salesOfficer' ? (
                      <>
                        <Typography fontWeight={500}>
                          {r.submittedByName || r.submittedBy || 'SO'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Sales officer
                        </Typography>
                      </>
                    ) : (
                      <>
                        <Typography fontWeight={500}>
                          {r.submittedByName || r.retailerName || 'Retailer'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {r.submittedByRole === 'retailer' ? 'Retailer' : '—'}
                        </Typography>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box display="flex" flexDirection="column" alignItems="flex-start" gap={0.5}>
                      <Typography variant="body2">
                        {methodLabel(r.method, r.requestedAmount, requestedWallet(r))}
                      </Typography>
                      {r.method === 'cash' && r.submittedByRole === 'salesOfficer' && (
                        <Chip
                          size="small"
                          label={
                            r.status === 'pending_admin_review'
                              ? 'SO cash · pending confirm'
                              : r.remittanceStatus === 'remitted'
                                ? 'SO cash · remitted'
                                : r.status === 'approved'
                                  ? 'SO cash · unremitted'
                                  : 'SO cash'
                          }
                          color={
                            r.remittanceStatus === 'remitted'
                              ? 'success'
                              : r.status === 'pending_admin_review'
                                ? 'warning'
                                : 'info'
                          }
                          variant="outlined"
                        />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="right">{formatCurrency(r.requestedAmount)}</TableCell>
                  <TableCell align="right">{formatCurrency(requestedWallet(r))}</TableCell>
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
                    {r.createdAt
                      ? format(
                          r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
                          'dd MMM yyyy, HH:mm'
                        )
                      : '—'}
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
                      label={orderPaymentByIdMap?.get(r.orderId) || '—'}
                      color={
                        orderPaymentByIdMap?.get(r.orderId) === 'Paid'
                          ? 'success'
                          : orderPaymentByIdMap?.get(r.orderId) === 'Partial'
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
                          disabled={actionPending}
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
                          disabled={actionPending}
                        >
                          Reject
                        </Button>
                      </Box>
                    ) : r.status === 'approved' ? (
                      <Box display="flex" justifyContent="flex-end" gap={1} flexWrap="wrap">
                        {(orderPaymentByIdMap?.get(r.orderId) || 'Unpaid') !== 'Paid' && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleApprove(r.id, true)}
                            disabled={actionPending}
                          >
                            Apply to invoice
                          </Button>
                        )}
                        <Tooltip
                          title={
                            r.remittanceStatus === 'remitted'
                              ? 'SO cash already remitted — cannot revert'
                              : 'Undo posted cash, wallet, and invoice totals'
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              color="error"
                              variant="outlined"
                              onClick={() => handleRevert(r)}
                              disabled={actionPending || r.remittanceStatus === 'remitted'}
                            >
                              Revert
                            </Button>
                          </span>
                        </Tooltip>
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
