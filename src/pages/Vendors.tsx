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

const generatePassword = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

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
  const [generatedPassword, setGeneratedPassword] = useState('');
  
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
    const newPassword = generatePassword();
    setGeneratedPassword(newPassword);
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

    // Build bankDetails object only if at least one field has a value
    let bankDetails: any = undefined;
    if (formData.accountNumber || formData.ifscCode || formData.bankName) {
      bankDetails = {};
      if (formData.accountNumber && formData.accountNumber.trim() !== '') {
        bankDetails.accountNumber = formData.accountNumber;
      }
      if (formData.ifscCode && formData.ifscCode.trim() !== '') {
        bankDetails.ifscCode = formData.ifscCode;
      }
      if (formData.bankName && formData.bankName.trim() !== '') {
        bankDetails.bankName = formData.bankName;
      }
      // If bankDetails is empty after filtering, set to undefined
      if (Object.keys(bankDetails).length === 0) {
        bankDetails = undefined;
      }
    }

    const vendorData: any = {
      vendorName: formData.vendorName,
      phoneNumber: formData.phoneNumber,
      gstNumber: formData.gstNumber,
      isActive: formData.isActive,
    };
    
    // Add optional fields only if they have values
    if (formData.contactPerson && formData.contactPerson.trim() !== '') {
      vendorData.contactPerson = formData.contactPerson;
    }
    if (formData.email && formData.email.trim() !== '') {
      vendorData.email = formData.email;
    }
    if (formData.address && formData.address.trim() !== '') {
      vendorData.address = formData.address;
    }
    if (formData.drugLicenseNumber && formData.drugLicenseNumber.trim() !== '') {
      vendorData.drugLicenseNumber = formData.drugLicenseNumber;
    }
    if (formData.pan && formData.pan.trim() !== '') {
      vendorData.pan = formData.pan;
    }
    if (bankDetails) {
      vendorData.bankDetails = bankDetails;
    }

    try {
      if (editingVendor) {
        await updateVendorMutation.mutateAsync({
          vendorId: editingVendor.id,
          vendorData
        });
        setOpenDialog(false);
      } else {
        // Add password for new vendor creation
        const vendorDataWithPassword = {
          ...vendorData,
          password: generatedPassword,
        };
        console.log('Creating vendor with data:', {
          ...vendorDataWithPassword,
          password: '***' // Don't log actual password
        });
        await createVendorMutation.mutateAsync(vendorDataWithPassword as Omit<Vendor, 'id'> & { password?: string });
        setOpenDialog(false);
        setGeneratedPassword(''); // Clear password after successful creation
        // Success message is shown in the catch block if email fails, or silently succeeds if email is sent
      }
    } catch (error: any) {
      console.error('Vendor creation error:', error);
      // If vendor was created but email failed, show password in alert
      if (error.vendorCreated && error.password && error.email) {
        const isFunctionNotFound = error.isFunctionNotFound || 
                                   error.message?.includes('not deployed') ||
                                   error.message?.includes('not-found');
        
        const message = isFunctionNotFound
          ? `Vendor created successfully! ✅\n\n⚠️ Cloud Functions are not deployed yet.\n\nPlease share these credentials manually:\n\n📧 Email: ${error.email}\n🔑 Password: ${error.password}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nTo enable automatic email sending, deploy Cloud Functions:\n\n1. Open terminal/command prompt\n2. cd functions\n3. npm install\n4. firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="rvpljxxeeygrlfov"\n5. npm run build\n6. firebase deploy --only functions\n\nAfter deployment, emails will be sent automatically!`
          : `Vendor created successfully! ✅\n\nHowever, the password email could not be sent.\n\nPlease share these credentials manually:\n\n📧 Email: ${error.email}\n🔑 Password: ${error.password}\n\nError: ${error.message || 'Unknown error'}`;
        
        alert(message);
        setOpenDialog(false);
        setGeneratedPassword('');
      } else {
        setError(error.message || 'Failed to save vendor');
      }
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

