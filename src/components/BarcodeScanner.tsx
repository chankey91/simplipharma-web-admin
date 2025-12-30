import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  Box, 
  Button, 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  Typography,
  Alert,
  CircularProgress
} from '@mui/material';
import { QrCodeScanner, Close } from '@mui/icons-material';

interface QRCodeScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (qrCode: string) => void;
}

export const QRCodeScanner: React.FC<QRCodeScannerProps> = ({ open, onClose, onScan }) => {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerId = 'qr-code-scanner';

  useEffect(() => {
    if (open) {
      checkCameraPermission();
    } else {
      stopScanning();
    }
    
    return () => {
      stopScanning();
    };
  }, [open]);

  const checkCameraPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      setHasPermission(true);
      setError(null);
    } catch (err: any) {
      setHasPermission(false);
      setError('Camera permission denied. Please enable camera access in your browser settings.');
    }
  };

  const startScanning = async () => {
    if (!hasPermission) {
      await checkCameraPermission();
      if (!hasPermission) return;
    }

    try {
      setError(null);
      setScanning(true);
      
      const html5QrCode = new Html5Qrcode(scannerId);
      scannerRef.current = html5QrCode;
      
      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0
        },
        (decodedText) => {
          onScan(decodedText);
          stopScanning();
          onClose();
        },
        (errorMessage) => {
          // Ignore scanning errors (camera is still scanning)
        }
      );
    } catch (err: any) {
      console.error('Scanner error:', err);
      setError(err.message || 'Failed to start camera. Please check camera permissions.');
      setScanning(false);
    }
  };

  const stopScanning = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {
        // Ignore stop errors
      });
      scannerRef.current.clear();
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const handleClose = () => {
    stopScanning();
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">Scan QR Code</Typography>
          <Button onClick={handleClose} size="small">
            <Close />
          </Button>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ position: 'relative', width: '100%', minHeight: 300 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          
          {hasPermission === false && !error && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Camera permission is required to scan QR codes. Please enable camera access.
            </Alert>
          )}

          <div id={scannerId} style={{ width: '100%', display: scanning ? 'block' : 'none' }} />
          
          {!scanning && hasPermission && (
            <Box sx={{ textAlign: 'center', mt: 4 }}>
              <QrCodeScanner sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                Click the button below to start scanning
              </Typography>
              <Button
                variant="contained"
                startIcon={<QrCodeScanner />}
                onClick={startScanning}
              >
                Start Scanning
              </Button>
            </Box>
          )}

          {scanning && (
            <Box sx={{ textAlign: 'center', mt: 2 }}>
              <CircularProgress size={24} sx={{ mr: 1 }} />
              <Typography variant="body2" color="textSecondary">
                Scanning...
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        {!scanning && hasPermission && (
          <Button variant="contained" onClick={startScanning}>
            Start
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

