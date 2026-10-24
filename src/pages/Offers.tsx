import React, { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Add, Delete, Edit, LocalOffer } from '@mui/icons-material';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { IstDateField } from '../components/IstDateField';
import { Loading } from '../components/Loading';
import { useAppDialog } from '../context/AppDialogProvider';
import { useMedicineSearch } from '../hooks/useMedicineSearch';
import { useAddOffer, useDeleteOffer, useOffers, useUpdateOffer } from '../hooks/useOffers';
import { getMedicineById } from '../services/inventory';
import type { Medicine } from '../types';
import { naiveDateFromIstDateString, istDateStringFromNaiveDate } from '../utils/dateTime';
import {
  formatOfferBadge,
  isOfferLive,
  OFFER_TYPE_LABEL,
  type RetailerOffer,
  type RetailerOfferType,
} from '../utils/retailerOffers';

const toInputDate = (d?: Date | null) => (d ? istDateStringFromNaiveDate(d) : '');

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function medicineLabel(m: Medicine): string {
  return [m.name, m.productId, m.manufacturer].filter(Boolean).join(' — ');
}

type FormState = {
  title: string;
  subtitle: string;
  type: RetailerOfferType;
  isActive: boolean;
  sortOrder: string;
  paidQty: string;
  freeQty: string;
  discountPct: string;
  minQty: string;
  startsAt: string;
  endsAt: string;
  medicineIds: string[];
};

const emptyForm = (sortOrder: number): FormState => ({
  title: '',
  subtitle: '',
  type: 'buy_get_free',
  isActive: true,
  sortOrder: String(sortOrder),
  paidQty: '',
  freeQty: '',
  discountPct: '',
  minQty: '1',
  startsAt: '',
  endsAt: '',
  medicineIds: [],
});

export const OffersPage: React.FC = () => {
  const { data: offers, isLoading, error } = useOffers();
  const addMutation = useAddOffer();
  const updateMutation = useUpdateOffer();
  const deleteMutation = useDeleteOffer();
  const { alert, confirm } = useAppDialog();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RetailerOffer | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(1));
  const [searchInput, setSearchInput] = useState('');
  const { medicines: searchHits, loading: searchLoading } = useMedicineSearch(searchInput, {
    limit: 40,
  });

  const idsKey = useMemo(
    () => [...new Set(form.medicineIds.filter(Boolean))].sort().join(','),
    [form.medicineIds]
  );
  const { data: selectedMedicines = [] } = useQuery({
    queryKey: ['offerMedicines', idsKey],
    queryFn: async () => {
      const rows = await Promise.all(idsKey.split(',').map((id) => getMedicineById(id)));
      return rows.filter((m): m is Medicine => m != null);
    },
    enabled: idsKey.length > 0,
  });

  const selectedById = useMemo(() => {
    const map = new Map<string, Medicine>();
    for (const m of selectedMedicines) map.set(m.id, m);
    for (const m of searchHits) map.set(m.id, m);
    return map;
  }, [selectedMedicines, searchHits]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm((offers?.length ?? 0) + 1));
    setSearchInput('');
    setOpen(true);
  };

  const openEdit = (offer: RetailerOffer) => {
    setEditing(offer);
    setForm({
      title: offer.title,
      subtitle: offer.subtitle || '',
      type: offer.type,
      isActive: offer.isActive,
      sortOrder: String(offer.sortOrder || 1),
      paidQty: offer.paidQty != null ? String(offer.paidQty) : '',
      freeQty: offer.freeQty != null ? String(offer.freeQty) : '',
      discountPct: offer.discountPct != null ? String(offer.discountPct) : '',
      minQty: offer.minQty != null ? String(offer.minQty) : '1',
      startsAt: toInputDate(offer.startsAt),
      endsAt: toInputDate(offer.endsAt),
      medicineIds: [...offer.medicineIds],
    });
    setSearchInput('');
    setOpen(true);
  };

  const validate = (): string | null => {
    if (!form.title.trim()) return 'Enter a title';
    const ids = form.medicineIds;
    if (form.type === 'combo' && ids.length < 2) return 'Combo needs at least two medicines';
    if (form.type !== 'combo' && ids.length < 1) return 'Select a medicine';
    if (form.type === 'buy_get_free') {
      const paid = Math.floor(Number(form.paidQty));
      const free = Math.floor(Number(form.freeQty));
      if (!(paid > 0) || !(free > 0)) return 'Enter buy qty and free qty';
    } else {
      const pct = Number(form.discountPct);
      if (!(pct > 0) || pct > 100) return 'Enter a discount between 0 and 100';
      const minQty = Math.floor(Number(form.minQty));
      if (!(minQty > 0)) return 'Enter a minimum quantity of at least 1';
    }
    return null;
  };

  const handleSave = async () => {
    const problem = validate();
    if (problem) {
      await alert(problem, { severity: 'warning' });
      return;
    }
    const names = form.medicineIds.map((id) => selectedById.get(id)?.name || id);
    const starts = form.startsAt ? naiveDateFromIstDateString(form.startsAt) : null;
    const endsRaw = form.endsAt ? naiveDateFromIstDateString(form.endsAt) : null;
    const ends = endsRaw ? endOfLocalDay(endsRaw) : null;
    const input = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || undefined,
      type: form.type,
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder) || 0,
      medicineIds: form.medicineIds,
      medicineNames: names,
      paidQty: form.type === 'buy_get_free' ? Math.floor(Number(form.paidQty)) : undefined,
      freeQty: form.type === 'buy_get_free' ? Math.floor(Number(form.freeQty)) : undefined,
      discountPct: form.type === 'buy_get_free' ? undefined : Number(form.discountPct),
      minQty: form.type === 'buy_get_free' ? undefined : Math.floor(Number(form.minQty)),
      startsAt: starts,
      endsAt: ends,
    };
    try {
      if (editing) {
        await updateMutation.mutateAsync({ offerId: editing.id, input });
        await alert('Offer updated', { severity: 'success' });
      } else {
        await addMutation.mutateAsync(input);
        await alert('Offer added. It will show on the retailer home and apply on matching orders.', {
          severity: 'success',
        });
      }
      setOpen(false);
    } catch (e: unknown) {
      await alert(e instanceof Error ? e.message : 'Failed to save offer', { severity: 'error' });
    }
  };

  const handleDelete = async (offer: RetailerOffer) => {
    const ok = await confirm(`Delete "${offer.title}"? It will stop showing on the retailer app.`, {
      title: 'Delete offer',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(offer.id);
    } catch (e: unknown) {
      await alert(e instanceof Error ? e.message : 'Failed to delete offer', { severity: 'error' });
    }
  };

  if (isLoading) return <Loading message="Loading offers..." />;
  if (error) return <Alert severity="error">Failed to load offers</Alert>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight="bold">
            Retailer offers
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Buy-get-free, combo, and % discount deals shown on the retailer home. Matching items get
            the scheme or discount when the order is placed.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
          Add offer
        </Button>
      </Box>

      {!offers?.length ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 8 }}>
            <LocalOffer sx={{ fontSize: 60, color: 'grey.400', mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
              No offers yet
            </Typography>
            <Button variant="contained" startIcon={<Add />} onClick={openCreate} sx={{ mt: 2 }}>
              Add offer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={2}>
          {offers.map((offer) => {
            const live = isOfferLive(offer);
            return (
              <Grid item xs={12} sm={6} md={4} key={offer.id}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Box display="flex" justifyContent="space-between" gap={1} mb={1}>
                      <Typography variant="h6">{offer.title}</Typography>
                      <Chip
                        size="small"
                        label={live ? 'Live' : offer.isActive ? 'Scheduled' : 'Off'}
                        color={live ? 'success' : 'default'}
                      />
                    </Box>
                    <Chip size="small" label={OFFER_TYPE_LABEL[offer.type]} sx={{ mb: 1, mr: 1 }} />
                    <Chip size="small" label={formatOfferBadge(offer)} sx={{ mb: 1 }} />
                    {offer.subtitle ? (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {offer.subtitle}
                      </Typography>
                    ) : null}
                    <Typography variant="body2">
                      {(offer.medicineNames.length ? offer.medicineNames : offer.medicineIds).join(
                        ', '
                      )}
                    </Typography>
                    {(offer.startsAt || offer.endsAt) && (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                        {offer.startsAt ? format(offer.startsAt, 'd MMM yyyy') : 'Anytime'} –{' '}
                        {offer.endsAt ? format(offer.endsAt, 'd MMM yyyy') : 'open'}
                      </Typography>
                    )}
                  </CardContent>
                  <CardActions>
                    <IconButton size="small" color="primary" onClick={() => openEdit(offer)}>
                      <Edit />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => void handleDelete(offer)}>
                      <Delete />
                    </IconButton>
                  </CardActions>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Edit offer' : 'Add offer'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select
                label="Type"
                value={form.type}
                onChange={(e) => {
                  const type = e.target.value as RetailerOfferType;
                  setForm((prev) => ({
                    ...prev,
                    type,
                    medicineIds:
                      type !== 'combo' && prev.medicineIds.length > 1
                        ? prev.medicineIds.slice(0, 1)
                        : prev.medicineIds,
                  }));
                }}
              >
                <MenuItem value="buy_get_free">Buy get free</MenuItem>
                <MenuItem value="combo">Combo offer</MenuItem>
                <MenuItem value="percent_discount">Configured % discount</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              fullWidth
              size="small"
            />
            <TextField
              label="Subtitle (optional)"
              value={form.subtitle}
              onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
              fullWidth
              size="small"
            />
            {form.type === 'buy_get_free' ? (
              <Box display="flex" gap={2}>
                <TextField
                  label="Buy qty"
                  type="number"
                  size="small"
                  value={form.paidQty}
                  onChange={(e) => setForm({ ...form, paidQty: e.target.value })}
                  inputProps={{ min: 1 }}
                />
                <TextField
                  label="Get free"
                  type="number"
                  size="small"
                  value={form.freeQty}
                  onChange={(e) => setForm({ ...form, freeQty: e.target.value })}
                  inputProps={{ min: 1 }}
                />
              </Box>
            ) : (
              <Box display="flex" gap={2}>
                <TextField
                  label="Discount %"
                  type="number"
                  size="small"
                  value={form.discountPct}
                  onChange={(e) => setForm({ ...form, discountPct: e.target.value })}
                  inputProps={{ min: 0.01, max: 100, step: '0.01' }}
                />
                <TextField
                  label="Min qty"
                  type="number"
                  size="small"
                  value={form.minQty}
                  onChange={(e) => setForm({ ...form, minQty: e.target.value })}
                  inputProps={{ min: 1 }}
                  helperText={
                    form.type === 'combo'
                      ? 'Each combo medicine must reach this qty'
                      : 'Offer applies from this qty'
                  }
                />
              </Box>
            )}
            <Autocomplete
              options={searchHits.filter((m) => !form.medicineIds.includes(m.id))}
              loading={searchLoading}
              inputValue={searchInput}
              onInputChange={(_, value) => setSearchInput(value)}
              getOptionLabel={(o) => medicineLabel(o)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  label={form.type === 'combo' ? 'Add medicines' : 'Medicine'}
                  placeholder="Type at least 2 characters…"
                />
              )}
              noOptionsText={
                searchInput.trim().length < 2 ? 'Type to search medicines' : 'No matches'
              }
              onChange={(_, v) => {
                if (!v) return;
                if (form.type !== 'combo') {
                  setForm({ ...form, medicineIds: [v.id] });
                } else if (!form.medicineIds.includes(v.id)) {
                  setForm({ ...form, medicineIds: [...form.medicineIds, v.id] });
                }
                setSearchInput('');
              }}
            />
            <Box display="flex" flexWrap="wrap" gap={1}>
              {form.medicineIds.map((id) => (
                <Chip
                  key={id}
                  label={selectedById.get(id)?.name || id}
                  onDelete={() =>
                    setForm({ ...form, medicineIds: form.medicineIds.filter((x) => x !== id) })
                  }
                />
              ))}
            </Box>
            <Box display="flex" gap={2}>
              <IstDateField
                label="Starts"
                value={form.startsAt}
                onChange={(startsAt) => setForm({ ...form, startsAt })}
              />
              <IstDateField
                label="Ends"
                value={form.endsAt}
                onChange={(endsAt) => setForm({ ...form, endsAt })}
              />
            </Box>
            <TextField
              label="Sort order"
              type="number"
              size="small"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
              }
              label="Active"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleSave()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
