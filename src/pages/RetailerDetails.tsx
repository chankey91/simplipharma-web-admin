import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { RetailerVisitLogDialog } from '../components/RetailerVisitLogDialog';
import { RetailerWalletDialog } from '../components/RetailerWalletDialog';
import { Loading } from '../components/Loading';
import { OrderPlacementStatusChip } from '../components/OrderPlacementStatusChip';
import { useAppDialog } from '../context/AppDialogProvider';
import { useAuth } from '../context/AuthContext';
import { useOrderPlacementBlockedRetailerIds } from '../hooks/useOrders';
import { useRetailerWallet } from '../hooks/useRetailerWallet';
import { useSalesOfficers } from '../hooks/useSalesOfficers';
import {
  useGrantOrderBlockOverride,
  useSendRetailerPasswordResetEmail,
  useStores,
  useToggleStoreStatus,
} from '../hooks/useStores';
import { getCreditNotesByRetailer } from '../services/creditNotes';
import { getDebitNotesByRetailer } from '../services/debitNotes';
import { CreditNote, DebitNote, User } from '../types';
import { coerceToDate } from '../utils/dateTime';
import { StoreLedgerPage } from './StoreLedger';

const TABS = ['overview', 'wallet', 'ledger', 'credit', 'debit'] as const;
type RetailerTab = (typeof TABS)[number];

const inr = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function noteDate(value: unknown): string {
  const date = coerceToDate(value);
  return date ? format(date, 'dd MMM yyyy') : '—';
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <Grid item xs={12} sm={6} md={4}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value?.trim() ? value : '—'}</Typography>
    </Grid>
  );
}

function NoteTable({
  rows,
  onOpenOrder,
}: {
  rows: Array<{
    id: string;
    number: string;
    date: unknown;
    status?: string;
    reason?: string;
    amount: number;
    orderId?: string;
  }>;
  onOpenOrder: (orderId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        No notes for this retailer.
      </Typography>
    );
  }
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Date</TableCell>
            <TableCell>Number</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Reason</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>{noteDate(row.date)}</TableCell>
              <TableCell>{row.number}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={row.status === 'cancelled' ? 'Cancelled' : 'Issued'}
                  color={row.status === 'cancelled' ? 'default' : 'success'}
                  variant="outlined"
                />
              </TableCell>
              <TableCell>{row.reason || '—'}</TableCell>
              <TableCell align="right">{inr(row.amount)}</TableCell>
              <TableCell align="right">
                {row.orderId ? (
                  <Button size="small" onClick={() => onOpenOrder(row.orderId!)}>
                    Order
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export const RetailerDetailsPage: React.FC = () => {
  const { storeId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canWrite } = useAuth();
  const canEditStores = canWrite('stores');
  const { alert, confirm } = useAppDialog();
  const { data: stores, isLoading } = useStores();
  const { data: salesOfficers = [] } = useSalesOfficers();
  const { overdueRetailerIds } = useOrderPlacementBlockedRetailerIds();
  const toggleStatusMutation = useToggleStoreStatus();
  const resetPasswordMutation = useSendRetailerPasswordResetEmail();
  const grantOverrideMutation = useGrantOrderBlockOverride();
  const wallet = useRetailerWallet(storeId, true);
  const [visitOpen, setVisitOpen] = useState(false);

  const tabParam = searchParams.get('tab');
  const tab: RetailerTab = TABS.includes(tabParam as RetailerTab) ? (tabParam as RetailerTab) : 'overview';

  const creditQuery = useQuery({
    queryKey: ['retailerCreditNotes', storeId],
    queryFn: () => getCreditNotesByRetailer(storeId),
    enabled: !!storeId,
  });
  const debitQuery = useQuery({
    queryKey: ['retailerDebitNotes', storeId],
    queryFn: () => getDebitNotesByRetailer(storeId),
    enabled: !!storeId,
  });

  const store = stores?.find((row) => row.id === storeId) ?? null;
  const salesOfficerNameById: Record<string, string> = {};
  for (const officer of salesOfficers) {
    salesOfficerNameById[officer.id] = officer.displayName || officer.email || officer.id;
  }

  const setTab = (next: RetailerTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const issuedTotal = (rows: Array<{ status?: string; totalAmount?: number }>) =>
    rows.reduce((sum, row) => (row.status === 'cancelled' ? sum : sum + (Number(row.totalAmount) || 0)), 0);

  const handleToggle = async (retailer: User) => {
    const nextActive = retailer.isActive === false;
    if (!nextActive) {
      const ok = await confirm(
        `${retailer.shopName || retailer.displayName || 'This retailer'} will be signed out and cannot sign in until you activate them again.`,
        { title: 'Deactivate retailer?', confirmLabel: 'Deactivate', destructive: true }
      );
      if (!ok) return;
    }
    toggleStatusMutation.mutate(
      { storeId: retailer.id, isActive: nextActive },
      {
        onSuccess: (result) => {
          if (result?.message) void alert(result.message, { severity: 'warning' });
        },
        onError: (error: unknown) => {
          void alert(error instanceof Error ? error.message : 'Could not update retailer access', {
            severity: 'error',
          });
        },
      }
    );
  };

  const handleResetPassword = async (retailer: User) => {
    const email = (retailer.email || '').trim();
    if (!email) return;
    const ok = await confirm(
      `Send a password reset link to ${email}? The retailer will use it to set a new password for the SimpliPharma mobile app.`
    );
    if (!ok) return;
    try {
      const res = await resetPasswordMutation.mutateAsync(email);
      await alert(res.message, { severity: 'success' });
    } catch (error: unknown) {
      await alert(error instanceof Error ? error.message : 'Could not send the reset link', {
        severity: 'error',
      });
    }
  };

  const handleGrantOrderOverride = async (retailerId: string) => {
    const name = store?.shopName || store?.displayName || 'this store';
    const ok = await confirm(
      `Enable ordering for ${name} for the next 6 hours? The retailer will be able to place orders even if payment is overdue.`,
      { title: 'Unlock ordering (6 hours)', confirmLabel: 'Enable 6 hours' }
    );
    if (!ok) return;
    try {
      const until = await grantOverrideMutation.mutateAsync(retailerId);
      await alert(`Ordering unlocked until ${format(until, 'MMM dd, h:mm a')}.`, { severity: 'success' });
    } catch (error: unknown) {
      await alert(error instanceof Error ? error.message : 'Failed to unlock ordering', { severity: 'error' });
    }
  };

  if (isLoading) return <Loading message="Loading retailer..." />;

  if (!store) {
    return (
      <Box>
        <Button startIcon={<ArrowBack />} onClick={() => navigate('/stores')}>
          Stores
        </Button>
        <Typography sx={{ mt: 2 }}>This retailer was not found.</Typography>
      </Box>
    );
  }

  const creditNotes = [...(creditQuery.data ?? [])].reverse();
  const debitNotes = [...(debitQuery.data ?? [])].reverse();
  const shopTitle = store.shopName || store.displayName || store.email || 'Retailer';

  return (
    <Box>
      <Button startIcon={<ArrowBack />} onClick={() => navigate('/stores')} sx={{ mb: 1 }}>
        Stores
      </Button>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2} flexWrap="wrap" mb={2}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            {shopTitle}
          </Typography>
          <Box display="flex" gap={1} alignItems="center" flexWrap="wrap" mt={1}>
            {store.storeCode ? <Chip size="small" label={store.storeCode} color="primary" variant="outlined" /> : null}
            <Chip
              size="small"
              label={store.isActive !== false ? 'Active' : 'Inactive'}
              color={store.isActive !== false ? 'success' : 'default'}
            />
            <OrderPlacementStatusChip
              retailerId={store.id}
              overdue={overdueRetailerIds.has(store.id)}
              overrideUntil={store.orderBlockOverrideUntil}
              onGrantOverride={handleGrantOrderOverride}
              disabled={grantOverrideMutation.isPending || !canEditStores}
            />
          </Box>
        </Box>
        <Box display="flex" gap={1} flexWrap="wrap">
          <Button
            variant="outlined"
            onClick={() => navigate(`/performance?retailer=${encodeURIComponent(store.id)}`)}
          >
            Sales
          </Button>
          <Button variant="outlined" onClick={() => setVisitOpen(true)}>
            Visits
          </Button>
          {canEditStores ? (
            <>
              <Button variant="outlined" onClick={() => navigate(`/stores?edit=${encodeURIComponent(store.id)}`)}>
                Edit
              </Button>
              <Button
                variant="outlined"
                onClick={() => void handleResetPassword(store)}
                disabled={resetPasswordMutation.isPending || !store.email}
              >
                Reset password
              </Button>
              <Button
                variant={store.isActive !== false ? 'outlined' : 'contained'}
                color={store.isActive !== false ? 'error' : 'success'}
                onClick={() => void handleToggle(store)}
                disabled={toggleStatusMutation.isPending}
              >
                {store.isActive !== false ? 'Deactivate' : 'Activate'}
              </Button>
            </>
          ) : null}
        </Box>
      </Box>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Wallet
            </Typography>
            <Typography variant="h6">{wallet.isLoading ? '…' : inr(wallet.data?.available ?? 0)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Credit notes
            </Typography>
            <Typography variant="h6">
              {creditQuery.isLoading ? '…' : inr(issuedTotal(creditNotes))}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {creditNotes.filter((note) => note.status !== 'cancelled').length} issued
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Debit notes
            </Typography>
            <Typography variant="h6">
              {debitQuery.isLoading ? '…' : inr(issuedTotal(debitNotes))}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {debitNotes.filter((note) => note.status !== 'cancelled').length} issued
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      <Tabs
        value={tab}
        onChange={(_, value: RetailerTab) => setTab(value)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        variant="scrollable"
      >
        <Tab value="overview" label="Details" />
        <Tab value="wallet" label="Wallet" />
        <Tab value="ledger" label="Ledger" />
        <Tab value="credit" label="Credit notes" />
        <Tab value="debit" label="Debit notes" />
      </Tabs>

      {tab === 'overview' ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Grid container spacing={2}>
            <Field label="Owner" value={store.ownerName || store.displayName} />
            <Field label="Email" value={store.email} />
            <Field label="Phone" value={store.phoneNumber} />
            <Field label="Sales officer" value={store.salesOfficerId ? salesOfficerNameById[store.salesOfficerId] : ''} />
            <Field label="Town" value={store.town} />
            <Field label="District" value={store.district} />
            <Field label="Address" value={store.address} />
            <Field label="Licence number" value={store.licenceNumber} />
            <Field label="Licence holder" value={store.licenceHolderName} />
            <Field label="GSTIN" value={store.gst} />
            <Field label="PAN" value={store.pan} />
            <Field
              label="Location"
              value={
                store.location
                  ? `${store.location.latitude}, ${store.location.longitude}`
                  : ''
              }
            />
          </Grid>
          <Box display="flex" gap={2} flexWrap="wrap" mt={2}>
            {[
              ['Shop', store.shopImage || store.shopImageUrl],
              ['Licence', store.licenceImageUrl],
              ['Aadhar', store.aadharImageUrl],
            ].map(([label, src]) =>
              src ? (
                <Box key={label} sx={{ textAlign: 'center' }}>
                  <img
                    src={src}
                    alt={label}
                    style={{ maxWidth: 160, maxHeight: 120, borderRadius: 8, border: '1px solid #ddd' }}
                  />
                  <Typography variant="caption" display="block">
                    {label}
                  </Typography>
                </Box>
              ) : null
            )}
          </Box>
        </Paper>
      ) : null}

      {tab === 'wallet' ? (
        <RetailerWalletDialog open embedded store={store} onClose={() => undefined} readOnly={!canEditStores} />
      ) : null}

      {tab === 'ledger' ? <StoreLedgerPage lockedRetailerId={store.id} /> : null}

      {tab === 'credit' ? (
        creditQuery.isLoading ? (
          <Loading message="Loading credit notes..." />
        ) : creditQuery.isError ? (
          <Typography color="error">Could not load credit notes.</Typography>
        ) : (
          <NoteTable
            rows={creditNotes.map((note: CreditNote) => ({
              id: note.id,
              number: note.creditNoteNumber,
              date: note.creditNoteDate,
              status: note.status,
              reason: note.reason,
              amount: note.totalAmount,
              orderId: note.orderId,
            }))}
            onOpenOrder={(orderId) => navigate(`/orders/${orderId}`)}
          />
        )
      ) : null}

      {tab === 'debit' ? (
        debitQuery.isLoading ? (
          <Loading message="Loading debit notes..." />
        ) : debitQuery.isError ? (
          <Typography color="error">Could not load debit notes.</Typography>
        ) : (
          <NoteTable
            rows={debitNotes.map((note: DebitNote) => ({
              id: note.id,
              number: note.debitNoteNumber,
              date: note.debitNoteDate,
              status: note.status,
              reason: note.reason,
              amount: note.totalAmount,
              orderId: note.orderId,
            }))}
            onOpenOrder={(orderId) => navigate(`/orders/${orderId}`)}
          />
        )
      ) : null}

      <RetailerVisitLogDialog
        open={visitOpen}
        store={store}
        salesOfficerNameById={salesOfficerNameById}
        onClose={() => setVisitOpen(false)}
      />
    </Box>
  );
};
