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
  Link,
} from '@mui/material';
import {
  CheckCircle,
  Cancel,
  Visibility,
  Refresh,
} from '@mui/icons-material';
import { usePendingRetailerRequests, useApproveRetailerRequest, useRejectRetailerRequest } from '../hooks/usePendingRetailers';
import { Loading } from '../components/Loading';
import { RetailerRegistrationRequest, resolveRegistrationImageUrls } from '../services/pendingRetailers';
import { format } from 'date-fns';

/** Preview registration upload (HTTPS, Storage URL, or data:image base64). */
const RegistrationDocImage: React.FC<{ label: string; url?: string }> = ({ label, url }) => {
  const [failed, setFailed] = useState(false);
  if (!url) {
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="caption" display="block" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Not uploaded
        </Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" display="block" color="text.secondary">
        {label}
      </Typography>
      {failed ? (
        <Alert severity="warning" sx={{ mt: 0.5 }}>
          Could not load preview (often Storage rules or expired link).{' '}
          <Link href={url} target="_blank" rel="noopener noreferrer">
            Open in new tab
          </Link>
        </Alert>
      ) : (
        <Card sx={{ maxWidth: 320, mt: 0.5 }}>
          <CardMedia
            component="img"
            height={180}
            image={url}
            alt={label}
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            onError={() => setFailed(true)}
            sx={{ cursor: 'pointer', objectFit: 'contain', bgcolor: 'action.hover' }}
          />
        </Card>
      )}
    </Box>
  );
};

export const PendingRetailersPage: React.FC = () => {
  const { data: requests, isLoading, error, refetch } = usePendingRetailerRequests();
  const approveMutation = useApproveRetailerRequest();
  const rejectMutation = useRejectRetailerRequest();
  const [selectedRequest, setSelectedRequest] = useState<RetailerRegistrationRequest | null>(null);

  const handleApprove = async (req: RetailerRegistrationRequest) => {
    if (!confirm('Have you verified all details and documents? The retailer account will be activated.')) return;
    try {
      const { emailSent, emailError } = await approveMutation.mutateAsync(req.id);
      if (emailSent) {
        alert('Retailer approved successfully. Login details were sent to their email.');
      } else {
        alert(
          'Retailer approved and account created, but the email could not be sent.\n' +
            (emailError ? `Reason: ${emailError}\n` : '') +
            'Share the temporary password manually and check Firebase Functions logs / SMTP config.'
        );
      }
      setSelectedRequest(null);
    } catch (err: any) {
      alert(err.message || 'Failed to approve');
    }
  };

  const handleReject = async (req: RetailerRegistrationRequest) => {
    const reason = prompt('Optional: Enter reason for rejection');
    try {
      await rejectMutation.mutateAsync({ requestId: req.id, reason: reason || '' });
      alert('Request rejected');
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
                <TableCell>{req.email || req.retailerEmail || '—'}</TableCell>
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
        {selectedRequest && (
          <>
            <DialogTitle>Verify Retailer Request</DialogTitle>
            <DialogContent>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">Details</Typography>
                  <Box sx={{ mt: 1 }}>
                    <Typography>
                      <strong>Email:</strong> {selectedRequest.email || selectedRequest.retailerEmail || '—'}
                    </Typography>
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
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    Documents
                  </Typography>
                  {(() => {
                    const urls = resolveRegistrationImageUrls(
                      selectedRequest as unknown as Record<string, unknown>
                    );
                    const anyDoc = urls.shop || urls.licence || urls.aadhar;
                    return (
                      <Box>
                        {!anyDoc && (
                          <Alert severity="info" sx={{ mb: 1 }}>
                            No document URLs found on this request. The mobile app may use different field names;
                            check Firestore for this document or confirm uploads completed.
                          </Alert>
                        )}
                        <RegistrationDocImage
                          key={`${selectedRequest.id}-shop`}
                          label="Shop photo"
                          url={urls.shop}
                        />
                        <RegistrationDocImage
                          key={`${selectedRequest.id}-lic`}
                          label="Drug licence"
                          url={urls.licence}
                        />
                        <RegistrationDocImage
                          key={`${selectedRequest.id}-aadhar`}
                          label="Aadhar card"
                          url={urls.aadhar}
                        />
                      </Box>
                    );
                  })()}
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
