import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Link,
} from '@mui/material';
import { login, onAuthChange, getUserPanelRole } from '../services/firebase';
import { useNavigate } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import { ChangePasswordDialog } from '../components/ChangePasswordDialog';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthChange(async (user) => {
      if (user) {
        try {
          const role = await getUserPanelRole(user.uid);
          if (role) {
            navigate('/');
          }
        } catch (err) {
          console.error('Error checking panel access:', err);
        }
      }
    });

    return unsubscribe;
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const userCredential = await login(email, password);
      const role = await getUserPanelRole(userCredential.user.uid);

      if (role) {
        navigate('/');
      } else {
        setError('Access denied. Admin or operations privileges required.');
      }
    } catch (err: unknown) {
      console.error('Login error:', err);
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Paper sx={{ p: 4, width: '100%' }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <BrandLogo variant="horizontal" height={56} />
          </Box>
          <Typography variant="body2" align="center" color="textSecondary" sx={{ mb: 3 }}>
            Login to access the panel
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              margin="normal"
              required
              autoComplete="email"
            />
            <TextField
              fullWidth
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              margin="normal"
              required
              autoComplete="current-password"
            />
            <Box sx={{ textAlign: 'right', mt: 0.5 }}>
              <Link
                component="button"
                type="button"
                variant="body2"
                onClick={() => setResetOpen(true)}
                sx={{ cursor: 'pointer' }}
              >
                Forgot password?
              </Link>
            </Box>
            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
              disabled={loading}
            >
              {loading ? <CircularProgress size={24} /> : 'Login'}
            </Button>
          </form>
        </Paper>
      </Box>

      <ChangePasswordDialog
        open={resetOpen}
        mode="reset"
        defaultEmail={email}
        onClose={() => setResetOpen(false)}
      />
    </Container>
  );
};
