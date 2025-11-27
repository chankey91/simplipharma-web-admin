import React, { useState } from 'react';
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
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Grid,
  Card,
  CardContent,
} from '@mui/material';
import {
  Search,
  Visibility,
  LocalShipping,
  CheckCircle,
} from '@mui/icons-material';
import { useOrders, useUpdateOrderDispatch, useMarkOrderDelivered } from '../hooks/useOrders';
import { Order, OrderStatus } from '../types';
import { format } from 'date-fns';
import { auth } from '../services/firebase';
import { Loading } from '../components/Loading';

export const OrdersPage: React.FC = () => {
  const { data: orders, isLoading } = useOrders();
  const updateDispatch = useUpdateOrderDispatch();
  const markDelivered = useMarkOrderDelivered();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'All'>('All');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [openDetails, setOpenDetails] = useState(false);
  const [openDispatch, setOpenDispatch] = useState(false);
  
  // Dispatch form state
  const [dispatchData, setDispatchData] = useState({
    trackingNumber: '',
    courierName: '',
    dispatchNotes: '',
    estimatedDeliveryDate: '',
  });

  const filteredOrders = orders?.filter(order => {
    const matchesSearch = 
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.retailerEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.medicines.some(m => m.name.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesStatus = statusFilter === 'All' || order.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  }) || [];

  const ordersByStatus = {
    Pending: filteredOrders.filter(o => o.status === 'Pending').length,
    Dispatched: filteredOrders.filter(o => o.status === 'Dispatched').length,
    Delivered: filteredOrders.filter(o => o.status === 'Delivered').length,
    Cancelled: filteredOrders.filter(o => o.status === 'Cancelled').length,
  };

  const handleDispatch = async () => {
    if (!selectedOrder) return;
    
    const user = auth.currentUser;
    if (!user) return;

    try {
      await updateDispatch.mutateAsync({
        orderId: selectedOrder.id,
        dispatchData: {
          status: 'Dispatched',
          dispatchDate: new Date(),
          trackingNumber: dispatchData.trackingNumber || undefined,
          courierName: dispatchData.courierName || undefined,
          dispatchNotes: dispatchData.dispatchNotes || undefined,
          dispatchedBy: user.uid,
          estimatedDeliveryDate: dispatchData.estimatedDeliveryDate 
            ? new Date(dispatchData.estimatedDeliveryDate)
            : undefined,
        },
      });

      setOpenDispatch(false);
      setDispatchData({
        trackingNumber: '',
        courierName: '',
        dispatchNotes: '',
        estimatedDeliveryDate: '',
      });
    } catch (error) {
      console.error('Error dispatching order:', error);
    }
  };

  const handleMarkDelivered = async (orderId: string) => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      await markDelivered.mutateAsync({
        orderId,
        deliveredBy: user.uid,
      });
    } catch (error) {
      console.error('Error marking order as delivered:', error);
    }
  };

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case 'Pending':
        return 'warning';
      case 'Dispatched':
        return 'info';
      case 'Delivered':
        return 'success';
      case 'Cancelled':
        return 'error';
      default:
        return 'default';
    }
  };

  if (isLoading) {
    return <Loading message="Loading orders..." />;
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Orders Management</Typography>
      </Box>

      {/* Statistics Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Pending</Typography>
              <Typography variant="h4">{ordersByStatus.Pending}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Dispatched</Typography>
              <Typography variant="h4">{ordersByStatus.Dispatched}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Delivered</Typography>
              <Typography variant="h4">{ordersByStatus.Delivered}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Cancelled</Typography>
              <Typography variant="h4">{ordersByStatus.Cancelled}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Box display="flex" gap={2} mb={2}>
        <TextField
          placeholder="Search orders..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ flexGrow: 1 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search />
              </InputAdornment>
            ),
          }}
        />
        <FormControl sx={{ minWidth: 150 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={statusFilter}
            label="Status"
            onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'All')}
          >
            <MenuItem value="All">All</MenuItem>
            <MenuItem value="Pending">Pending</MenuItem>
            <MenuItem value="Dispatched">Dispatched</MenuItem>
            <MenuItem value="Delivered">Delivered</MenuItem>
            <MenuItem value="Cancelled">Cancelled</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Orders Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Order ID</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Retailer</TableCell>
              <TableCell>Items</TableCell>
              <TableCell>Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="textSecondary">No orders found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>#{order.id.substring(0, 8)}</TableCell>
                  <TableCell>
                    {order.orderDate instanceof Date
                      ? format(order.orderDate, 'MMM dd, yyyy')
                      : format(new Date(order.orderDate), 'MMM dd, yyyy')}
                  </TableCell>
                  <TableCell>{order.retailerEmail || 'N/A'}</TableCell>
                  <TableCell>{order.medicines.length} items</TableCell>
                  <TableCell>₹{order.totalAmount.toFixed(2)}</TableCell>
                  <TableCell>
                    <Chip
                      label={order.status}
                      color={getStatusColor(order.status) as any}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setSelectedOrder(order);
                        setOpenDetails(true);
                      }}
                    >
                      <Visibility />
                    </IconButton>
                    {order.status === 'Pending' && (
                      <IconButton
                        size="small"
                        onClick={() => {
                          setSelectedOrder(order);
                          setOpenDispatch(true);
                        }}
                      >
                        <LocalShipping />
                      </IconButton>
                    )}
                    {order.status === 'Dispatched' && (
                      <IconButton
                        size="small"
                        onClick={() => handleMarkDelivered(order.id)}
                      >
                        <CheckCircle />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Order Details Dialog */}
      <Dialog open={openDetails} onClose={() => setOpenDetails(false)} maxWidth="md" fullWidth>
        <DialogTitle>Order Details</DialogTitle>
        <DialogContent>
          {selectedOrder && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Order #{selectedOrder.id.substring(0, 8)}
              </Typography>
              <Typography>Retailer: {selectedOrder.retailerEmail}</Typography>
              <Typography>
                Date:{' '}
                {selectedOrder.orderDate instanceof Date
                  ? format(selectedOrder.orderDate, 'PPpp')
                  : format(new Date(selectedOrder.orderDate), 'PPpp')}
              </Typography>
              <Typography>Status: {selectedOrder.status}</Typography>
              <Typography>Delivery Address: {selectedOrder.deliveryAddress || 'N/A'}</Typography>
              
              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                Items:
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Medicine</TableCell>
                    <TableCell>Quantity</TableCell>
                    <TableCell>Price</TableCell>
                    <TableCell>Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selectedOrder.medicines.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell>{item.name}</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>₹{item.price.toFixed(2)}</TableCell>
                      <TableCell>₹{(item.price * item.quantity).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Typography variant="h6" sx={{ mt: 2, textAlign: 'right' }}>
                Total: ₹{selectedOrder.totalAmount.toFixed(2)}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDetails(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Dispatch Dialog */}
      <Dialog open={openDispatch} onClose={() => setOpenDispatch(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Dispatch Order</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Tracking Number"
              value={dispatchData.trackingNumber}
              onChange={(e) =>
                setDispatchData({ ...dispatchData, trackingNumber: e.target.value })
              }
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Courier Name"
              value={dispatchData.courierName}
              onChange={(e) =>
                setDispatchData({ ...dispatchData, courierName: e.target.value })
              }
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Estimated Delivery Date"
              type="date"
              value={dispatchData.estimatedDeliveryDate}
              onChange={(e) =>
                setDispatchData({ ...dispatchData, estimatedDeliveryDate: e.target.value })
              }
              InputLabelProps={{ shrink: true }}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Dispatch Notes"
              multiline
              rows={3}
              value={dispatchData.dispatchNotes}
              onChange={(e) =>
                setDispatchData({ ...dispatchData, dispatchNotes: e.target.value })
              }
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDispatch(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleDispatch}
            disabled={updateDispatch.isPending}
          >
            Dispatch Order
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
