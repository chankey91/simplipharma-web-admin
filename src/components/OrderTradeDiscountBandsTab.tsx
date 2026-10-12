import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Add, Delete } from '@mui/icons-material';
import {
  useOrderTradeDiscountSettings,
  useSaveOrderTradeDiscountSettings,
} from '../hooks/useOrderTradeDiscountSettings';
import { Loading } from './Loading';
import { useAppDialog } from '../context/AppDialogProvider';
import {
  DEFAULT_ORDER_TRADE_DISCOUNT_BANDS,
  type OrderTradeDiscountBand,
} from '../utils/orderFulfillmentDiscount';

export const OrderTradeDiscountBandsTab: React.FC = () => {
  const { data, isLoading, error } = useOrderTradeDiscountSettings();
  const saveMutation = useSaveOrderTradeDiscountSettings();
  const { alert } = useAppDialog();
  const [bands, setBands] = useState<OrderTradeDiscountBand[]>([...DEFAULT_ORDER_TRADE_DISCOUNT_BANDS]);

  useEffect(() => {
    if (!data?.bands?.length) {
      setBands([...DEFAULT_ORDER_TRADE_DISCOUNT_BANDS]);
      return;
    }
    setBands(data.bands);
  }, [data]);

  const updateBand = (index: number, patch: Partial<OrderTradeDiscountBand>) => {
    setBands((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync({ bands });
      await alert('Retailer Disc % bands saved. Pending orders will use the new values.', {
        severity: 'success',
      });
    } catch (e: unknown) {
      await alert(e instanceof Error ? e.message : 'Failed to save', { severity: 'error' });
    }
  };

  if (isLoading) return <Loading message="Loading Disc % bands…" />;
  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Failed to load settings. Deploy latest Firestore rules if this is a new collection.
      </Alert>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Retailer Disc % from vendor discount
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        When fulfilling an order, Disc % is filled from the vendor (purchase invoice) discount using
        these bands. The table is pre-filled with the current live rule. Highest matching “at least”
        row wins. You can change any value and Save.
      </Typography>

      <TableContainer sx={{ mb: 2, maxWidth: 640 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Vendor discount at least (%)</TableCell>
              <TableCell>Give retailer Disc (%)</TableCell>
              <TableCell align="right"> </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bands.map((band, index) => (
              <TableRow key={index}>
                <TableCell>
                  <TextField
                    size="small"
                    type="number"
                    inputProps={{ min: 0, max: 100, step: 0.5 }}
                    value={band.minVendorPct}
                    onChange={(e) =>
                      updateBand(index, { minVendorPct: e.target.value === '' ? 0 : Number(e.target.value) })
                    }
                    sx={{ width: 140 }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    type="number"
                    inputProps={{ min: 0, max: 100, step: 0.5 }}
                    value={band.givePct}
                    onChange={(e) =>
                      updateBand(index, { givePct: e.target.value === '' ? 0 : Number(e.target.value) })
                    }
                    sx={{ width: 140 }}
                  />
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    color="error"
                    disabled={bands.length <= 1}
                    onClick={() => setBands((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Delete />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box display="flex" gap={1} flexWrap="wrap">
        <Button
          variant="outlined"
          startIcon={<Add />}
          onClick={() => setBands((prev) => [...prev, { minVendorPct: 0, givePct: 0 }])}
        >
          Add band
        </Button>
        <Button
          variant="outlined"
          onClick={() => setBands([...DEFAULT_ORDER_TRADE_DISCOUNT_BANDS])}
        >
          Reset to current default
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save bands'}
        </Button>
      </Box>
    </Box>
  );
};
