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
} from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import { useOrders } from '../hooks/useOrders';
import { useStores } from '../hooks/useStores';
import { useMedicines, useExpiringMedicines, useExpiredMedicines } from '../hooks/useInventory';
import { usePendingRetailerRequests } from '../hooks/usePendingRetailers';
import { format, startOfMonth, isBefore } from 'date-fns';
import { Loading } from '../components/Loading';
import { useNavigate } from 'react-router-dom';
import type { Order } from '../types';

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
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: stores, isLoading: storesLoading } = useStores();
  const { data: medicines, isLoading: medicinesLoading } = useMedicines();
  const { data: expiringMedicines } = useExpiringMedicines(30);
  const { data: expiredMedicines } = useExpiredMedicines();
  const { data: pendingRetailerRequests } = usePendingRetailerRequests();

  const stats = useMemo(() => {
    const list = orders ?? [];
    const pending = list.filter((o) => o.status === 'Pending').length;
    const inFulfillment = list.filter((o) => o.status === 'Order Fulfillment').length;
    const inTransit = list.filter((o) => o.status === 'In Transit').length;
    const delivered = list.filter((o) => o.status === 'Delivered').length;
    const cancelled = list.filter((o) => o.status === 'Cancelled').length;

    const activeOrders = list.filter((o) => o.status !== 'Cancelled');
    const lifetimeGross = activeOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    const monthStart = startOfMonth(new Date());
    const thisMonthGross = activeOrders
      .filter((o) => {
        const d = o.orderDate instanceof Date ? o.orderDate : new Date(o.orderDate);
        if (isNaN(d.getTime())) return false;
        return !isBefore(d, monthStart);
      })
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    const unpaid = list.filter(
      (o) => o.status !== 'Cancelled' && (o.paymentStatus === 'Unpaid' || !o.paymentStatus)
    ).length;

    const lowStock =
      medicines?.filter((m) => {
        const q = m.currentStock ?? m.stock ?? 0;
        return q > 0 && q < 10;
      }).length ?? 0;

    const activeStores = stores?.filter((s) => s.isActive !== false).length ?? 0;

    const recent: Order[] = [...list]
      .sort((a, b) => {
        const da = a.orderDate instanceof Date ? a.orderDate : new Date(a.orderDate);
        const db = b.orderDate instanceof Date ? b.orderDate : new Date(b.orderDate);
        return db.getTime() - da.getTime();
      })
      .slice(0, 6);

    const pendingRetailers = pendingRetailerRequests?.length ?? 0;

    return {
      pending,
      inFulfillment,
      inTransit,
      delivered,
      cancelled,
      lifetimeGross,
      thisMonthGross,
      unpaid,
      lowStock,
      activeStores,
      productCount: medicines?.length ?? 0,
      recent,
      pendingRetailers,
    };
  }, [orders, medicines, stores, pendingRetailerRequests]);

  if (ordersLoading || storesLoading || medicinesLoading) {
    return <Loading message="Loading dashboard..." />;
  }

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
          Dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {format(new Date(), 'EEEE, MMMM d, yyyy')} — Orders, inventory, and quick actions at a glance.
        </Typography>
      </Box>

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
        <Button variant="outlined" startIcon={<PointOfSale />} onClick={() => navigate('/stores')}>
          Stores
        </Button>
        <Button variant="outlined" startIcon={<SettingsSuggest />} onClick={() => navigate('/operations')}>
          Operations
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

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <StatCard
            title="Gross order value"
            value={`₹${Math.round(stats.lifetimeGross).toLocaleString('en-IN')}`}
            caption="All non-cancelled orders (lifetime)"
            accent={accent.success}
            icon={<TrendingUp sx={{ fontSize: 36 }} />}
            onClick={() => navigate('/orders')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <StatCard
            title="This month"
            value={`₹${Math.round(stats.thisMonthGross).toLocaleString('en-IN')}`}
            caption="Non-cancelled orders placed this month"
            accent={theme.palette.secondary.main}
            icon={<TrendingUp sx={{ fontSize: 36 }} />}
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
                      <TableCell>Order</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Retailer</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell align="center">Status</TableCell>
                      <TableCell align="center">Payment</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {stats.recent.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          <Typography color="text.secondary" sx={{ py: 4 }}>
                            No orders yet. New orders will appear here.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      stats.recent.map((order) => {
                        const od = order.orderDate instanceof Date ? order.orderDate : new Date(order.orderDate);
                        return (
                          <TableRow
                            key={order.id}
                            hover
                            onClick={() => navigate(`/orders/${order.id}`)}
                            sx={{ cursor: 'pointer' }}
                          >
                            <TableCell sx={{ fontWeight: 600 }}>#{order.id.substring(0, 8)}</TableCell>
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
                {stats.pendingRetailers > 0 && (
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
                {stats.pendingRetailers === 0 &&
                  (!expiredMedicines || expiredMedicines.length === 0) &&
                  (!expiringMedicines || expiringMedicines.length === 0) &&
                  stats.lowStock === 0 && (
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
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Active stores
                    </Typography>
                    <Typography variant="h5" fontWeight={700}>
                      {stats.activeStores}
                    </Typography>
                  </Grid>
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
                </Grid>
              </Paper>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Store />}
                onClick={() => navigate('/stores')}
                sx={{ mt: 2 }}
              >
                Manage stores
              </Button>
              <Button
                fullWidth
                variant="text"
                startIcon={<CheckCircle />}
                onClick={() => navigate('/expiry-returns')}
                sx={{ mt: 0.5 }}
              >
                Expiry returns
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};
