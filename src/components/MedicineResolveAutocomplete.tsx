import React from 'react';
import { Box, Chip, Typography } from '@mui/material';
import type { AutocompleteRenderGroupParams, AutocompleteRenderOptionState } from '@mui/material';
import type { MedicineResolveOption } from '../services/medicineResolution';

/** Section header + divider between pending / demands / inventory. */
export function renderMedicineResolveGroup(params: AutocompleteRenderGroupParams) {
  return (
    <li key={params.key}>
      <Box
        component="div"
        sx={{
          position: 'sticky',
          top: -8,
          zIndex: 1,
          px: 1.5,
          py: 0.75,
          bgcolor: 'grey.100',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" fontWeight={700} color="text.secondary">
          {params.group}
        </Typography>
      </Box>
      <Box component="ul" sx={{ p: 0, m: 0 }}>
        {params.children}
      </Box>
    </li>
  );
}

export function renderMedicineResolveOption(
  props: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key },
  option: MedicineResolveOption,
  _state: AutocompleteRenderOptionState
) {
  const { key, ...rest } = props;
  return (
    <Box
      component="li"
      key={key}
      {...rest}
      sx={{
        opacity: option.selectable || option.demand ? 1 : 0.75,
        alignItems: 'flex-start !important',
        py: 1,
      }}
    >
      <Box flex={1} minWidth={0}>
        <Typography variant="body2" noWrap>
          {option.label}
        </Typography>
        {option.group === 'pending_order' ? (
          <Chip label="Pending order" size="small" color="warning" sx={{ mt: 0.5, height: 20 }} />
        ) : null}
        {option.group === 'product_demand' ? (
          <Chip
            label="Product demand — click to add medicine"
            size="small"
            color="info"
            variant="outlined"
            sx={{ mt: 0.5, height: 20 }}
          />
        ) : null}
      </Box>
    </Box>
  );
}
