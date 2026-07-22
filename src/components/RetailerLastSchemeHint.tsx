import React, { useState } from 'react';
import { Box, Divider, IconButton, Popover, Tooltip, Typography } from '@mui/material';
import { CardGiftcard } from '@mui/icons-material';
import {
  formatLastRetailerSchemeHint,
  getLastRetailerSchemeDetailRows,
  type LastRetailerScheme,
} from '../utils/retailerLastScheme';

type Props = {
  lastScheme?: LastRetailerScheme;
  size?: 'small' | 'medium';
  /** Popover eyebrow — defaults to retailer order wording. */
  contextLabel?: string;
  /** Empty-state when no history. */
  emptyHint?: string;
  /** Used in tooltip summary, e.g. "this store" / "this vendor". */
  subjectLabel?: string;
};

/**
 * Prior-line hint: hover summary, click for scheme + discount + pricing.
 * Used on Order Details (retailer) and Purchase Invoice (vendor).
 */
export const RetailerLastSchemeHint: React.FC<Props> = ({
  lastScheme,
  size = 'small',
  contextLabel = 'Previous order (same store · same item)',
  emptyHint = 'No prior order for this store on this item',
  subjectLabel = 'this store',
}) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const hasHistory = !!lastScheme;
  const hint = formatLastRetailerSchemeHint(lastScheme, {
    subject: subjectLabel,
    emptyHint,
  });
  const rows = hasHistory
    ? getLastRetailerSchemeDetailRows(lastScheme)
    : [{ label: 'History', value: emptyHint }];

  return (
    <>
      <Tooltip title={hint} arrow enterDelay={300}>
        <IconButton
          size={size}
          onClick={(e) => {
            e.stopPropagation();
            setAnchor(e.currentTarget);
          }}
          color={hasHistory ? 'secondary' : 'default'}
          sx={{
            p: 0.25,
            opacity: hasHistory ? 1 : 0.45,
          }}
          aria-label="Previous pricing history"
        >
          <CardGiftcard fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={(e) => e.stopPropagation()}
      >
        <Box sx={{ p: 1.5, minWidth: 260, maxWidth: 340 }}>
          <Typography variant="caption" color="text.secondary" display="block">
            {contextLabel}
          </Typography>
          {lastScheme?.medicineName ? (
            <Typography variant="subtitle2" sx={{ mt: 0.5, mb: 1 }}>
              {lastScheme.medicineName}
            </Typography>
          ) : (
            <Box sx={{ mb: 1 }} />
          )}
          <Divider sx={{ mb: 1 }} />
          {rows.map((row) => (
            <Box
              key={row.label}
              display="flex"
              justifyContent="space-between"
              gap={2}
              sx={{ py: 0.35 }}
            >
              <Typography variant="caption" color="text.secondary">
                {row.label}
              </Typography>
              <Typography variant="body2" fontWeight={500} textAlign="right">
                {row.value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Popover>
    </>
  );
};
