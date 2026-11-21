import React from 'react';
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { SELLING_FIRMS } from '../constants/sellingFirms';

export const SellingFirmField: React.FC<{
  value: string;
  onChange: (firmId: string) => void;
  disabled?: boolean;
  label?: string;
}> = ({ value, onChange, disabled, label = 'Firm' }) => (
  <FormControl fullWidth size="small" sx={{ mb: 2 }}>
    <InputLabel>{label}</InputLabel>
    <Select
      label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(String(event.target.value))}
    >
      {SELLING_FIRMS.map((firm) => (
        <MenuItem key={firm.id} value={firm.id}>
          {firm.label}
        </MenuItem>
      ))}
    </Select>
  </FormControl>
);

/** List filter. "All firms" leaves the current list unchanged. */
export const SellingFirmFilterField: React.FC<{
  value: string;
  onChange: (firmId: string) => void;
}> = ({ value, onChange }) => (
  <FormControl size="small" sx={{ minWidth: 220 }}>
    <InputLabel>Firm</InputLabel>
    <Select label="Firm" value={value} onChange={(event) => onChange(String(event.target.value))}>
      <MenuItem value="All">All firms</MenuItem>
      {SELLING_FIRMS.map((firm) => (
        <MenuItem key={firm.id} value={firm.id}>
          {firm.label}
        </MenuItem>
      ))}
    </Select>
  </FormControl>
);
