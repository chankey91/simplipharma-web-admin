import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Button,
  Chip,
  Divider,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  subscribeOpenSupportTickets,
  subscribeSupportThreadMessages,
  postAdminSupportReply,
  resolveSupportTicket,
  SupportTicketRow,
  SupportThreadMessage,
} from '../services/supportTickets';
import { useAppDialog } from '../context/AppDialogProvider';

function formatTime(v: SupportTicketRow['updatedAt']): string {
  if (!v) return '—';
  try {
    const d =
      v instanceof Date
        ? v
        : typeof (v as { toDate?: () => Date }).toDate === 'function'
          ? (v as { toDate: () => Date }).toDate()
          : null;
    if (d instanceof Date) return d.toLocaleString();
  } catch {
    /* noop */
  }
  return '—';
}

export const SupportTicketsPage: React.FC = () => {
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [selected, setSelected] = useState<SupportTicketRow | null>(null);
  const [messages, setMessages] = useState<SupportThreadMessage[]>([]);
  const [reply, setReply] = useState('');
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { alert, confirm, prompt } = useAppDialog();

  useEffect(() => {
    const unsub = subscribeOpenSupportTickets(
      (rows) => {
        setTickets(rows);
        setListError(null);
      },
      (e) => setListError(e.message)
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (!selected?.userId) {
      setMessages([]);
      return;
    }
    const unsub = subscribeSupportThreadMessages(
      selected.userId,
      (m) => setMessages(m),
      () => setMessages([])
    );
    return unsub;
  }, [selected?.userId]);

  useEffect(() => {
    if (!selected || tickets.length === 0) return;
    const still = tickets.find((t) => t.id === selected.id);
    if (!still) {
      setSelected(null);
    }
  }, [tickets, selected]);

  const onSend = async () => {
    if (!selected) return;
    try {
      setBusy(true);
      await postAdminSupportReply(selected.userId, selected.id, reply);
      setReply('');
    } catch (e: unknown) {
      await alert(e instanceof Error ? e.message : 'Failed to send', { severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const onResolve = async () => {
    if (!selected) return;
    if (!(await confirm('Mark this ticket resolved? The store will see a short notice in the app.'))) return;
    try {
      setBusy(true);
      await resolveSupportTicket(selected.userId, selected.id);
      setSelected(null);
    } catch (e: unknown) {
      await alert(e instanceof Error ? e.message : 'Failed to resolve', { severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const detailTitle = useMemo(() => {
    if (!selected) return '';
    return selected.userDisplayLabel || selected.userEmail || selected.userId;
  }, [selected]);

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Support inbox
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Open tickets from the mobile app. Replies appear in the app and are emailed to the store contact.
      </Typography>

      {listError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {listError}
        </Alert>
      ) : null}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Paper sx={{ width: 360, maxWidth: '100%', flexShrink: 0 }}>
          <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2">Open &amp; waiting</Typography>
          </Box>
          {!tickets.length ? (
            <Box sx={{ p: 3 }}>
              <Typography color="text.secondary" variant="body2">
                No active tickets.
              </Typography>
            </Box>
          ) : (
            <List dense disablePadding>
              {tickets.map((t) => (
                <React.Fragment key={t.id}>
                  <ListItemButton selected={selected?.id === t.id} onClick={() => setSelected(t)}>
                    <ListItemText
                      primary={t.userDisplayLabel || t.userEmail}
                      secondary={
                        <Typography component="span" variant="caption" display="block" color="text.secondary">
                          {t.subject}
                        </Typography>
                      }
                    />
                    <Chip label={t.status.replace('_', ' ')} size="small" sx={{ ml: 1 }} />
                  </ListItemButton>
                  <Divider component="li" />
                </React.Fragment>
              ))}
            </List>
          )}
        </Paper>

        <Paper sx={{ flex: 1, minWidth: 280, minHeight: 420, display: 'flex', flexDirection: 'column' }}>
          {!selected ? (
            <Box sx={{ p: 4 }}>
              <Typography color="text.secondary">Select a ticket to read messages and reply.</Typography>
            </Box>
          ) : (
            <>
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="subtitle1" fontWeight="bold">
                  {detailTitle}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selected.userEmail} · updated {formatTime(selected.updatedAt)}
                </Typography>
                <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    color="secondary"
                    variant="outlined"
                    onClick={onResolve}
                    disabled={busy}
                  >
                    Mark resolved
                  </Button>
                </Box>
              </Box>
              <Box sx={{ flex: 1, p: 2, overflow: 'auto', maxHeight: 360, bgcolor: 'grey.50' }}>
                {messages.map((m) => (
                  <Box
                    key={m.id}
                    sx={{
                      mb: 1.5,
                      display: 'flex',
                      justifyContent:
                        m.from === 'admin' ? 'flex-end' : m.from === 'user' ? 'flex-start' : 'center',
                    }}
                  >
                    <Paper
                      elevation={0}
                      sx={{
                        px: 1.5,
                        py: 1,
                        maxWidth: '85%',
                        bgcolor:
                          m.from === 'admin'
                            ? 'primary.main'
                            : m.from === 'user'
                              ? 'background.paper'
                              : 'grey.200',
                        color: m.from === 'admin' ? 'primary.contrastText' : 'text.primary',
                        border: m.from === 'user' ? 1 : 0,
                        borderColor: 'divider',
                      }}
                    >
                      <Typography variant="caption" sx={{ opacity: 0.85, display: 'block', mb: 0.5 }}>
                        {m.from === 'admin'
                          ? 'You (support)'
                          : m.from === 'user'
                            ? 'Customer'
                            : m.from === 'bot'
                              ? 'Assistant'
                              : 'System'}
                      </Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {m.text}
                      </Typography>
                    </Paper>
                  </Box>
                ))}
              </Box>
              <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  label="Reply"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Type a reply to send to the app and email…"
                  disabled={busy}
                />
                <Button
                  variant="contained"
                  onClick={onSend}
                  disabled={busy || !reply.trim()}
                  sx={{ alignSelf: 'flex-end' }}
                  startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
                >
                  Send reply
                </Button>
              </Box>
            </>
          )}
        </Paper>
      </Box>
    </Box>
  );
};
