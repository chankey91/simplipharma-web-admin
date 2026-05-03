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
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Grid,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Pagination,
} from '@mui/material';
import {
  Search,
  Visibility,
  Cancel,
  Download,
} from '@mui/icons-material';
import { useOrders, useCancelOrder } from '../hooks/useOrders';
import { useStores } from '../hooks/useStores';
import { Order, OrderStatus } from '../types';
import { format } from 'date-fns';
import { auth } from '../services/firebase';
import { Loading } from '../components/Loading';
import { useNavigate } from 'react-router-dom';
import { exportPendingOrdersByStore } from '../utils/export';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';

export const OrdersPage: React.FC = () => {
  const { data: orders, isLoading } = useOrders();
  const { data: stores } = useStores();
  const cancelOrderMutation = useCancelOrder();
  const navigate = useNavigate();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'All'>('All');
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const [isExporting, setIsExporting] = useState(false);
  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; orderId: string; reason: string }>({
    open: false,
    orderId: '',
    reason: ''
  });

  const { sortKey, sortDirection, requestSort } = useTableSort('orderDate', 'desc');

  const filteredOrders = orders?.filter(order => {
    const matchesSearch = 
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.retailerEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.medicines.some(m => m.name.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesStatus = statusFilter === 'All' || order.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  }) || [];

  const sortedOrders = useMemo(() => {
    const list = [...filteredOrders];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'id':
          return applyDirection(compareAsc(a.id, b.id), sortDirection);
        case 'orderDate':
          return applyDirection(compareAsc(toTimeMs(a.orderDate), toTimeMs(b.orderDate)), sortDirection);
        case 'retailer':
          return applyDirection(
            compareAsc((a.retailerEmail || '').toLowerCase(), (b.retailerEmail || '').toLowerCase()),
            sortDirection
          );
        case 'items':
          return applyDirection(compareAsc(a.medicines.length, b.medicines.length), sortDirection);
        case 'amount': {
          const va = a.status === 'Pending' ? 0 : a.totalAmount;
          const vb = b.status === 'Pending' ? 0 : b.totalAmount;
          return applyDirection(compareAsc(va, vb), sortDirection);
        }
        case 'status':
          return applyDirection(compareAsc(a.status, b.status), sortDirection);
        default:
          return applyDirection(compareAsc(toTimeMs(a.orderDate), toTimeMs(b.orderDate)), 'desc');
      }
    });
    return list;
  }, [filteredOrders, sortKey, sortDirection]);

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  // Pagination
  const totalPages = Math.ceil(sortedOrders.length / rowsPerPage);
  const paginatedOrders = sortedOrders.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const handlePageChange = (event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const ordersByStatus = {
    Pending: orders?.filter(o => o.status === 'Pending').length || 0,
    Fulfillment: orders?.filter(o => o.status === 'Order Fulfillment').length || 0,
    Transit: orders?.filter(o => o.status === 'In Transit').length || 0,
    Delivered: orders?.filter(o => o.status === 'Delivered').length || 0,
    Cancelled: orders?.filter(o => o.status === 'Cancelled').length || 0,
  };

  const handleCancelOrder = async () => {
    const user = auth.currentUser;
    if (!user || !cancelDialog.orderId) return;

    try {
      await cancelOrderMutation.mutateAsync({
        orderId: cancelDialog.orderId,
        cancelledBy: user.uid,
        reason: cancelDialog.reason
      });
      setCancelDialog({ open: false, orderId: '', reason: '' });
    } catch (error) {
      console.error('Error cancelling order:', error);
    }
  };

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case 'Pending': return 'warning';
      case 'Order Fulfillment': return 'primary';
      case 'In Transit': return 'info';
      case 'Delivered': return 'success';
      case 'Cancelled': return 'error';
      default: return 'default';
    }
  };

  const handleExportPendingOrders = async () => {
    const pendingOrders = orders?.filter(o => o.status === 'Pending') || [];
    
    if (pendingOrders.length === 0) {
      alert('No pending orders to export');
      return;
    }

    setIsExporting(true);
    try {
      await exportPendingOrdersByStore(pendingOrders, stores || []);
      alert('Excel file generated successfully!');
    } catch (error: any) {
      console.error('Error exporting orders:', error);
      alert(`Failed to export: ${error.message || 'Unknown error'}`);
    } finally {
      setIsExporting(false);
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
        {[
          { label: 'Pending', count: ordersByStatus.Pending, color: 'warning.main' },
          { label: 'Fulfillment', count: ordersByStatus.Fulfillment, color: 'primary.main' },
          { label: 'In Transit', count: ordersByStatus.Transit, color: 'info.main' },
          { label: 'Delivered', count: ordersByStatus.Delivered, color: 'success.main' },
          { label: 'Cancelled', count: ordersByStatus.Cancelled, color: 'error.main' },
        ].map((stat) => (
          <Grid item xs={12} sm={6} md={2.4} key={stat.label}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography color="textSecondary" variant="subtitle2" gutterBottom>{stat.label}</Typography>
                <Typography variant="h4" sx={{ color: stat.color }}>{stat.count}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Filters */}
      <Box display="flex" gap={2} mb={2}>
        <TextField
          placeholder="Search orders..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1); // Reset to first page when search changes
          }}
          sx={{ flexGrow: 1 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search />
              </InputAdornment>
            ),
          }}
        />
        <FormControl sx={{ minWidth: 200 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={statusFilter}
            label="Status"
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setPage(1); // Reset to first page when filter changes
            }}
          >
            <MenuItem value="All">All Statuses</MenuItem>
            <MenuItem value="Pending">Pending</MenuItem>
            <MenuItem value="Order Fulfillment">Order Fulfillment</MenuItem>
            <MenuItem value="In Transit">In Transit</MenuItem>
            <MenuItem value="Delivered">Delivered</MenuItem>
            <MenuItem value="Cancelled">Cancelled</MenuItem>
          </Select>
        </FormControl>
        <Button
          variant="outlined"
          startIcon={<Download />}
          onClick={handleExportPendingOrders}
          disabled={!orders || orders.filter(o => o.status === 'Pending').length === 0 || isExporting}
          sx={{ minWidth: 200 }}
        >
          {isExporting ? 'Exporting...' : 'Export Pending Orders (Excel)'}
        </Button>
      </Box>

      {/* Orders Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <SortableTableHeadCell columnId="id" label="Order ID" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="orderDate" label="Date" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="retailer" label="Retailer" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="items" label="Items" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} align="right" />
              <SortableTableHeadCell columnId="amount" label="Amount" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="status" label="Status" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>No orders found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedOrders.map((order) => (
                <TableRow key={order.id} hover onClick={() => navigate(`/orders/${order.id}`)} sx={{ cursor: 'pointer' }}>
                  <TableCell>#{order.id.substring(0, 8)}</TableCell>
                  <TableCell>
                    {order.orderDate instanceof Date
                      ? format(order.orderDate, 'MMM dd, yyyy')
                      : format(new Date(order.orderDate), 'MMM dd, yyyy')}
                  </TableCell>
                  <TableCell>{order.retailerEmail || 'N/A'}</TableCell>
                  <TableCell>{order.medicines.length} items</TableCell>
                  <TableCell>
                    {order.status === 'Pending' ? (
                      <Typography variant="caption" color="textSecondary">-</Typography>
                    ) : (
                      <>₹{order.totalAmount.toFixed(2)}</>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={order.status}
                      color={getStatusColor(order.status) as any}
                      size="small"
                      sx={{ fontWeight: 'bold' }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/orders/${order.id}`);
                      }}
                    >
                      <Visibility />
                    </IconButton>
                    {order.status !== 'Cancelled' && order.status !== 'Delivered' && (
                      <IconButton
                        size="small"
                        color="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelDialog({ open: true, orderId: order.id, reason: '' });
                        }}
                      >
                        <Cancel />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {sortedOrders.length > 0 && (
        <Box display="flex" justifyContent="center" alignItems="center" mt={3} mb={2}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={handlePageChange}
            color="primary"
            showFirstButton
            showLastButton
          />
          <Typography variant="body2" sx={{ ml: 2, color: 'text.secondary' }}>
            Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, sortedOrders.length)} of {sortedOrders.length} orders
          </Typography>
        </Box>
      )}

      {/* Cancel Confirmation Dialog */}
      <Dialog open={cancelDialog.open} onClose={() => setCancelDialog({ ...cancelDialog, open: false })}>
        <DialogTitle>Cancel Order</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>Are you sure you want to cancel order #{cancelDialog.orderId.substring(0, 8)}?</Typography>
          <TextField
            fullWidth
            label="Reason for cancellation"
            multiline
            rows={3}
            value={cancelDialog.reason}
            onChange={(e) => setCancelDialog({ ...cancelDialog, reason: e.target.value })}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelDialog({ ...cancelDialog, open: false })}>Keep Order</Button>
          <Button 
            variant="contained" 
            color="error" 
            onClick={handleCancelOrder}
            disabled={!cancelDialog.reason || cancelOrderMutation.isPending}
          >
            Cancel Order
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
