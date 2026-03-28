import React, { useMemo, useState } from 'react';
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
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Grid,
  Card,
  CardMedia,
  Alert,
} from '@mui/material';
import {
  CheckCircle,
  Cancel,
  Visibility,
  Refresh,
} from '@mui/icons-material';
import { usePendingRetailerRequests, useApproveRetailerRequest, useRejectRetailerRequest } from '../hooks/usePendingRetailers';
import { Loading } from '../components/Loading';
import {
  RetailerRegistrationRequest,
  getRegistrationRequestImageUrls,
} from '../services/pendingRetailers';
import { format } from 'date-fns';

export const PendingRetailersPage: React.FC = () => {
  const { data: requests, isLoading, error, refetch } = usePendingRetailerRequests();
  const approveMutation = useApproveRetailerRequest();
  const rejectMutation = useRejectRetailerRequest();
  const [selectedRequest, setSelectedRequest] = useState<RetailerRegistrationRequest | null>(null);

  const detailImageUrls = useMemo(
    () =>
      selectedRequest
        ? getRegistrationRequestImageUrls(selectedRequest as unknown as Record<string, unknown>)
        : null,
    [selectedRequest]
  );
  const hasAnyRegistrationDoc = useMemo(
    () =>
      !!(
        detailImageUrls?.shopImageUrl ||
        detailImageUrls?.licenceImageUrl ||
        detailImageUrls?.aadharImageUrl
      ),
    [detailImageUrls]
  );

  const handleApprove = async (req: RetailerRegistrationRequest) => {
    if (!confirm('Have you verified all details and documents? The retailer account will be activated.')) return;
    try {
      await approveMutation.mutateAsync(req.id);
      alert('Retailer approved successfully! Account has been created and activated.');
      setSelectedRequest(null);
    } catch (err: any) {
      alert(err.message || 'Failed to approve');
    }
  };

  const handleReject = async (req: RetailerRegistrationRequest) => {
    const reason = prompt('Optional: Enter reason for rejection');
    try {
      const result = await rejectMutation.mutateAsync({ requestId: req.id, reason: reason || '' });
      const lines: string[] = ['Request rejected.'];
      if (result.retailerEmailSent === true) lines.push('Retailer was notified by email.');
      else if (result.retailerEmailSent === false) lines.push('Could not send email to the retailer (check SMTP / inbox).');
      else lines.push('No retailer email on file — retailer was not emailed.');
      if (result.salesOfficerEmailSent === true) lines.push('Sales Officer was notified by email.');
      else if (result.salesOfficerEmailSent === false) lines.push('Could not send email to the Sales Officer.');
      if (result.emailErrors) lines.push(result.emailErrors);
      alert(lines.join('\n'));
      setSelectedRequest(null);
    } catch (err: any) {
      alert(err.message || 'Failed to reject');
    }
  };

  const formatDate = (d: any) => {
    if (!d) return 'N/A';
    try {
      const date = d instanceof Date ? d : d?.toDate?.() || new Date(d);
      return format(date, 'dd MMM yyyy, HH:mm');
    } catch {
      return 'N/A';
    }
  };

  if (isLoading) return <Loading message="Loading pending requests..." />;
  if (error) return <Typography color="error">Failed to load pending requests</Typography>;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Pending Retailer Requests</Typography>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={() => refetch()}
        >
          Refresh
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Retailer registration requests submitted by Sales Officers. Verify details and documents, then approve or reject.
      </Typography>

      {requests?.length === 0 && (
        <Alert severity="success" sx={{ mb: 2 }}>
          No pending requests. All retailer registrations have been processed.
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name / Shop</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Licence</TableCell>
              <TableCell>Aadhar</TableCell>
              <TableCell>Submitted</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {requests?.map((req) => (
              <TableRow key={req.id} hover>
                <TableCell>
                  <Typography fontWeight={500}>{req.displayName || req.shopName || 'Unnamed'}</Typography>
                  {req.shopName && req.displayName && (
                    <Typography variant="body2" color="text.secondary">{req.shopName}</Typography>
                  )}
                </TableCell>
                <TableCell>{req.email}</TableCell>
                <TableCell>{req.licenceNumber || 'N/A'}</TableCell>
                <TableCell>{req.aadharNumber ? '***' + req.aadharNumber.slice(-4) : 'N/A'}</TableCell>
                <TableCell>{formatDate(req.createdAt)}</TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => setSelectedRequest(req)}
                    title="View & Verify"
                  >
                    <Visibility />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="success"
                    onClick={() => handleApprove(req)}
                    disabled={approveMutation.isPending}
                    title="Approve"
                  >
                    <CheckCircle />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleReject(req)}
                    disabled={rejectMutation.isPending}
                    title="Reject"
                  >
                    <Cancel />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        maxWidth="md"
        fullWidth
      >
        {selectedRequest && detailImageUrls && (
          <>
            <DialogTitle>Verify Retailer Request</DialogTitle>
            <DialogContent>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">Details</Typography>
                  <Box sx={{ mt: 1 }}>
                    <Typography><strong>Email:</strong> {selectedRequest.email}</Typography>
                    <Typography><strong>Name:</strong> {selectedRequest.displayName || selectedRequest.ownerName || 'N/A'}</Typography>
                    <Typography><strong>Shop:</strong> {selectedRequest.shopName || 'N/A'}</Typography>
                    <Typography><strong>Licence:</strong> {selectedRequest.licenceNumber || 'N/A'}</Typography>
                    <Typography><strong>Aadhar:</strong> {selectedRequest.aadharNumber ? '***' + selectedRequest.aadharNumber.slice(-4) : 'N/A'}</Typography>
                    <Typography><strong>Phone:</strong> {selectedRequest.phoneNumber || 'N/A'}</Typography>
                    <Typography><strong>Address:</strong> {selectedRequest.address || 'N/A'}</Typography>
                    {selectedRequest.location && (
                      <Typography><strong>Location:</strong> {selectedRequest.location.latitude?.toFixed(4)}, {selectedRequest.location.longitude?.toFixed(4)}</Typography>
                    )}
                    <Typography><strong>Submitted:</strong> {formatDate(selectedRequest.createdAt)}</Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Documents</Typography>
                  {!hasAnyRegistrationDoc && (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                      No photo URLs on this request. If documents were uploaded from the mobile app, ensure Firestore has
                      shopImageUrl / shopImage (and licence / aadhar fields). Storage path is usually{' '}
                      <code>retailer_docs/…</code>.
                    </Alert>
                  )}
                  <Grid container spacing={1}>
                    {detailImageUrls.shopImageUrl && (
                      <Grid item xs={12}>
                        <Typography variant="caption">Shop Photo</Typography>
                        <Card sx={{ maxWidth: 280, mt: 0.5 }}>
                          <CardMedia
                            component="img"
                            height="160"
                            image={detailImageUrls.shopImageUrl}
                            alt="Shop"
                            referrerPolicy="no-referrer"
                            onClick={() =>
                              window.open(detailImageUrls.shopImageUrl, '_blank', 'noopener,noreferrer')
                            }
                            sx={{ cursor: 'pointer', objectFit: 'cover' }}
                          />
                        </Card>
                      </Grid>
                    )}
                    {detailImageUrls.licenceImageUrl && (
                      <Grid item xs={12}>
                        <Typography variant="caption">Drug Licence</Typography>
                        <Card sx={{ maxWidth: 280, mt: 0.5 }}>
                          <CardMedia
                            component="img"
                            height="160"
                            image={detailImageUrls.licenceImageUrl}
                            alt="Licence"
                            referrerPolicy="no-referrer"
                            onClick={() =>
                              window.open(detailImageUrls.licenceImageUrl, '_blank', 'noopener,noreferrer')
                            }
                            sx={{ cursor: 'pointer', objectFit: 'cover' }}
                          />
                        </Card>
                      </Grid>
                    )}
                    {detailImageUrls.aadharImageUrl && (
                      <Grid item xs={12}>
                        <Typography variant="caption">Aadhar Card</Typography>
                        <Card sx={{ maxWidth: 280, mt: 0.5 }}>
                          <CardMedia
                            component="img"
                            height="160"
                            image={detailImageUrls.aadharImageUrl}
                            alt="Aadhar"
                            referrerPolicy="no-referrer"
                            onClick={() =>
                              window.open(detailImageUrls.aadharImageUrl, '_blank', 'noopener,noreferrer')
                            }
                            sx={{ cursor: 'pointer', objectFit: 'cover' }}
                          />
                        </Card>
                      </Grid>
                    )}
                  </Grid>
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedRequest(null)}>Close</Button>
              <Button
                color="error"
                variant="outlined"
                onClick={() => handleReject(selectedRequest)}
                disabled={rejectMutation.isPending}
              >
                Reject
              </Button>
              <Button
                color="success"
                variant="contained"
                onClick={() => handleApprove(selectedRequest)}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? 'Approving...' : 'Approve'}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};
