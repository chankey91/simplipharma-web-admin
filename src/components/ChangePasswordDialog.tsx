import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  Typography,
  CircularProgress,
  Link,
  IconButton,
  Box,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import {
  auth,
  changeUserPassword,
  getAuthErrorMessage,
  sendPasswordReset,
} from '../services/firebase';

type Mode = 'reset' | 'change';

type ChangePasswordDialogProps = {
  open: boolean;
  mode: Mode;
  defaultEmail?: string;
  /** Must change password before continuing (first login / mustResetPassword). */
  required?: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onLogout?: () => void;
};

export const ChangePasswordDialog: React.FC<ChangePasswordDialogProps> = ({
  open,
  mode,
  defaultEmail = '',
  required = false,
  onClose,
  onSuccess,
  onLogout,
}) => {
  const [email, setEmail] = useState(defaultEmail);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(defaultEmail || auth.currentUser?.email || '');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setSuccess('');
    }
  }, [open, defaultEmail, mode]);

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    setLoading(true);
    try {
      const { message } = await sendPasswordReset(email);
      setSuccess(message);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSendResetToSignedInUser = async () => {
    const accountEmail = auth.currentUser?.email;
    if (!accountEmail) {
      setError('No email on your account.');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const { message } = await sendPasswordReset(accountEmail);
      setSuccess(`${message} Use the link in your email, then sign in again.`);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await changeUserPassword(currentPassword, newPassword);
      setSuccess('Password updated successfully.');
      onSuccess?.();
      setTimeout(() => onClose(), 600);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'reset' ? 'Reset password' : required ? 'Set a new password' : 'Change password';

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ position: 'relative', pr: 6 }}>
        <Box component="span" sx={{ display: 'block', pr: 4 }}>
          {title}
        </Box>
        <IconButton
          aria-label="Close"
          onClick={handleClose}
          disabled={loading}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <Close />
        </IconButton>
      </DialogTitle>
      <form onSubmit={mode === 'reset' ? handleResetSubmit : handleChangeSubmit}>
        <DialogContent>
          {mode === 'reset' ? (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Enter your account email. We will send a reset link from SimpliPharma (same email as store
                invitations).
              </Typography>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </>
          ) : (
            <>
              {required && !success && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  You must set a new password before continuing, or log out.
                </Typography>
              )}
              {!success && (
                <>
                  <TextField
                    fullWidth
                    label="Current password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    margin="normal"
                    required
                    autoComplete="current-password"
                    autoFocus
                  />
                  <TextField
                    fullWidth
                    label="New password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    margin="normal"
                    required
                    autoComplete="new-password"
                    helperText="At least 6 characters"
                  />
                  <TextField
                    fullWidth
                    label="Confirm new password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    margin="normal"
                    required
                    autoComplete="new-password"
                  />
                  {auth.currentUser?.email && (
                    <Link
                      component="button"
                      type="button"
                      variant="body2"
                      onClick={handleSendResetToSignedInUser}
                      disabled={loading}
                      sx={{ mt: 1, display: 'inline-block' }}
                    >
                      Forgot current password? Send reset link to {auth.currentUser.email}
                    </Link>
                  )}
                </>
              )}
            </>
          )}
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ mt: 2 }}>
              {success}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={handleClose} disabled={loading}>
            Close
          </Button>
          {required && !success && onLogout && (
            <Button onClick={onLogout} disabled={loading} color="inherit">
              Log out
            </Button>
          )}
          {!success && (
            <Button type="submit" variant="contained" disabled={loading} sx={{ ml: 'auto' }}>
              {loading ? (
                <CircularProgress size={22} color="inherit" />
              ) : mode === 'reset' ? (
                'Send reset link'
              ) : (
                'Update password'
              )}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
};
