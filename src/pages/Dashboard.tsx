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
} from '@mui/material';
import {
  ShoppingCart,
  Store,
  Inventory,
  Warning,
} from '@mui/icons-material';
import { useOrders } from '../hooks/useOrders';
import { useStores } from '../hooks/useStores';
import { useMedicines, useExpiringMedicines, useExpiredMedicines } from '../hooks/useInventory';
import { format } from 'date-fns';
import { Loading } from '../components/Loading';

export const DashboardPage: React.FC = () => {
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: stores, isLoading: storesLoading } = useStores();
  const { data: medicines, isLoading: medicinesLoading } = useMedicines();
  const { data: expiringMedicines } = useExpiringMedicines(30);
  const { data: expiredMedicines } = useExpiredMedicines();

  if (ordersLoading || storesLoading || medicinesLoading) {
    return <Loading message="Loading dashboard..." />;
  }

  const pendingOrders = orders?.filter(o => o.status === 'Pending').length || 0;
  const dispatchedOrders = orders?.filter(o => o.status === 'Dispatched').length || 0;
  const totalRevenue = orders?.reduce((sum, o) => sum + o.totalAmount, 0) || 0;
  const lowStockMedicines = medicines?.filter(m => (m.currentStock || m.stock || 0) < 10).length || 0;

  const recentOrders = orders?.slice(0, 5) || [];

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Pending Orders
                  </Typography>
                  <Typography variant="h4">{pendingOrders}</Typography>
                </Box>
                <ShoppingCart color="warning" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Dispatched
                  </Typography>
                  <Typography variant="h4">{dispatchedOrders}</Typography>
                </Box>
                <ShoppingCart color="info" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Total Revenue
                  </Typography>
                  <Typography variant="h4">₹{totalRevenue.toFixed(2)}</Typography>
                </Box>
                <Store color="success" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Low Stock
                  </Typography>
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
                      <TableCell>Amount</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recentOrders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          <Typography color="textSecondary">No orders yet</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      recentOrders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell>#{order.id.substring(0, 8)}</TableCell>
                          <TableCell>
                            {order.orderDate instanceof Date
                              ? format(order.orderDate, 'MMM dd, yyyy')
                              : format(new Date(order.orderDate), 'MMM dd, yyyy')}
                          </TableCell>
                          <TableCell>{order.retailerEmail || 'N/A'}</TableCell>
                          <TableCell>₹{order.totalAmount.toFixed(2)}</TableCell>
                          <TableCell>
                            <Chip
                              label={order.status}
                              color={
                                order.status === 'Pending'
                                  ? 'warning'
                                  : order.status === 'Dispatched'
                                  ? 'info'
                                  : order.status === 'Delivered'
                                  ? 'success'
                                  : 'error'
                              }
                              size="small"
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
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Alerts
              </Typography>
              {expiredMedicines && expiredMedicines.length > 0 && (
                <Chip
                  label={`${expiredMedicines.length} Expired Medicines`}
                  color="error"
                  sx={{ mb: 1, display: 'block' }}
                />
              )}
              {expiringMedicines && expiringMedicines.length > 0 && (
                <Chip
                  label={`${expiringMedicines.length} Expiring Soon`}
                  color="warning"
                  sx={{ mb: 1, display: 'block' }}
                />
              )}
              {lowStockMedicines > 0 && (
                <Chip
                  label={`${lowStockMedicines} Low Stock Items`}
                  color="warning"
                />
              )}
              {(!expiredMedicines || expiredMedicines.length === 0) && 
               (!expiringMedicines || expiringMedicines.length === 0) && 
               lowStockMedicines === 0 && (
                <Typography variant="body2" color="textSecondary">
                  No alerts
                </Typography>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Statistics
              </Typography>
              <Typography variant="body2">
                Total Stores: {stores?.length || 0}
              </Typography>
              <Typography variant="body2">
                Total Medicines: {medicines?.length || 0}
              </Typography>
              <Typography variant="body2">
                Total Orders: {orders?.length || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};
