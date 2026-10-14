import React from 'react';
import { SxProps, Theme } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { istDateStringFromNaiveDate, naiveDateFromIstDateString } from '../utils/dateTime';

type IstDateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  sx?: SxProps<Theme>;
};

/** IST calendar-day picker (no time). Value is `yyyy-MM-dd`. */
export const IstDateField: React.FC<IstDateFieldProps> = ({
  label,
  value,
  onChange,
  disabled,
  sx,
}) => {
  const parsed = value ? naiveDateFromIstDateString(value) : null;

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <DatePicker
        label={label}
        value={parsed}
        onChange={(next) => {
          onChange(next ? istDateStringFromNaiveDate(next) : '');
        }}
        disabled={disabled}
        format="dd MMM yyyy"
        closeOnSelect
        slotProps={{
          textField: {
            size: 'small',
            sx,
          },
          actionBar: {
            actions: ['clear', 'accept'],
          },
          openPickerButton: {
            size: 'small',
          },
        }}
      />
    </LocalizationProvider>
  );
};
