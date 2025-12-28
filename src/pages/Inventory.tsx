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
  Grid,
  Card,
  CardContent,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Pagination,
} from '@mui/material';
import {
  Search,
  Visibility,
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
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);

  const categories = Array.from(new Set(medicines?.map(m => m.category).filter(Boolean) || []));

  const filteredMedicines = medicines?.filter(medicine => {
    const name = String(medicine.name || '').toLowerCase();
    const code = String(medicine.code || '').toLowerCase();
    const manufacturer = String(medicine.manufacturer || '').toLowerCase();
    const search = searchTerm.toLowerCase();

    const matchesSearch = name.includes(search) || code.includes(search) || manufacturer.includes(search);
    
    const matchesCategory = categoryFilter === 'All' || medicine.category === categoryFilter;
    
    const currentStock = medicine.currentStock ?? medicine.stock ?? 0;
    const matchesStock =
      stockFilter === 'All' ||
      (stockFilter === 'Low' && currentStock < 10 && currentStock > 0) ||
      (stockFilter === 'Out' && currentStock === 0) ||
      (stockFilter === 'In Stock' && currentStock > 0);
    
    return matchesSearch && matchesCategory && matchesStock;
  }) || [];

  // Pagination
  const totalPages = Math.ceil(filteredMedicines.length / rowsPerPage);
  const paginatedMedicines = filteredMedicines.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const handlePageChange = (event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const getStockColor = (stock: number) => {
    if (stock === 0) return 'error';
    if (stock < 10) return 'warning';
    return 'success';
  };

  if (isLoading) return <Loading message="Loading inventory..." />;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Inventory Management</Typography>
      </Box>

      {/* Alerts */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {expiredMedicines && expiredMedicines.length > 0 && (
          <Grid item xs={12}>
            <Alert severity="error">{expiredMedicines.length} items have expired!</Alert>
          </Grid>
        )}
        {expiringMedicines && expiringMedicines.length > 0 && (
          <Grid item xs={12}>
            <Alert severity="warning">{expiringMedicines.length} items expiring within 30 days.</Alert>
          </Grid>
        )}
      </Grid>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              placeholder="Search by name, code, or manufacturer..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                value={categoryFilter}
                label="Category"
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setPage(1);
                }}
              >
                <MenuItem value="All">All Categories</MenuItem>
                {categories.map(cat => (
                  <MenuItem key={cat} value={cat}>{cat}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Stock Status</InputLabel>
              <Select
                value={stockFilter}
                label="Stock Status"
                onChange={(e) => {
                  setStockFilter(e.target.value);
                  setPage(1);
                }}
              >
                <MenuItem value="All">All Stock</MenuItem>
                <MenuItem value="In Stock">In Stock</MenuItem>
                <MenuItem value="Low">Low Stock</MenuItem>
                <MenuItem value="Out">Out of Stock</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {/* Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Medicine Details</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Manufacturer</TableCell>
              <TableCell align="right">Stock</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedMedicines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>No medicines found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedMedicines.map((medicine) => (
              <TableRow key={medicine.id} hover onClick={() => navigate(`/inventory/${medicine.id}`)} sx={{ cursor: 'pointer' }}>
                <TableCell>
                  <Typography variant="body2" fontWeight="bold">{medicine.name}</Typography>
                  <Typography variant="caption" color="textSecondary">{medicine.code || 'No code'}</Typography>
                </TableCell>
                <TableCell>{medicine.category}</TableCell>
                <TableCell>{medicine.manufacturer}</TableCell>
                <TableCell align="right">
                  <Chip
                    label={medicine.currentStock ?? medicine.stock ?? 0}
                    size="small"
                    color={getStockColor(medicine.currentStock ?? medicine.stock ?? 0) as any}
                  />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); navigate(`/inventory/${medicine.id}`); }}>
                    <Visibility />
                  </IconButton>
                </TableCell>
              </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {filteredMedicines.length > 0 && (
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
            Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, filteredMedicines.length)} of {filteredMedicines.length} medicines
          </Typography>
        </Box>
      )}
    </Box>
  );
};
