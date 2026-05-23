import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Switch,
  FormControlLabel,
  TextField,
  Button,
  Autocomplete,
  Alert,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
} from '@mui/material';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import Close from '@mui/icons-material/Close';
import Stars from '@mui/icons-material/Stars';
import { useMedicines } from '../hooks/useInventory';
import type { Medicine } from '../types';
import { auth } from '../services/firebase';
import {
  subscribeHomeFeedConfig,
  emptyHomeFeedConfig,
  saveHomeFeedConfig,
  DEFAULT_SECTION_TITLES,
  HOME_FEED_SLOT_CAP,
  type HomeFeedConfigState,
} from '../services/homeFeedConfig';

function isMedicineDeleted(m: Medicine & { deleted?: boolean }): boolean {
  return m.deleted === true;
}

function medicineOptionLabel(m: Medicine): string {
  const bits = [m.name, m.manufacturer?.trim() || '', m.category ? `(${m.category})` : ''].filter(Boolean);
  return bits.join(' — ');
}

function moveIndex<T>(arr: T[], index: number, delta: number): T[] {
  const next = [...arr];
  const j = index + delta;
  if (j < 0 || j >= next.length) return next;
  const t = next[index];
  next[index] = next[j]!;
  next[j] = t!;
  return next;
}

const ProductPickList: React.FC<{
  title: string;
  ids: string[];
  options: Medicine[];
  onIdsChange: (ids: string[]) => void;
  disabled?: boolean;
}> = ({ title, ids, options, onIdsChange, disabled }) => {
  const optionById = useMemo(() => {
    const m = new Map<string, Medicine>();
    for (const o of options) m.set(o.id, o);
    return m;
  }, [options]);

  const selectableOptions = useMemo(() => options.filter((m) => !ids.includes(m.id)), [options, ids]);

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>
        {title} (max {HOME_FEED_SLOT_CAP})
      </Typography>
      <Autocomplete
        disablePortal
        disabled={disabled || ids.length >= HOME_FEED_SLOT_CAP}
        options={selectableOptions}
        getOptionLabel={(o) => medicineOptionLabel(o)}
        renderInput={(params) => <TextField {...params} label="Add from inventory" placeholder="Search by name…" />}
        filterOptions={(opts, params) => {
          const q = params.inputValue.trim().toLowerCase();
          if (q.length < 1) return opts.slice(0, 80);
          return opts
            .filter((m) => {
              const nm = `${m.name} ${m.manufacturer ?? ''} ${m.code ?? ''}`.toLowerCase();
              return nm.includes(q);
            })
            .slice(0, 120);
        }}
        onChange={(_, v) => {
          if (!v || ids.includes(v.id) || ids.length >= HOME_FEED_SLOT_CAP) return;
          onIdsChange([...ids, v.id]);
        }}
        sx={{ mb: 2 }}
      />
      {ids.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          None selected — leave empty to auto-fill on the mobile app until you rely on curated lists (or swap to AI
          recommendations later).
        </Typography>
      ) : (
        <List dense disablePadding>
          {ids.map((id, idx) => {
            const med = optionById.get(id);
            return (
              <ListItem
                key={id}
                secondaryAction={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <IconButton
                      edge="end"
                      size="small"
                      disabled={disabled || idx === 0}
                      aria-label="Move up"
                      onClick={() => onIdsChange(moveIndex(ids, idx, -1))}
                    >
                      <ArrowUpward fontSize="small" />
                    </IconButton>
                    <IconButton
                      edge="end"
                      size="small"
                      disabled={disabled || idx === ids.length - 1}
                      aria-label="Move down"
                      onClick={() => onIdsChange(moveIndex(ids, idx, 1))}
                    >
                      <ArrowDownward fontSize="small" />
                    </IconButton>
                    <IconButton
                      edge="end"
                      size="small"
                      aria-label="Remove"
                      disabled={disabled}
                      onClick={() => onIdsChange(ids.filter((x) => x !== id))}
                    >
                      <Close fontSize="small" />
                    </IconButton>
                  </Box>
                }
                sx={{
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  mb: 1,
                  pr: '120px!important',
                  alignItems: 'flex-start',
                }}
              >
                <ListItemText
                  primary={`${idx + 1}. ${med ? med.name : id}`}
                  secondary={med ? [med.manufacturer, med.category].filter(Boolean).join(' • ') || '—' : 'Not found in cache — still saved'}
                />
              </ListItem>
            );
          })}
        </List>
      )}
    </Box>
  );
};

export const HomeFeedPage: React.FC = () => {
  const { data: medicines, isLoading: medicinesLoading } = useMedicines();
  const activeMedicines = useMemo(
    () => (medicines || []).filter((m) => !isMedicineDeleted(m as Medicine & { deleted?: boolean })),
    [medicines]
  );

  const [cfg, setCfg] = useState<HomeFeedConfigState>(() => emptyHomeFeedConfig());
  const [firestoreLoaded, setFirestoreLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<{ severity: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    const unsub = subscribeHomeFeedConfig(
      (next) => {
        setCfg(next);
        setFirestoreLoaded(true);
      },
      () => {
        setCfg(emptyHomeFeedConfig());
        setFirestoreLoaded(true);
      }
    );
    return unsub;
  }, []);

  const onSave = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setAlert({ severity: 'error', msg: 'You must be signed in.' });
      return;
    }
    setSaving(true);
    setAlert(null);
    try {
      await saveHomeFeedConfig(uid, cfg);
      setAlert({ severity: 'success', msg: 'Home feed saved. Changes sync to retailer apps shortly.' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setAlert({ severity: 'error', msg });
    } finally {
      setSaving(false);
    }
  }, [cfg]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 960 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Stars color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Home feed (mobile)
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Show or hide the “Recommended” and “Featured” blocks on the retailer home screen and choose up to {HOME_FEED_SLOT_CAP}{' '}
        products per block from inventory. When a list is empty, the app fills that section automatically (today’s heuristic);
        curated IDs override that list. Replace with AI-ranked products later without changing retailers’ apps again.
      </Typography>

      {alert ? (
        <Alert severity={alert.severity} sx={{ mb: 2 }} onClose={() => setAlert(null)}>
          {alert.msg}
        </Alert>
      ) : null}

      {!firestoreLoaded ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 4 }}>
          <CircularProgress size={24} /> <Typography variant="body2">Loading configuration…</Typography>
        </Box>
      ) : (
        <>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Sections
            </Typography>
            <FormControlLabel
              control={
                <Switch checked={cfg.showRecommended} onChange={(e) => setCfg((c) => ({ ...c, showRecommended: e.target.checked }))} />
              }
              label="Show “Recommended” block"
            />
            <FormControlLabel
              sx={{ ml: 0, display: 'block', mt: 1 }}
              control={
                <Switch checked={cfg.showFeatured} onChange={(e) => setCfg((c) => ({ ...c, showFeatured: e.target.checked }))} />
              }
              label="Show “Featured” block"
            />
            <Divider sx={{ my: 2 }} />
            <TextField
              fullWidth
              label="Recommended section heading"
              value={cfg.recommendedSectionTitle || DEFAULT_SECTION_TITLES.recommended}
              inputProps={{ maxLength: 80 }}
              onChange={(e) => setCfg((c) => ({ ...c, recommendedSectionTitle: e.target.value }))}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Featured section heading"
              value={cfg.featuredSectionTitle || DEFAULT_SECTION_TITLES.featured}
              inputProps={{ maxLength: 80 }}
              onChange={(e) => setCfg((c) => ({ ...c, featuredSectionTitle: e.target.value }))}
            />
          </Paper>

          <Paper sx={{ p: 2, mt: 2 }}>
            {medicinesLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={22} /> <Typography variant="body2">Loading inventory…</Typography>
              </Box>
            ) : (
              <>
                <ProductPickList
                  title="Recommended products order"
                  ids={cfg.recommendedMedicineIds}
                  options={activeMedicines}
                  onIdsChange={(recommendedMedicineIds) => setCfg((c) => ({ ...c, recommendedMedicineIds }))}
                  disabled={saving}
                />
                <ProductPickList
                  title="Featured products order"
                  ids={cfg.featuredMedicineIds}
                  options={activeMedicines}
                  onIdsChange={(featuredMedicineIds) => setCfg((c) => ({ ...c, featuredMedicineIds }))}
                  disabled={saving}
                />
              </>
            )}
          </Paper>

          <Box sx={{ mt: 2 }}>
            <Button variant="contained" onClick={onSave} disabled={saving} sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              {saving ? (
                <>
                  <CircularProgress size={18} color="inherit" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
};
