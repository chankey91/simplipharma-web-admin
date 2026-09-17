import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { Loading } from '../../components/Loading';
import { useAppDialog } from '../../context/AppDialogProvider';
import { useAuth } from '../../context/AuthContext';
import { useCompanyGstSettings, useSaveCompanyGstSettings } from '../../hooks/useGst';
import { gstinHelperText, isValidGstinFormat, normalizeGstin } from '../../utils/gstin';
import type { GstFilingFrequency } from '../../types/gst';

export const GstSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const writable = canWrite('gst');
  const { alert } = useAppDialog();
  const { data, isLoading } = useCompanyGstSettings();
  const saveMutation = useSaveCompanyGstSettings();
  const [form, setForm] = useState({
    legalName: '',
    tradeName: '',
    gstin: '',
    address: '',
    state: '',
    stateCode: '',
    pincode: '',
    phone: '',
    email: '',
    dl: '',
    filingFrequency: 'monthly' as GstFilingFrequency,
    einvoiceEnabled: false,
    fyStartMonth: 4,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      legalName: data.legalName,
      tradeName: data.tradeName || '',
      gstin: data.gstin,
      address: data.address,
      state: data.state,
      stateCode: data.stateCode,
      pincode: data.pincode || '',
      phone: data.phone || '',
      email: data.email || '',
      dl: data.dl || '',
      filingFrequency: data.filingFrequency,
      einvoiceEnabled: data.einvoiceEnabled,
      fyStartMonth: data.fyStartMonth,
    });
  }, [data]);

  const handleSave = async () => {
    if (!writable) return;
    const gstin = normalizeGstin(form.gstin);
    if (!isValidGstinFormat(gstin)) {
      await alert('Enter a valid 15-character company GSTIN', { severity: 'warning' });
      return;
    }
    if (!form.legalName.trim() || !form.address.trim()) {
      await alert('Legal name and address are required', { severity: 'warning' });
      return;
    }
    try {
      await saveMutation.mutateAsync({
        ...form,
        gstin,
        einvoiceEnabled: form.einvoiceEnabled,
      });
      await alert('Company GST settings saved. Existing invoices were not changed.', {
        severity: 'success',
      });
    } catch (error: unknown) {
      await alert(error instanceof Error ? error.message : 'Failed to save GST settings', {
        severity: 'error',
      });
    }
  };

  if (isLoading) return <Loading message="Loading GST settings..." />;

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'GST', path: '/gst' }, { label: 'Settings' }]} />
      <Typography variant="h4" gutterBottom>
        Company GST settings
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Used for new invoice snapshots only. Printed historical invoices keep the previous hardcoded
        company block unless they already have a snapshot.
      </Typography>

      {!writable ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You can view these settings. Ask an admin for GST write access to change them.
        </Alert>
      ) : null}

      <Paper sx={{ p: 3, maxWidth: 880 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <TextField
              fullWidth
              label="Legal name"
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              disabled={!writable}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label="Trade name"
              value={form.tradeName}
              onChange={(e) => setForm({ ...form, tradeName: e.target.value })}
              disabled={!writable}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="GSTIN"
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
              helperText={gstinHelperText(form.gstin)}
              error={Boolean(form.gstin) && !isValidGstinFormat(form.gstin)}
              disabled={!writable}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="State code"
              value={form.stateCode}
              onChange={(e) => setForm({ ...form, stateCode: e.target.value })}
              disabled={!writable}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="State"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
              disabled={!writable}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              disabled={!writable}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label="Pincode"
              value={form.pincode}
              onChange={(e) => setForm({ ...form, pincode: e.target.value })}
              disabled={!writable}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              disabled={!writable}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              disabled={!writable}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Drug licence"
              value={form.dl}
              onChange={(e) => setForm({ ...form, dl: e.target.value })}
              disabled={!writable}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              select
              fullWidth
              label="Filing frequency"
              value={form.filingFrequency}
              onChange={(e) =>
                setForm({ ...form, filingFrequency: e.target.value as GstFilingFrequency })
              }
              disabled={!writable}
            >
              <MenuItem value="monthly">Monthly</MenuItem>
              <MenuItem value="qrmp">QRMP (quarterly)</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.einvoiceEnabled}
                  onChange={(e) => setForm({ ...form, einvoiceEnabled: e.target.checked })}
                  disabled={!writable}
                />
              }
              label="E-invoice (IRN) required — enables IRP JSON download for B2B. Does not call NIC."
            />
          </Grid>
          <Grid item xs={12}>
            <Alert severity="info">
              Live GSTN / GSP filing is not connected. Download GSTR-1 and GSTR-3B JSON and upload
              them on gst.gov.in. A GSP can be added later when you have ASP credentials.
            </Alert>
          </Grid>
        </Grid>

        <Box sx={{ display: 'flex', gap: 1, mt: 3 }}>
          <Button variant="contained" onClick={() => void handleSave()} disabled={!writable || saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save settings'}
          </Button>
          <Button onClick={() => navigate('/gst')}>Back</Button>
        </Box>
      </Paper>
    </Box>
  );
};
