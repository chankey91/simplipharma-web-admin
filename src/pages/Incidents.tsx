import React, { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAppDialog } from '../context/AppDialogProvider';
import { useAreaManagers } from '../hooks/useAreaManagers';
import { usePurchaseOfficers } from '../hooks/usePurchaseOfficers';
import { useSalesOfficers } from '../hooks/useSalesOfficers';
import { useStores } from '../hooks/useStores';
import { Loading } from '../components/Loading';
import {
  addIncidentComment,
  closeIncident,
  createIncident,
  INCIDENT_SUBJECT_LABEL,
  incidentTimeLabel,
  listIncidentComments,
  listIncidents,
  type Incident,
  type IncidentPriority,
  type IncidentSubjectType,
} from '../services/incidents';
import type { User } from '../types';

const SUBJECT_TYPES: IncidentSubjectType[] = [
  'retailer',
  'salesOfficer',
  'areaManager',
  'purchaseOfficer',
];

function personName(user: User | undefined, fallback: string): string {
  if (!user) return fallback;
  return user.shopName || user.displayName || user.email || fallback;
}

function isSubjectType(value: string | null): value is IncidentSubjectType {
  return SUBJECT_TYPES.includes(value as IncidentSubjectType);
}

export const IncidentsPage: React.FC = () => {
  const { panelRole } = useAuth();
  const { alert } = useAppDialog();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const canClose = panelRole === 'admin';

  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [typeFilter, setTypeFilter] = useState<IncidentSubjectType | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [form, setForm] = useState({
    subjectType: 'retailer' as IncidentSubjectType,
    subjectId: '',
    title: '',
    details: '',
    priority: 'normal' as IncidentPriority,
  });

  const incidentsQuery = useQuery({
    queryKey: ['incidents'],
    queryFn: listIncidents,
  });
  const { data: stores = [] } = useStores();
  const { data: salesOfficers = [] } = useSalesOfficers();
  const { data: areaManagers = [] } = useAreaManagers();
  const { data: purchaseOfficers = [] } = usePurchaseOfficers();

  const people = useMemo(() => {
    if (form.subjectType === 'retailer') return stores;
    if (form.subjectType === 'salesOfficer') return salesOfficers;
    if (form.subjectType === 'areaManager') return areaManagers;
    return purchaseOfficers;
  }, [form.subjectType, stores, salesOfficers, areaManagers, purchaseOfficers]);

  const soById = useMemo(() => new Map(salesOfficers.map((user) => [user.id, user])), [salesOfficers]);

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const subjectType = searchParams.get('subjectType');
    const subjectId = searchParams.get('subjectId') || '';
    setForm((prev) => ({
      ...prev,
      subjectType: isSubjectType(subjectType) ? subjectType : prev.subjectType,
      subjectId,
    }));
    setCreateOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    next.delete('subjectType');
    next.delete('subjectId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const rows = useMemo(() => {
    return (incidentsQuery.data ?? []).filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (typeFilter !== 'all' && row.subjectType !== typeFilter) return false;
      return true;
    });
  }, [incidentsQuery.data, statusFilter, typeFilter]);

  const selected = (incidentsQuery.data ?? []).find((row) => row.id === selectedId) ?? null;

  const commentsQuery = useQuery({
    queryKey: ['incidentComments', selectedId],
    queryFn: () => listIncidentComments(selectedId!),
    enabled: Boolean(selectedId),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const person = people.find((user) => user.id === form.subjectId);
      if (!person) throw new Error('Choose who this incident is about');
      const name = personName(person, 'Person');
      let salesOfficerId = '';
      let areaManagerId = '';
      let purchaseOfficerId = '';
      if (form.subjectType === 'retailer') {
        salesOfficerId = person.salesOfficerId || '';
        areaManagerId = salesOfficerId ? soById.get(salesOfficerId)?.areaManagerId || '' : '';
      } else if (form.subjectType === 'salesOfficer') {
        salesOfficerId = person.id;
        areaManagerId = person.areaManagerId || '';
      } else if (form.subjectType === 'areaManager') {
        areaManagerId = person.id;
      } else {
        purchaseOfficerId = person.id;
      }
      return createIncident({
        subjectType: form.subjectType,
        subjectId: person.id,
        subjectName: name,
        subjectCode: person.storeCode,
        salesOfficerId,
        areaManagerId,
        purchaseOfficerId,
        title: form.title,
        details: form.details,
        priority: form.priority,
        raisedByRole: panelRole || 'admin',
      });
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['incidents'] });
      setSelectedId(id);
      setCreateOpen(false);
      setForm({ subjectType: 'retailer', subjectId: '', title: '', details: '', priority: 'normal' });
    },
    onError: (error: unknown) => {
      void alert(error instanceof Error ? error.message : 'Could not create the incident', { severity: 'error' });
    },
  });

  const replyMutation = useMutation({
    mutationFn: () => addIncidentComment(selectedId!, reply, panelRole || 'admin'),
    onSuccess: async () => {
      setReply('');
      await queryClient.invalidateQueries({ queryKey: ['incidentComments', selectedId] });
    },
    onError: (error: unknown) => {
      void alert(error instanceof Error ? error.message : 'Could not send the reply', { severity: 'error' });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => closeIncident(selectedId!, closeNote),
    onSuccess: async () => {
      setCloseOpen(false);
      setCloseNote('');
      await queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
    onError: (error: unknown) => {
      void alert(error instanceof Error ? error.message : 'Could not close the incident', { severity: 'error' });
    },
  });

  if (incidentsQuery.isLoading) return <Loading message="Loading incidents..." />;
  if (incidentsQuery.isError) {
    return <Typography color="error">Could not load incidents.</Typography>;
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2} flexWrap="wrap" mb={2}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Incidents
          </Typography>
          <Typography variant="body2" color="text.secondary">
            A retailer incident is shown to that shop&apos;s sales officer and area manager. A purchase officer sees
            incidents about them and can reply. Only an admin can close an incident.
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => setCreateOpen(true)}>
          New incident
        </Button>
      </Box>

      <Box display="flex" gap={1} flexWrap="wrap" mb={2}>
        {(['open', 'closed', 'all'] as const).map((status) => (
          <Chip
            key={status}
            label={status === 'all' ? 'All' : status === 'open' ? 'Open' : 'Closed'}
            color={statusFilter === status ? 'primary' : 'default'}
            onClick={() => setStatusFilter(status)}
          />
        ))}
        <Chip
          label="All people"
          color={typeFilter === 'all' ? 'primary' : 'default'}
          variant={typeFilter === 'all' ? 'filled' : 'outlined'}
          onClick={() => setTypeFilter('all')}
        />
        {SUBJECT_TYPES.map((type) => (
          <Chip
            key={type}
            label={INCIDENT_SUBJECT_LABEL[type]}
            variant={typeFilter === type ? 'filled' : 'outlined'}
            color={typeFilter === type ? 'primary' : 'default'}
            onClick={() => setTypeFilter(type)}
          />
        ))}
      </Box>

      <Box display="flex" gap={2} alignItems="flex-start" flexWrap="wrap">
        <Paper variant="outlined" sx={{ flex: '1 1 360px', maxHeight: 640, overflow: 'auto' }}>
          {rows.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              No incidents in this view.
            </Typography>
          ) : (
            rows.map((row) => (
              <IncidentRow
                key={row.id}
                row={row}
                selected={row.id === selectedId}
                onClick={() => setSelectedId(row.id)}
              />
            ))
          )}
        </Paper>

        <Paper variant="outlined" sx={{ flex: '2 1 420px', p: 2, minHeight: 320 }}>
          {!selected ? (
            <Typography color="text.secondary">Select an incident.</Typography>
          ) : (
            <>
              <Box display="flex" justifyContent="space-between" gap={1} flexWrap="wrap">
                <Box>
                  <Typography variant="h6">{selected.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {INCIDENT_SUBJECT_LABEL[selected.subjectType]} · {selected.subjectName}
                    {selected.subjectCode ? ` (${selected.subjectCode})` : ''} · raised by {selected.raisedByName} (
                    {selected.raisedByRole})
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {incidentTimeLabel(selected.createdAt)}
                  </Typography>
                </Box>
                <Box display="flex" gap={1} alignItems="center">
                  <Chip size="small" label={selected.priority === 'urgent' ? 'Urgent' : 'Normal'} color={selected.priority === 'urgent' ? 'error' : 'default'} />
                  <Chip size="small" label={selected.status === 'open' ? 'Open' : 'Closed'} color={selected.status === 'open' ? 'warning' : 'success'} />
                </Box>
              </Box>
              <Typography sx={{ my: 2, whiteSpace: 'pre-wrap' }}>{selected.details}</Typography>
              {selected.status === 'closed' ? (
                <Typography variant="body2" sx={{ mb: 2 }}>
                  Closed by {selected.closedByName || 'admin'}: {selected.closeNote}
                </Typography>
              ) : null}

              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Replies
              </Typography>
              {(commentsQuery.data ?? []).length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  No replies yet.
                </Typography>
              ) : (
                (commentsQuery.data ?? []).map((comment) => (
                  <Box key={comment.id} sx={{ mb: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {comment.authorName} · {comment.authorRole} · {incidentTimeLabel(comment.createdAt)}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {comment.text}
                    </Typography>
                  </Box>
                ))
              )}

              {selected.status === 'open' ? (
                <Box display="flex" gap={1} alignItems="flex-start" flexWrap="wrap">
                  <TextField
                    size="small"
                    label="Reply"
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    fullWidth
                    multiline
                    minRows={2}
                  />
                  <Button
                    variant="contained"
                    disabled={replyMutation.isPending || !reply.trim()}
                    onClick={() => replyMutation.mutate()}
                  >
                    Send
                  </Button>
                  {canClose ? (
                    <Button variant="outlined" color="error" onClick={() => setCloseOpen(true)}>
                      Close
                    </Button>
                  ) : null}
                </Box>
              ) : null}
            </>
          )}
        </Paper>
      </Box>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New incident</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>About</InputLabel>
              <Select
                label="About"
                value={form.subjectType}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    subjectType: event.target.value as IncidentSubjectType,
                    subjectId: '',
                  }))
                }
              >
                {SUBJECT_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>
                    {INCIDENT_SUBJECT_LABEL[type]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Autocomplete
              options={people}
              value={people.find((person) => person.id === form.subjectId) ?? null}
              onChange={(_, value) => setForm((prev) => ({ ...prev, subjectId: value?.id || '' }))}
              getOptionLabel={(person) =>
                `${personName(person, person.id)}${person.storeCode ? ` (${person.storeCode})` : ''}`
              }
              renderInput={(params) => <TextField {...params} label="Person" size="small" />}
            />
            <TextField
              label="Subject"
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              fullWidth
            />
            <TextField
              label="Details"
              value={form.details}
              onChange={(event) => setForm((prev) => ({ ...prev, details: event.target.value }))}
              fullWidth
              multiline
              minRows={3}
            />
            <FormControl fullWidth size="small">
              <InputLabel>Priority</InputLabel>
              <Select
                label="Priority"
                value={form.priority}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, priority: event.target.value as IncidentPriority }))
                }
              >
                <MenuItem value="normal">Normal</MenuItem>
                <MenuItem value="urgent">Urgent</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={closeOpen} onClose={() => setCloseOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Close incident</DialogTitle>
        <DialogContent>
          <TextField
            label="Closing note"
            value={closeNote}
            onChange={(event) => setCloseNote(event.target.value)}
            fullWidth
            multiline
            minRows={3}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCloseOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={closeMutation.isPending || !closeNote.trim()}
            onClick={() => closeMutation.mutate()}
          >
            Close incident
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

function IncidentRow({
  row,
  selected,
  onClick,
}: {
  row: Incident;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        p: 1.5,
        cursor: 'pointer',
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: selected ? 'action.selected' : 'transparent',
      }}
    >
      <Box display="flex" justifyContent="space-between" gap={1}>
        <Typography variant="body2" fontWeight={700}>
          {row.title}
        </Typography>
        <Chip size="small" label={row.status === 'open' ? 'Open' : 'Closed'} />
      </Box>
      <Typography variant="caption" color="text.secondary">
        {INCIDENT_SUBJECT_LABEL[row.subjectType]} · {row.subjectName} · {row.raisedByRole}
      </Typography>
    </Box>
  );
}
