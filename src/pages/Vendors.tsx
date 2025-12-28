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
  Grid,
  Divider,
  Alert,
  Pagination,
} from '@mui/material';
import {
  Edit,
  Search,
  Add,
  CheckCircle,
  Cancel,
  Save,
  Business,
} from '@mui/icons-material';
import { useVendors, useCreateVendor, useUpdateVendor, useToggleVendorStatus } from '../hooks/useVendors';
import { Vendor } from '../types';
import { Loading } from '../components/Loading';

export const VendorsPage: React.FC = () => {
  const { data: vendors, isLoading } = useVendors();
  const createVendorMutation = useCreateVendor();
  const updateVendorMutation = useUpdateVendor();
  const toggleStatusMutation = useToggleVendorStatus();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    vendorName: '',
    contactPerson: '',
    email: '',
    phoneNumber: '',
    address: '',
    gstNumber: '',
    drugLicenseNumber: '',
    pan: '',
    accountNumber: '',
    ifscCode: '',
    bankName: '',
    isActive: true,
  });

  const filteredVendors = vendors?.filter(vendor =>
    vendor.vendorName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vendor.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vendor.gstNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vendor.drugLicenseNumber?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Pagination
  const totalPages = Math.ceil(filteredVendors.length / rowsPerPage);
  const paginatedVendors = filteredVendors.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const handlePageChange = (event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const handleOpenCreate = () => {
    setEditingVendor(null);
    setError(null);
    setFormData({
      vendorName: '',
      contactPerson: '',
      email: '',
      phoneNumber: '',
      address: '',
      gstNumber: '',
      drugLicenseNumber: '',
      pan: '',
      accountNumber: '',
      ifscCode: '',
      bankName: '',
      isActive: true,
    });
    setOpenDialog(true);
  };

  const handleOpenEdit = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setError(null);
    setFormData({
      vendorName: vendor.vendorName || '',
      contactPerson: vendor.contactPerson || '',
      email: vendor.email || '',
      phoneNumber: vendor.phoneNumber || '',
      address: vendor.address || '',
      gstNumber: vendor.gstNumber || '',
      drugLicenseNumber: vendor.drugLicenseNumber || '',
      pan: vendor.pan || '',
      accountNumber: vendor.bankDetails?.accountNumber || '',
      ifscCode: vendor.bankDetails?.ifscCode || '',
      bankName: vendor.bankDetails?.bankName || '',
      isActive: vendor.isActive !== false,
    });
    setOpenDialog(true);
  };

  const handleSave = async () => {
    setError(null);
    
    if (!formData.vendorName || !formData.phoneNumber || !formData.gstNumber) {
      setError('Please fill all required fields (Vendor Name, Phone Number, GST Number)');
      return;
    }

    // Email is optional, but if provided should be valid
    if (formData.email && !formData.email.includes('@')) {
      setError('Please enter a valid email address or leave it empty');
      return;
    }

    const vendorData: any = {
      vendorName: formData.vendorName,
      contactPerson: formData.contactPerson,
      email: formData.email,
      phoneNumber: formData.phoneNumber,
      address: formData.address,
      gstNumber: formData.gstNumber,
      drugLicenseNumber: formData.drugLicenseNumber || undefined,
      pan: formData.pan || undefined,
      isActive: formData.isActive,
      bankDetails: (formData.accountNumber || formData.ifscCode || formData.bankName) ? {
        accountNumber: formData.accountNumber || undefined,
        ifscCode: formData.ifscCode || undefined,
        bankName: formData.bankName || undefined,
      } : undefined,
    };

    try {
      if (editingVendor) {
        await updateVendorMutation.mutateAsync({
          vendorId: editingVendor.id,
          vendorData
        });
      } else {
        await createVendorMutation.mutateAsync(vendorData as Omit<Vendor, 'id'>);
      }
      setOpenDialog(false);
    } catch (error: any) {
      setError(error.message || 'Failed to save vendor');
    }
  };

  if (isLoading) return <Loading message="Loading vendors..." />;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Vendor Management</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={handleOpenCreate}>
          Add Vendor
        </Button>
      </Box>

      <TextField
        fullWidth
        placeholder="Search vendors by name, email, GST, or license number..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search />
            </InputAdornment>
          ),
        }}
      />

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Vendor Name</TableCell>
              <TableCell>Contact</TableCell>
              <TableCell>GST Number</TableCell>
              <TableCell>License Number</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredVendors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>No vendors found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedVendors.map((vendor) => (
                <TableRow key={vendor.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight="bold">{vendor.vendorName}</Typography>
                    <Typography variant="caption" color="textSecondary">{vendor.email}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{vendor.contactPerson || 'N/A'}</Typography>
                    <Typography variant="caption" color="textSecondary">{vendor.phoneNumber || 'N/A'}</Typography>
                  </TableCell>
                  <TableCell>{vendor.gstNumber}</TableCell>
                  <TableCell>{vendor.drugLicenseNumber || 'N/A'}</TableCell>
                  <TableCell>
                    <Chip
                      label={vendor.isActive !== false ? 'Active' : 'Inactive'}
                      color={vendor.isActive !== false ? 'success' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleOpenEdit(vendor)} color="primary">
                      <Edit />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => toggleStatusMutation.mutate({ vendorId: vendor.id, isActive: !vendor.isActive })}
                      color={vendor.isActive !== false ? 'success' : 'default'}
                    >
                      {vendor.isActive !== false ? <CheckCircle /> : <Cancel />}
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {filteredVendors.length > 0 && (
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
            Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, filteredVendors.length)} of {filteredVendors.length} vendors
          </Typography>
        </Box>
      )}

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingVendor ? 'Edit Vendor' : 'Add New Vendor'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            
            <Typography variant="subtitle2" gutterBottom>Basic Information</Typography>
            <Grid container spacing={2} mb={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Vendor Name"
                  required
                  value={formData.vendorName}
                  onChange={(e) => setFormData({ ...formData, vendorName: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Email Address"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  helperText="Optional"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Contact Person"
                  value={formData.contactPerson}
                  onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Phone Number"
                  required
                  value={formData.phoneNumber}
                  onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                  helperText="Must be unique"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Address"
                  multiline
                  rows={2}
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </Grid>
            </Grid>

            <Divider sx={{ mb: 3 }} />
            <Typography variant="subtitle2" gutterBottom>Tax & License Information</Typography>
            <Grid container spacing={2} mb={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="GST Number"
                  required
                  value={formData.gstNumber}
                  onChange={(e) => setFormData({ ...formData, gstNumber: e.target.value.toUpperCase() })}
                  helperText="Must be unique"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Drug License Number"
                  value={formData.drugLicenseNumber}
                  onChange={(e) => setFormData({ ...formData, drugLicenseNumber: e.target.value })}
                  helperText="Must be unique if provided"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="PAN"
                  value={formData.pan}
                  onChange={(e) => setFormData({ ...formData, pan: e.target.value.toUpperCase() })}
                />
              </Grid>
            </Grid>

            <Divider sx={{ mb: 3 }} />
            <Typography variant="subtitle2" gutterBottom>Bank Details (Optional)</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Account Number"
                  value={formData.accountNumber}
                  onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="IFSC Code"
                  value={formData.ifscCode}
                  onChange={(e) => setFormData({ ...formData, ifscCode: e.target.value.toUpperCase() })}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Bank Name"
                  value={formData.bankName}
                  onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={handleSave}
            disabled={createVendorMutation.isPending || updateVendorMutation.isPending}
          >
            {editingVendor ? 'Update Vendor' : 'Create Vendor'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

