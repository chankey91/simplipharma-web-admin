import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Android, ContentCopy, GetApp, Send } from '@mui/icons-material';
import { format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Loading } from '../components/Loading';
import { useAppDialog } from '../context/AppDialogProvider';
import { useStores } from '../hooks/useStores';
import {
  broadcastRetailerApkUpdate,
  formatApkSize,
  getApkBroadcasts,
  getRetailerApkRelease,
  uploadRetailerApk,
} from '../services/retailerApk';

export const RetailerAppPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { alert, confirm } = useAppDialog();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [versionName, setVersionName] = useState('');
  const [notes, setNotes] = useState('');
  const [broadcastNotes, setBroadcastNotes] = useState('');
  const [uploadProgress, setUploadProgress] = useState(false);

  const releaseQuery = useQuery({
    queryKey: ['retailerApkRelease'],
    queryFn: getRetailerApkRelease,
  });
  const broadcastsQuery = useQuery({
    queryKey: ['apkBroadcasts'],
    queryFn: () => getApkBroadcasts(20),
  });
  const { data: stores } = useStores();

  const activeRetailerCount = useMemo(
    () =>
      (stores ?? []).filter(
        (s) => s.isActive !== false && String(s.email || '').includes('@')
      ).length,
    [stores]
  );

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose an APK file');
      setUploadProgress(true);
      return uploadRetailerApk({ file, versionName, notes });
    },
    onSuccess: async (release) => {
      setFile(null);
      setVersionName(release.versionName);
      setNotes(release.notes);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await queryClient.invalidateQueries({ queryKey: ['retailerApkRelease'] });
      await alert(
        `APK v${release.versionName} is live. New retailer registration emails will include this download link.`,
        { severity: 'success' }
      );
    },
    onError: (err: unknown) => {
      void alert(err instanceof Error ? err.message : 'Upload failed');
    },
    onSettled: () => setUploadProgress(false),
  });

  const broadcastMutation = useMutation({
    mutationFn: () => broadcastRetailerApkUpdate(broadcastNotes),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['apkBroadcasts'] });
      await alert(
        `Update emailed to ${result.sentCount} of ${result.recipientCount} retailers` +
          (result.failCount ? ` (${result.failCount} failed)` : '') +
          `.`,
        { severity: result.failCount ? 'warning' : 'success' }
      );
    },
    onError: (err: unknown) => {
      void alert(err instanceof Error ? err.message : 'Broadcast failed');
    },
  });

  const release = releaseQuery.data;

  const handleCopyLink = async () => {
    if (!release?.downloadUrl) return;
    try {
      await navigator.clipboard.writeText(release.downloadUrl);
      await alert('Download link copied', { severity: 'success' });
    } catch {
      await alert(release.downloadUrl);
    }
  };

  const handleBroadcast = async () => {
    if (!release?.downloadUrl) {
      await alert('Upload an APK first');
      return;
    }
    const ok = await confirm(
      `Email APK v${release.versionName} to about ${activeRetailerCount || 'all'} active retailers?\n\nThis uses the current download link. It may take a few minutes.`
    );
    if (!ok) return;
    broadcastMutation.mutate();
  };

  if (releaseQuery.isLoading) return <Loading message="Loading retailer app…" />;

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Retailer app' }]} />
      <Typography variant="h5" gutterBottom>
        Retailer Android app
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Upload the latest APK. Registration emails include this download link. Use broadcast to
        email the same link to every active retailer when you ship an update.
      </Typography>

      {releaseQuery.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load the current APK. Deploy latest Firestore rules if this is a permission
          error.
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <Android color="primary" />
            <Typography variant="h6">Current APK</Typography>
            {release ? (
              <Chip size="small" color="success" label={`v${release.versionName}`} />
            ) : (
              <Chip size="small" label="Not uploaded" />
            )}
          </Box>
          {release ? (
            <>
              <Typography variant="body2" color="text.secondary">
                {release.fileName || 'retailer.apk'} · {formatApkSize(release.fileSize)}
                {release.uploadedAt
                  ? ` · ${format(release.uploadedAt, 'dd MMM yyyy HH:mm')}`
                  : ''}
              </Typography>
              {release.notes && (
                <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                  {release.notes}
                </Typography>
              )}
              <Box display="flex" gap={1} mt={2} flexWrap="wrap">
                <Button
                  variant="outlined"
                  startIcon={<GetApp />}
                  href={release.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download
                </Button>
                <Button startIcon={<ContentCopy />} onClick={() => void handleCopyLink()}>
                  Copy link
                </Button>
              </Box>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No APK yet. Registration emails will still say “Android app: Coming soon” until you
              upload one.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Upload new APK
        </Typography>
        <input
          ref={fileInputRef}
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          hidden
          onChange={(e) => {
            const next = e.target.files?.[0] || null;
            setFile(next);
            if (next && !versionName) {
              const fromName = next.name.replace(/\.apk$/i, '').replace(/[_-]+/g, '.');
              if (fromName) setVersionName(fromName.slice(0, 40));
            }
          }}
        />
        <Box display="flex" gap={2} flexWrap="wrap" alignItems="center" mb={2}>
          <Button variant="outlined" onClick={() => fileInputRef.current?.click()}>
            Choose APK
          </Button>
          <Typography variant="body2" color="text.secondary">
            {file ? `${file.name} (${formatApkSize(file.size)})` : 'No file selected'}
          </Typography>
        </Box>
        <TextField
          fullWidth
          label="Version"
          placeholder="1.4.0"
          value={versionName}
          onChange={(e) => setVersionName(e.target.value)}
          sx={{ mb: 2, maxWidth: 280 }}
        />
        <TextField
          fullWidth
          label="Release notes (optional)"
          placeholder="Bug fixes, faster order list…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          multiline
          rows={3}
          sx={{ mb: 2 }}
        />
        {(uploadMutation.isPending || uploadProgress) && <LinearProgress sx={{ mb: 2 }} />}
        <Button
          variant="contained"
          disabled={!file || !versionName.trim() || uploadMutation.isPending}
          onClick={() => uploadMutation.mutate()}
        >
          {uploadMutation.isPending ? 'Uploading…' : 'Publish APK'}
        </Button>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Broadcast update
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sends an email with the current download link to every active retailer (and SO accounts
          that are also a store). About {activeRetailerCount} recipients.
        </Typography>
        <TextField
          fullWidth
          label="Message in the email (optional)"
          placeholder="Leave blank to use the release notes from the APK"
          value={broadcastNotes}
          onChange={(e) => setBroadcastNotes(e.target.value)}
          multiline
          rows={3}
          sx={{ mb: 2 }}
        />
        <Button
          variant="contained"
          color="secondary"
          startIcon={broadcastMutation.isPending ? <CircularProgress size={18} /> : <Send />}
          disabled={!release?.downloadUrl || broadcastMutation.isPending}
          onClick={() => void handleBroadcast()}
        >
          {broadcastMutation.isPending ? 'Sending…' : 'Email all retailers'}
        </Button>
      </Paper>

      <Typography variant="h6" gutterBottom>
        Recent broadcasts
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>Version</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Sent</TableCell>
              <TableCell align="right">Failed</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(broadcastsQuery.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
                    No broadcasts yet
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              (broadcastsQuery.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {row.createdAt ? format(row.createdAt, 'dd MMM yyyy HH:mm') : '—'}
                  </TableCell>
                  <TableCell>v{row.versionName}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell align="right">
                    {row.sentCount}/{row.recipientCount}
                  </TableCell>
                  <TableCell align="right">{row.failCount}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};
