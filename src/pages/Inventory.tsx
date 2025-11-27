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
  TextField,
  InputAdornment,
  IconButton,
  Chip,
  Alert,
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
  Edit,
  Inventory as InventoryIcon,
  Add,
} from '@mui/icons-material';
import { useMedicines, useExpiringMedicines, useExpiredMedicines } from '../hooks/useInventory';
import { Medicine } from '../types';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';

export const InventoryPage: React.FC = () => {
  const { data: medicines, isLoading } = useMedicines();
  const { data: expiringMedicines } = useExpiringMedicines(30);
  const { data: expiredMedicines } = useExpiredMedicines();
  const navigate = useNavigate();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [stockFilter, setStockFilter] = useState<string>('All');

  const categories = Array.from(new Set(medicines?.map(m => m.category) || []));

  const filteredMedicines = medicines?.filter(medicine => {
    const matchesSearch =
      medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      medicine.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      medicine.manufacturer.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = categoryFilter === 'All' || medicine.category === categoryFilter;
    
    const matchesStock =
      stockFilter === 'All' ||
      (stockFilter === 'Low' && (medicine.currentStock || medicine.stock) < 10) ||
      (stockFilter === 'Out' && (medicine.currentStock || medicine.stock) === 0) ||
      (stockFilter === 'In Stock' && (medicine.currentStock || medicine.stock) > 0);
    
    return matchesSearch && matchesCategory && matchesStock;
  }) || [];

  const lowStockCount = medicines?.filter(m => (m.currentStock || m.stock || 0) < 10).length || 0;
  const outOfStockCount = medicines?.filter(m => (m.currentStock || m.stock || 0) === 0).length || 0;
  const totalValue = medicines?.reduce((sum, m) => {
    const stock = m.currentStock || m.stock || 0;
    const price = m.costPrice || m.price || 0;
    return sum + (stock * price);
  }, 0) || 0;

  const isExpiring = (medicine: Medicine) => {
    if (!medicine.expiryDate) return false;
    const expiry = medicine.expiryDate instanceof Date
      ? medicine.expiryDate
      : medicine.expiryDate.toDate();
    const daysUntilExpiry = Math.ceil((expiry.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 30 && daysUntilExpiry > 0;
  };

  const isExpired = (medicine: Medicine) => {
    if (!medicine.expiryDate) return false;
    const expiry = medicine.expiryDate instanceof Date
      ? medicine.expiryDate
      : medicine.expiryDate.toDate();
    return expiry < new Date();
  };

  if (isLoading) {
    return <Loading message="Loading inventory..." />;
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Inventory Management</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => navigate('/inventory/stock-update')}
        >
          Update Stock
        </Button>
      </Box>

      {/* Alerts */}
      {expiredMedicines && expiredMedicines.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {expiredMedicines.length} medicine(s) have expired
        </Alert>
      )}
      {expiringMedicines && expiringMedicines.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {expiringMedicines.length} medicine(s) expiring in next 30 days
        </Alert>
      )}

      {/* Statistics */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Total Items</Typography>
              <Typography variant="h4">{medicines?.length || 0}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Low Stock</Typography>
              <Typography variant="h4" color="warning.main">
                {lowStockCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Out of Stock</Typography>
              <Typography variant="h4" color="error.main">
                {outOfStockCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Total Value</Typography>
              <Typography variant="h4">₹{totalValue.toFixed(2)}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Box display="flex" gap={2} mb={2}>
        <TextField
          placeholder="Search medicines..."
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
          <InputLabel>Category</InputLabel>
          <Select
            value={categoryFilter}
            label="Category"
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <MenuItem value="All">All</MenuItem>
            {categories.map((cat) => (
              <MenuItem key={cat} value={cat}>
                {cat}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: 150 }}>
          <InputLabel>Stock</InputLabel>
          <Select
            value={stockFilter}
            label="Stock"
            onChange={(e) => setStockFilter(e.target.value)}
          >
            <MenuItem value="All">All</MenuItem>
            <MenuItem value="In Stock">In Stock</MenuItem>
            <MenuItem value="Low">Low Stock</MenuItem>
            <MenuItem value="Out">Out of Stock</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Medicines Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Code</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Manufacturer</TableCell>
              <TableCell>Stock</TableCell>
              <TableCell>Price</TableCell>
              <TableCell>Expiry Date</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredMedicines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography color="textSecondary">No medicines found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredMedicines.map((medicine) => (
                <TableRow key={medicine.id}>
                  <TableCell>{medicine.code || 'N/A'}</TableCell>
                  <TableCell>{medicine.name}</TableCell>
                  <TableCell>{medicine.category}</TableCell>
                  <TableCell>{medicine.manufacturer}</TableCell>
                  <TableCell>
                    <Chip
                      label={medicine.currentStock || medicine.stock || 0}
                      color={
                        (medicine.currentStock || medicine.stock || 0) === 0
                          ? 'error'
                          : (medicine.currentStock || medicine.stock || 0) < 10
                          ? 'warning'
                          : 'default'
                      }
                      size="small"
                    />
                  </TableCell>
                  <TableCell>₹{medicine.price.toFixed(2)}</TableCell>
                  <TableCell>
                    {medicine.expiryDate
                      ? format(
                          medicine.expiryDate instanceof Date
                            ? medicine.expiryDate
                            : medicine.expiryDate.toDate(),
                          'MMM dd, yyyy'
                        )
                      : 'N/A'}
                    {isExpired(medicine) && (
                      <Chip label="Expired" color="error" size="small" sx={{ ml: 1 }} />
                    )}
                    {isExpiring(medicine) && !isExpired(medicine) && (
                      <Chip label="Expiring" color="warning" size="small" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell>
                    {isExpired(medicine) ? (
                      <Chip label="Expired" color="error" size="small" />
                    ) : isExpiring(medicine) ? (
                      <Chip label="Expiring" color="warning" size="small" />
                    ) : (
                      <Chip label="Active" color="success" size="small" />
                    )}
                  </TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      onClick={() => navigate(`/inventory/stock-update?medicineId=${medicine.id}`)}
                    >
                      <Edit />
                    </IconButton>
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
