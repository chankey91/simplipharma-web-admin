import React, { useMemo } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Alert,
  Button,
  Stack,
  Link,
} from '@mui/material';
import {
  ShoppingCart,
  Store,
  Warning,
  LocalShipping,
  CheckCircle,
  Inventory2,
  TrendingUp,
  ChevronRight,
  SettingsSuggest,
  PointOfSale,
  AccountBalanceWalletOutlined,
  Receipt,
  Archive,
  PostAdd,
  Article,
} from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import { useOrderDashboardStats, useRecentOrders } from '../hooks/useOrders';
import { useStores } from '../hooks/useStores';
import { useMedicinesMaster } from '../hooks/useInventory';
import { filterExpiringMedicines, filterExpiredMedicines } from '../services/inventory';
import { usePendingRetailerRequests } from '../hooks/usePendingRetailers';
import { useCreditNoteTotals, useDebitNoteTotals } from '../hooks/useCreditNotes';
import { useExpiryReturns } from '../hooks/useExpiryReturns';
import { sumExpiryRefundsInPeriod } from '../utils/returnMargin';
import { format, startOfMonth } from 'date-fns';
import { formatDateLongIST } from '../utils/dateTime';
import { Loading } from '../components/Loading';
import { useNavigate } from 'react-router-dom';
import type { Order } from '../types';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { formatOrderNumberForDisplay } from '../utils/orderDisplay';
import { useAuth } from '../context/AuthContext';

const formatInr = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Pending':
      return 'warning';
    case 'Order Fulfillment':
      return 'primary';
    case 'In Transit':
      return 'info';
    case 'Delivered':
      return 'success';
    case 'Cancelled':
      return 'error';
    default:
      return 'default';
  }
};

type StatCardProps = {
  title: string;
  value: string | number;
  caption?: string;
  icon: React.ReactNode;
  accent: string;
  onClick?: () => void;
};

const StatCard: React.FC<StatCardProps> = ({ title, value, caption, icon, accent, onClick }) => {
  const theme = useTheme();
  return (
    <Card
      elevation={0}
      onClick={onClick}
      sx={{
        height: '100%',
        border: 1,
        borderColor: 'divider',
        borderLeft: 4,
        borderLeftColor: accent,
        borderRadius: 2,
        transition: 'box-shadow 0.2s, transform 0.15s',
        bgcolor: alpha(accent, 0.04),
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick
          ? {
              boxShadow: theme.shadows[4],
              transform: 'translateY(-2px)',
            }
          : undefined,
      }}
    >
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography color="text.secondary" variant="body2" fontWeight={500} gutterBottom>
              {title}
            </Typography>
            <Typography variant="h4" component="p" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {value}
            </Typography>
            {caption ? (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                {caption}
              </Typography>
            ) : null}
          </Box>
          <Box
            sx={{
              color: accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              opacity: 0.9,
            }}
          >
            {icon}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

export const DashboardPage: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { panelRole } = useAuth();
  const isOperations = panelRole === 'operations';
  // Stable month-start (epoch ms) for the current session, used as the
  // aggregation query key so order/notes totals are computed server-side
  // instead of downloading entire collections.
  const monthStartMs = useMemo(() => startOfMonth(new Date()).getTime(), []);
  const {
    data: orderStats,
    isLoading: ordersLoading,
    isError: ordersError,
    error: ordersQueryError,
    refetch: refetchOrderStats,
  } = useOrderDashboardStats(monthStartMs);
  const { data: recentOrders, isError: recentOrdersError } = useRecentOrders(6);
  const {
    data: stores,
    isLoading: storesLoading,
    isError: storesError,
    refetch: refetchStores,
  } = useStores(!isOperations);
  const {
    data: medicines,
    isLoading: medicinesLoading,
    isError: medicinesError,
    refetch: refetchMedicines,
  } = useMedicinesMaster();
  // Derive expiry buckets from master list (nearestExpiry) — no second full catalog read.
  const expiringMedicines = useMemo(
    () => (medicines ? filterExpiringMedicines(medicines, 30) : undefined),
    [medicines]
  );
  const expiredMedicines = useMemo(
    () => (medicines ? filterExpiredMedicines(medicines) : undefined),
    [medicines]
  );
  const { data: pendingRetailerRequests } = usePendingRetailerRequests(!isOperations);
  const {
    data: creditTotals,
    isLoading: creditLoading,
    isError: creditError,
    refetch: refetchCreditTotals,
  } = useCreditNoteTotals(monthStartMs);
  const {
    data: debitTotals,
    isLoading: debitLoading,
    isError: debitError,
    refetch: refetchDebitTotals,
  } = useDebitNoteTotals(monthStartMs);
  const {
    data: expiryReturns,
    isLoading: expiryReturnsLoading,
    isError: expiryReturnsError,
    refetch: refetchExpiryReturns,
  } = useExpiryReturns();

  const stats = useMemo(() => {
    const statusCounts = orderStats?.statusCounts;
    const pending = statusCounts?.['Pending'] ?? 0;
    const inFulfillment = statusCounts?.['Order Fulfillment'] ?? 0;
    const inTransit = statusCounts?.['In Transit'] ?? 0;
    const delivered = statusCounts?.['Delivered'] ?? 0;
    const cancelled = statusCounts?.['Cancelled'] ?? 0;

    const lifetimeGross = orderStats?.lifetimeGross ?? 0;
    const thisMonthGross = orderStats?.thisMonthGross ?? 0;
    const unpaid = orderStats?.unpaidCount ?? 0;

    const lowStock =
      medicines?.filter((m) => {
        const q = m.currentStock ?? m.stock ?? 0;
        return q > 0 && q < 10;
      }).length ?? 0;

    const activeStores = stores?.filter((s) => s.isActive !== false).length ?? 0;

    const recent: Order[] = recentOrders ?? [];

    const pendingRetailers = pendingRetailerRequests?.length ?? 0;

    const lifetimeCredits = creditTotals?.lifetimeSum ?? 0;
    const lifetimeDebits = debitTotals?.lifetimeSum ?? 0;
    const thisMonthCredits = creditTotals?.thisMonthSum ?? 0;
    const thisMonthDebits = debitTotals?.thisMonthSum ?? 0;
    const thisMonthCreditCount = creditTotals?.thisMonthCount ?? 0;

    const thisMonthExpiryRefunds = sumExpiryRefundsInPeriod(expiryReturns, 'this_month');
    const lifetimeExpiryRefunds = sumExpiryRefundsInPeriod(expiryReturns, 'all');

    return {
      pending,
      inFulfillment,
      inTransit,
      delivered,
      cancelled,
      lifetimeGross,
      thisMonthGross,
      lifetimeCredits,
      lifetimeDebits,
      thisMonthCredits,
      thisMonthDebits,
      thisMonthExpiryRefunds,
      lifetimeExpiryRefunds,
      netLifetime: lifetimeGross - lifetimeCredits - lifetimeExpiryRefunds + lifetimeDebits,
      netThisMonth:
        thisMonthGross - thisMonthCredits - thisMonthExpiryRefunds + thisMonthDebits,
      creditNoteCount: creditTotals?.lifetimeCount ?? 0,
      debitNoteCount: debitTotals?.lifetimeCount ?? 0,
      thisMonthCreditCount,
      unpaid,
      lowStock,
      activeStores,
      productCount: medicines?.length ?? 0,
      recent,
      pendingRetailers,
    };
  }, [orderStats, recentOrders, medicines, stores, pendingRetailerRequests, creditTotals, debitTotals, expiryReturns]);

  const { sortKey, sortDirection, requestSort } = useTableSort('orderDate', 'desc');
  const sortedRecentOrders = useMemo(() => {
    const list = [...stats.recent];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'id':
          return applyDirection(compareAsc(a.id, b.id), sortDirection);
        case 'orderDate':
          return applyDirection(compareAsc(toTimeMs(a.orderDate), toTimeMs(b.orderDate)), sortDirection);
        case 'retailer':
          return applyDirection(
            compareAsc(
              `${a.retailerEmail || a.retailerName || ''}`.toLowerCase(),
              `${b.retailerEmail || b.retailerName || ''}`.toLowerCase()
            ),
            sortDirection
          );
        case 'amount':
          return applyDirection(compareAsc(a.totalAmount ?? 0, b.totalAmount ?? 0), sortDirection);
        case 'status':
          return applyDirection(compareAsc(a.status, b.status), sortDirection);
        case 'payment':
          return applyDirection(
            compareAsc(a.paymentStatus || '', b.paymentStatus || ''),
            sortDirection
          );
        default:
          return applyDirection(compareAsc(toTimeMs(a.orderDate), toTimeMs(b.orderDate)), 'desc');
      }
    });
    return list;
  }, [stats.recent, sortKey, sortDirection]);

  if (
    ordersLoading ||
    creditLoading ||
    debitLoading ||
    expiryReturnsLoading ||
    (!isOperations && storesLoading) ||
    medicinesLoading
  ) {
    return <Loading message="Loading dashboard..." />;
  }

  const dataLoadErrors = [
    ordersError && 'order statistics',
    creditError && 'credit note totals',
    debitError && 'debit note totals',
    expiryReturnsError && 'expiry returns',
    medicinesError && 'inventory',
    !isOperations && storesError && 'stores',
    recentOrdersError && 'recent orders',
  ].filter(Boolean) as string[];

  const handleRetryDashboard = () => {
    void refetchOrderStats();
    void refetchCreditTotals();
    void refetchDebitTotals();
    void refetchExpiryReturns();
    void refetchMedicines();
    if (!isOperations) void refetchStores();
  };

  const accent = {
    warning: theme.palette.warning.main,
    primary: theme.palette.primary.main,
    info: theme.palette.info.main,
    success: theme.palette.success.main,
    error: theme.palette.error.main,
  };

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
          {isOperations ? 'Operations dashboard' : 'Dashboard'}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {formatDateLongIST()} —{' '}
          {isOperations
            ? 'Fulfillment, inventory, and daily operations at a glance.'
            : 'Orders, inventory, and quick actions at a glance.'}
        </Typography>
      </Box>

      {dataLoadErrors.length > 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={handleRetryDashboard}>
              Retry
            </Button>
          }
        >
          Some dashboard data could not be loaded ({dataLoadErrors.join(', ')}).
          {ordersQueryError instanceof Error ? ` ${ordersQueryError.message}` : ''} Values may
          show as zero until the request succeeds.
        </Alert>
      )}

      <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 3 }}>
        <Button
          variant="contained"
          size="medium"
          startIcon={<ShoppingCart />}
          onClick={() => navigate('/orders')}
        >
          All orders
        </Button>
        <Button variant="outlined" startIcon={<Inventory2 />} onClick={() => navigate('/inventory')}>
          Inventory
        </Button>
        {isOperations ? (
          <>
            <Button variant="outlined" startIcon={<Receipt />} onClick={() => navigate('/purchases')}>
              Purchases
            </Button>
            <Button variant="outlined" startIcon={<Archive />} onClick={() => navigate('/expiry-returns')}>
              Expiry returns
            </Button>
          </>
        ) : (
          <Button variant="outlined" startIcon={<PointOfSale />} onClick={() => navigate('/stores')}>
            Stores
          </Button>
        )}
        <Button variant="outlined" startIcon={<Article />} onClick={() => navigate('/credit-notes')}>
          Credit & debit notes
        </Button>
        <Button variant="outlined" startIcon={<SettingsSuggest />} onClick={() => navigate('/operations')}>
          Fulfillment setup
        </Button>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Pending"
            value={stats.pending}
            caption="Needs processing"
            accent={accent.warning}
            icon={<ShoppingCart sx={{ fontSize: 40 }} />}
            onClick={() => navigate('/orders')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="In fulfillment"
            value={stats.inFulfillment}
            caption="Pick & pack"
            accent={accent.primary}
            icon={<Inventory2 sx={{ fontSize: 40 }} />}
            onClick={() => navigate('/orders')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="In transit"
            value={stats.inTransit}
            caption="Dispatched"
            accent={accent.info}
            icon={<LocalShipping sx={{ fontSize: 40 }} />}
            onClick={() => navigate('/orders')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Low stock"
            value={stats.lowStock}
            caption="Under 10 units (in stock)"
            accent={accent.error}
            icon={<Warning sx={{ fontSize: 40 }} />}
            onClick={() => navigate('/inventory?stockFilter=Low')}
          />
        </Grid>
      </Grid>

      {!isOperations && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} md={4}>
            <StatCard
              title="Net sales value"
              value={formatInr(stats.netLifetime)}
              caption={`Orders ${formatInr(stats.lifetimeGross)} − credits ${formatInr(stats.lifetimeCredits)} + debits ${formatInr(stats.lifetimeDebits)}`}
              accent={accent.success}
              icon={<TrendingUp sx={{ fontSize: 36 }} />}
              onClick={() => navigate('/credit-notes')}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <StatCard
              title="This month (net)"
              value={formatInr(stats.netThisMonth)}
              caption={`Orders ${formatInr(stats.thisMonthGross)} − credits ${formatInr(stats.thisMonthCredits)} − expiry ${formatInr(stats.thisMonthExpiryRefunds)} + debits ${formatInr(stats.thisMonthDebits)}`}
              accent={theme.palette.secondary.main}
              icon={<TrendingUp sx={{ fontSize: 36 }} />}
              onClick={() => navigate('/credit-notes')}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <StatCard
              title="Attention"
              value={stats.unpaid}
              caption="Active orders marked unpaid"
              accent={stats.unpaid > 0 ? accent.warning : theme.palette.grey[500]}
              icon={<AccountBalanceWalletOutlined sx={{ fontSize: 36 }} />}
              onClick={() => navigate('/orders')}
            />
          </Grid>
        </Grid>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <Card elevation={0} sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
                <Typography variant="h6" fontWeight={600}>
                  Recent orders
                </Typography>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  onClick={() => navigate('/orders')}
                  sx={{ display: 'inline-flex', alignItems: 'center', fontWeight: 600 }}
                >
                  View all
                  <ChevronRight sx={{ fontSize: 18 }} />
                </Link>
              </Stack>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <SortableTableHeadCell columnId="id" label="Order" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                      <SortableTableHeadCell columnId="orderDate" label="Date" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                      <SortableTableHeadCell columnId="retailer" label="Retailer" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                      <SortableTableHeadCell columnId="amount" label="Amount" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} align="right" />
                      <SortableTableHeadCell columnId="status" label="Status" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} align="center" />
                      <SortableTableHeadCell columnId="payment" label="Payment" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} align="center" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sortedRecentOrders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          <Typography color="text.secondary" sx={{ py: 4 }}>
                            No orders yet. New orders will appear here.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedRecentOrders.map((order) => {
                        const od = order.orderDate instanceof Date ? order.orderDate : new Date(order.orderDate);
                        return (
                          <TableRow
                            key={order.id}
                            hover
                            onClick={() => navigate(`/orders/${order.id}`)}
                            sx={{ cursor: 'pointer' }}
                          >
                            <TableCell sx={{ fontWeight: 600 }}>#{formatOrderNumberForDisplay(order.id)}</TableCell>
                            <TableCell>{!isNaN(od.getTime()) ? format(od, 'MMM d, yyyy') : '—'}</TableCell>
                            <TableCell>
                              <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
                                {order.retailerEmail || order.retailerName || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">₹{(order.totalAmount ?? 0).toLocaleString('en-IN')}</TableCell>
                            <TableCell align="center">
                              <Chip
                                label={order.status}
                                color={getStatusColor(order.status) as any}
                                size="small"
                                sx={{ fontWeight: 600 }}
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Chip
                                label={order.paymentStatus || 'Unpaid'}
                                size="small"
                                variant="outlined"
                                color={
                                  order.paymentStatus === 'Paid'
                                    ? 'success'
                                    : order.paymentStatus === 'Partial'
                                      ? 'warning'
                                      : 'default'
                                }
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Card elevation={0} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, mb: 2 }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Alerts
              </Typography>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {!isOperations && stats.pendingRetailers > 0 && (
                  <Alert
                    severity="info"
                    onClick={() => navigate('/pending-retailers')}
                    sx={{ cursor: 'pointer', alignItems: 'center' }}
                  >
                    {stats.pendingRetailers} retailer registration{stats.pendingRetailers !== 1 ? 's' : ''}{' '}
                    awaiting review
                  </Alert>
                )}
                {expiredMedicines && expiredMedicines.length > 0 && (
                  <Alert
                    severity="error"
                    onClick={() => navigate('/inventory')}
                    sx={{ cursor: 'pointer' }}
                  >
                    {expiredMedicines.length} batch{expiredMedicines.length !== 1 ? 'es' : ''} with expired stock
                  </Alert>
                )}
                {expiringMedicines && expiringMedicines.length > 0 && (
                  <Alert
                    severity="warning"
                    onClick={() => navigate('/inventory')}
                    sx={{ cursor: 'pointer' }}
                  >
                    {expiringMedicines.length} medicine{expiringMedicines.length !== 1 ? 's' : ''} expiring within 30
                    days
                  </Alert>
                )}
                {stats.lowStock > 0 && (
                  <Alert
                    severity="info"
                    onClick={() => navigate('/inventory?stockFilter=Low')}
                    sx={{ cursor: 'pointer' }}
                  >
                    {stats.lowStock} product{stats.lowStock !== 1 ? 's' : ''} under 10 units
                  </Alert>
                )}
                {stats.thisMonthCreditCount > 0 && (
                  <Alert
                    severity="info"
                    onClick={() => navigate('/credit-notes')}
                    sx={{ cursor: 'pointer' }}
                  >
                    {stats.thisMonthCreditCount} credit note{stats.thisMonthCreditCount !== 1 ? 's' : ''} this month (
                    {formatInr(stats.thisMonthCredits)})
                  </Alert>
                )}
                {(isOperations || stats.pendingRetailers === 0) &&
                  (!expiredMedicines || expiredMedicines.length === 0) &&
                  (!expiringMedicines || expiringMedicines.length === 0) &&
                  stats.lowStock === 0 &&
                  stats.thisMonthCreditCount === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      No active alerts. Inventory and registrations look clear.
                    </Typography>
                  )}
              </Stack>
            </CardContent>
          </Card>

          <Card elevation={0} sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                At a glance
              </Typography>
              <Paper variant="outlined" sx={{ p: 2, mt: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Grid container spacing={2}>
                  {!isOperations && (
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Active stores
                      </Typography>
                      <Typography variant="h5" fontWeight={700}>
                        {stats.activeStores}
                      </Typography>
                    </Grid>
                  )}
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Products
                    </Typography>
                    <Typography variant="h5" fontWeight={700}>
                      {stats.productCount}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Delivered (all time)
                    </Typography>
                    <Typography variant="h5" fontWeight={700}>
                      {stats.delivered}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Cancelled (all time)
                    </Typography>
                    <Typography variant="h5" fontWeight={700} color="text.secondary">
                      {stats.cancelled}
                    </Typography>
                  </Grid>
                  <Grid
                    item
                    xs={6}
                    onClick={() => navigate('/credit-notes')}
                    sx={{ cursor: 'pointer' }}
                  >
                    <Typography variant="caption" color="text.secondary" display="block">
                      Credit notes
                    </Typography>
                    <Typography variant="h5" fontWeight={700}>
                      {stats.creditNoteCount}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatInr(stats.lifetimeCredits)} total
                    </Typography>
                  </Grid>
                  <Grid
                    item
                    xs={6}
                    onClick={() => navigate('/credit-notes')}
                    sx={{ cursor: 'pointer' }}
                  >
                    <Typography variant="caption" color="text.secondary" display="block">
                      Debit notes
                    </Typography>
                    <Typography variant="h5" fontWeight={700}>
                      {stats.debitNoteCount}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatInr(stats.lifetimeDebits)} total
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
              {!isOperations && (
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<Store />}
                  onClick={() => navigate('/stores')}
                  sx={{ mt: 2 }}
                >
                  Manage stores
                </Button>
              )}
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Article />}
                onClick={() => navigate('/credit-notes')}
                sx={{ mt: 2 }}
              >
                Credit & debit notes
              </Button>
              <Button
                fullWidth
                variant={isOperations ? 'outlined' : 'text'}
                startIcon={<CheckCircle />}
                onClick={() => navigate('/expiry-returns')}
                sx={{ mt: 0.5 }}
              >
                Expiry returns
              </Button>
              {isOperations && (
                <Button
                  fullWidth
                  variant="text"
                  startIcon={<PostAdd />}
                  onClick={() => navigate('/product-demands')}
                  sx={{ mt: 0.5 }}
                >
                  Product demands
                </Button>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};
