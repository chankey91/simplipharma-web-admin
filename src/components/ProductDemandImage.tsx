import React, { useState } from 'react';
import { Box, Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { Close, ImageNotSupported } from '@mui/icons-material';

type Props = {
  imageUrl?: string | null;
  alt?: string;
  size?: number;
  /** When true, show a muted placeholder icon if no image is available. */
  showPlaceholder?: boolean;
};

const thumbSx = (size: number, clickable: boolean) => ({
  width: size,
  height: size,
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'divider',
  flexShrink: 0,
  ...(clickable ? { cursor: 'pointer' } : {}),
});

/** Thumbnail for retailer-submitted product-request photos; click to enlarge. */
export const ProductDemandImage: React.FC<Props> = ({
  imageUrl,
  alt = 'Product photo',
  size = 56,
  showPlaceholder = false,
}) => {
  const [open, setOpen] = useState(false);
  const src = imageUrl?.trim();

  if (!src) {
    if (!showPlaceholder) return null;
    return (
      <Box
        sx={{
          ...thumbSx(size, false),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'action.hover',
          color: 'text.disabled',
        }}
        title="No photo submitted"
      >
        <ImageNotSupported sx={{ fontSize: Math.round(size * 0.45) }} />
      </Box>
    );
  }

  return (
    <>
      <Box
        component="img"
        src={src}
        alt={alt}
        onClick={() => setOpen(true)}
        sx={{
          ...thumbSx(size, true),
          objectFit: 'cover',
        }}
      />
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          {alt}
          <IconButton
            aria-label="Close"
            onClick={() => setOpen(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box
            component="img"
            src={src}
            alt={alt}
            sx={{ width: '100%', maxHeight: '70vh', objectFit: 'contain' }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};
