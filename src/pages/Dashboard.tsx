import React from 'react';
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
} from '@mui/material';
import {
  ShoppingCart,
  Store,
  Warning,
} from '@mui/icons-material';
import { useOrders } from '../hooks/useOrders';
import { useStores } from '../hooks/useStores';
import { useMedicines, useExpiringMedicines, useExpiredMedicines } from '../hooks/useInventory';
import { format } from 'date-fns';
import { Loading } from '../components/Loading';
import { useNavigate } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: stores, isLoading: storesLoading } = useStores();
  const { data: medicines, isLoading: medicinesLoading } = useMedicines();
  const { data: expiringMedicines } = useExpiringMedicines(30);
  const { data: expiredMedicines } = useExpiredMedicines();
  const navigate = useNavigate();

  if (ordersLoading || storesLoading || medicinesLoading) {
    return <Loading message="Loading dashboard..." />;
  }

  const pendingOrders = orders?.filter(o => o.status === 'Pending').length || 0;
  const inFulfillment = orders?.filter(o => o.status === 'Order Fulfillment').length || 0;
  const inTransit = orders?.filter(o => o.status === 'In Transit').length || 0;
  const totalRevenue = orders?.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (o.totalAmount || 0), 0) || 0;
  const lowStockMedicines = medicines?.filter(m => (m.currentStock || m.stock || 0) < 10 && (m.currentStock || m.stock || 0) > 0).length || 0;

  const recentOrders = orders?.slice(0, 5) || [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending': return 'warning';
      case 'Order Fulfillment': return 'primary';
      case 'In Transit': return 'info';
      case 'Delivered': return 'success';
      case 'Cancelled': return 'error';
      default: return 'default';
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Dashboard Summary
      </Typography>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'rgba(255, 152, 0, 0.05)' }}>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography color="textSecondary" variant="subtitle2" gutterBottom>Pending Orders</Typography>
                  <Typography variant="h4">{pendingOrders}</Typography>
                </Box>
                <ShoppingCart color="warning" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'rgba(33, 150, 243, 0.05)' }}>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography color="textSecondary" variant="subtitle2" gutterBottom>In Fulfillment</Typography>
                  <Typography variant="h4">{inFulfillment}</Typography>
                </Box>
                <ShoppingCart color="primary" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'rgba(76, 175, 80, 0.05)' }}>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography color="textSecondary" variant="subtitle2" gutterBottom>Total Revenue</Typography>
                  <Typography variant="h4">₹{totalRevenue.toLocaleString()}</Typography>
                </Box>
                <Store color="success" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'rgba(244, 67, 54, 0.05)' }}>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography color="textSecondary" variant="subtitle2" gutterBottom>Low Stock</Typography>
                  <Typography variant="h4">{lowStockMedicines}</Typography>
                </Box>
                <Warning color="error" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Orders
              </Typography>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Order ID</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Retailer</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell align="center">Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recentOrders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          <Typography color="textSecondary" sx={{ py: 3 }}>No orders yet</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      recentOrders.map((order) => (
                        <TableRow key={order.id} hover onClick={() => navigate(`/orders/${order.id}`)} sx={{ cursor: 'pointer' }}>
                          <TableCell>#{order.id.substring(0, 8)}</TableCell>
                          <TableCell>
                            {order.orderDate instanceof Date
                              ? format(order.orderDate, 'MMM dd')
                              : format(new Date(order.orderDate), 'MMM dd')}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>{order.retailerEmail}</Typography>
                          </TableCell>
                          <TableCell align="right">₹{order.totalAmount?.toLocaleString()}</TableCell>
                          <TableCell align="center">
                            <Chip
                              label={order.status}
                              color={getStatusColor(order.status) as any}
                              size="small"
                              sx={{ fontWeight: 'bold' }}
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Inventory Alerts</Typography>
              <Box sx={{ mt: 2 }}>
                {expiredMedicines && expiredMedicines.length > 0 && (
                  <Alert severity="error" sx={{ mb: 1 }}>
                    {expiredMedicines.length} Expired Medicines
                  </Alert>
                )}
                {expiringMedicines && expiringMedicines.length > 0 && (
                  <Alert severity="warning" sx={{ mb: 1 }}>
                    {expiringMedicines.length} Expiring within 30 days
                  </Alert>
                )}
                {lowStockMedicines > 0 && (
                  <Alert severity="info" sx={{ mb: 1 }}>
                    {lowStockMedicines} Low Stock Items
                  </Alert>
                )}
                {(!expiredMedicines || expiredMedicines.length === 0) && 
                 (!expiringMedicines || expiringMedicines.length === 0) && 
                 lowStockMedicines === 0 && (
                  <Typography variant="body2" color="textSecondary">
                    All inventory levels look healthy.
                  </Typography>
                )}
              </Box>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>System Overview</Typography>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">Active Stores</Typography>
                  <Typography variant="h6">{stores?.filter(s => s.isActive !== false).length || 0}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">Total Products</Typography>
                  <Typography variant="h6">{medicines?.length || 0}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">Shipped Orders</Typography>
                  <Typography variant="h6">{orders?.filter(o => o.status === 'Delivered').length || 0}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">Transit Orders</Typography>
                  <Typography variant="h6">{inTransit}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};
