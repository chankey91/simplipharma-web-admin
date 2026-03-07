import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
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

const SCANNER_ID = 'qr-code-scanner';

export const QRCodeScanner: React.FC<QRCodeScannerProps> = ({ open, onClose, onScan }) => {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startRequestedRef = useRef(false);

  useEffect(() => {
    if (open) {
      checkCameraPermission();
    } else {
      stopScanning();
      startRequestedRef.current = false;
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

    setError(null);
    startRequestedRef.current = true;
    setScanning(true);
  };

  // Start scanner after DOM has updated (div is visible with dimensions)
  useEffect(() => {
    if (!open || !scanning || !startRequestedRef.current) return;

    const initScanner = async () => {
      const element = document.getElementById(SCANNER_ID);
      if (!element) return;

      try {
        // Use ZXing decoder - BarcodeDetector API can have QR code issues on some browsers
        const html5QrCode = new Html5Qrcode(SCANNER_ID, {
          verbose: false,
          experimentalFeatures: { useBarCodeDetectorIfSupported: false },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.ITF,
          ],
        });
        scannerRef.current = html5QrCode;

        // Dynamic qrbox: square for QR codes, uses ~80% of viewport width
        const qrboxFunction = (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const qrboxSize = Math.floor(minEdge * 0.8);
          return { width: qrboxSize, height: qrboxSize };
        };

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            qrbox: qrboxFunction,
          },
          (decodedText) => {
            console.log('✅ Barcode/QR scanned successfully:', decodedText);
            onScan(decodedText);
            stopScanning();
            onClose();
          },
          () => {
            // Ignore scan failures (continuous scanning)
          }
        );
      } catch (err: any) {
        console.error('❌ Scanner error:', err);
        setError(err.message || 'Failed to start camera. Please check camera permissions.');
        setScanning(false);
      }
    };

    // Small delay to ensure the scanner div is visible and has layout
    const timer = setTimeout(initScanner, 100);
    return () => clearTimeout(timer);
  }, [open, scanning, onScan, onClose]);

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
          <Typography variant="h6">Scan Barcode / QR Code</Typography>
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
              Camera permission is required to scan barcodes/QR codes. Please enable camera access.
            </Alert>
          )}

          <div
            id={SCANNER_ID}
            style={{
              width: '100%',
              minHeight: 300,
              display: scanning ? 'block' : 'none',
            }}
          />
          
          {!scanning && hasPermission && (
            <Box sx={{ textAlign: 'center', mt: 4 }}>
              <QrCodeScanner sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Click the button below to start scanning
              </Typography>
              <Typography variant="caption" color="textSecondary" sx={{ mb: 2, display: 'block' }}>
                Supports: QR codes, EAN-13, Code-128, and other common barcode formats
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
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Scanning...
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Position the barcode horizontally within the scanning area
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

