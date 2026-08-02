import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  TextField,
  Typography,
} from '@mui/material';
import { Save } from '@mui/icons-material';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateVendor } from '../hooks/useVendors';
import { Vendor } from '../types';
import { useAppDialog } from '../context/AppDialogProvider';

const generatePassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

const emptyForm = () => ({
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

type VendorFormDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Called with the new vendor after successful create (including email-send failures after create). */
  onCreated?: (vendor: Vendor) => void;
};

export const VendorFormDialog: React.FC<VendorFormDialogProps> = ({
  open,
  onClose,
  onCreated,
}) => {
  const queryClient = useQueryClient();
  const createVendorMutation = useCreateVendor();
  const { alert, confirm } = useAppDialog();
  const [error, setError] = useState<string | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [formData, setFormData] = useState(emptyForm);

  const cacheCreatedVendor = (vendorId: string, snapshot: Omit<Vendor, 'id'>) => {
    queryClient.setQueryData<Vendor[]>(['vendors'], (old) => {
      const list = old ? [...old] : [];
      if (list.some((v) => v.id === vendorId)) return list;
      return [{ id: vendorId, ...snapshot }, ...list];
    });
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setGeneratedPassword(generatePassword());
    setFormData(emptyForm());
  }, [open]);

  const handleSave = async () => {
    setError(null);

    if (!formData.vendorName || !formData.phoneNumber || !formData.gstNumber) {
      setError('Please fill all required fields (Vendor Name, Phone Number, GST Number)');
      return;
    }

    const trimmedEmail = formData.email?.trim() || '';
    if (trimmedEmail && !trimmedEmail.includes('@')) {
      setError('Please enter a valid email address or leave it empty');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (trimmedEmail && !emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address (e.g., vendor@example.com)');
      return;
    }

    let bankDetails: Vendor['bankDetails'] | undefined;
    if (formData.accountNumber || formData.ifscCode || formData.bankName) {
      const details: NonNullable<Vendor['bankDetails']> = {};
      if (formData.accountNumber.trim()) details.accountNumber = formData.accountNumber.trim();
      if (formData.ifscCode.trim()) details.ifscCode = formData.ifscCode.trim();
      if (formData.bankName.trim()) details.bankName = formData.bankName.trim();
      if (Object.keys(details).length > 0) bankDetails = details;
    }

    const vendorSnapshot: Omit<Vendor, 'id'> = {
      vendorName: formData.vendorName,
      phoneNumber: formData.phoneNumber,
      gstNumber: formData.gstNumber,
      email: trimmedEmail,
      isActive: formData.isActive,
      createdAt: new Date(),
    };

    if (formData.contactPerson.trim()) vendorSnapshot.contactPerson = formData.contactPerson.trim();
    if (formData.address.trim()) vendorSnapshot.address = formData.address.trim();
    if (formData.drugLicenseNumber.trim()) {
      vendorSnapshot.drugLicenseNumber = formData.drugLicenseNumber.trim();
    }
    if (formData.pan.trim()) vendorSnapshot.pan = formData.pan.trim();
    if (bankDetails) vendorSnapshot.bankDetails = bankDetails;

    try {
      if (!trimmedEmail) {
        const confirmNoEmail = await confirm(
          'No email address provided. The vendor password will not be sent automatically.\n\n' +
            'Password: ' +
            generatedPassword +
            '\n\n' +
            'Please share this password with the vendor manually.\n\n' +
            'Continue with vendor creation?'
        );
        if (!confirmNoEmail) return;
      }

      const vendorId = await createVendorMutation.mutateAsync({
        ...vendorSnapshot,
        password: generatedPassword,
      });

      const created: Vendor = { id: vendorId, ...vendorSnapshot };
      cacheCreatedVendor(vendorId, vendorSnapshot);
      // Select immediately — before success alerts — so the PI form never looks empty.
      onCreated?.(created);
      onClose();

      if (trimmedEmail) {
        await alert(
          'Vendor created successfully! ✅\n\nPassword email has been sent to: ' + trimmedEmail,
          { severity: 'success' }
        );
      } else {
        await alert(
          'Vendor created successfully! ✅\n\n⚠️ No email provided - password was not sent.\n\nPassword: ' +
            generatedPassword +
            '\n\nPlease share this password with the vendor manually.',
          { severity: 'warning' }
        );
      }
    } catch (err: any) {
      if (err?.vendorCreated && err?.vendorId) {
        const created: Vendor = { id: err.vendorId as string, ...vendorSnapshot };
        cacheCreatedVendor(err.vendorId as string, vendorSnapshot);
        onCreated?.(created);
        onClose();
        await alert(
          err.message ||
            'Vendor created, but sending the password email failed. Please share the password manually.',
          { severity: 'warning' }
        );
        return;
      }
      setError(err?.message || 'Failed to create vendor');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Add New Vendor</DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 2 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Typography variant="subtitle2" gutterBottom>
            Basic Information
          </Typography>
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
                helperText="Optional - Password will be sent to this email if provided"
                placeholder="vendor@example.com"
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
          <Typography variant="subtitle2" gutterBottom>
            Tax & License Information
          </Typography>
          <Grid container spacing={2} mb={3}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="GST Number"
                required
                value={formData.gstNumber}
                onChange={(e) =>
                  setFormData({ ...formData, gstNumber: e.target.value.toUpperCase() })
                }
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
          <Typography variant="subtitle2" gutterBottom>
            Bank Details (Optional)
          </Typography>
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
                onChange={(e) =>
                  setFormData({ ...formData, ifscCode: e.target.value.toUpperCase() })
                }
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
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          startIcon={<Save />}
          onClick={handleSave}
          disabled={createVendorMutation.isPending}
        >
          Create Vendor
        </Button>
      </DialogActions>
    </Dialog>
  );
};
