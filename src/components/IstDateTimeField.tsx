import React from 'react';
import { SxProps, Theme } from '@mui/material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import {
  istDateTimeLocalFromNaiveDate,
  naiveDateFromIstDateTimeLocal,
} from '../utils/dateTime';

type IstDateTimeFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  sx?: SxProps<Theme>;
};

export const IstDateTimeField: React.FC<IstDateTimeFieldProps> = ({
  label,
  value,
  onChange,
  disabled,
  sx,
}) => {
  const parsed = value ? naiveDateFromIstDateTimeLocal(value) : null;

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <DateTimePicker
        label={label}
        value={parsed}
        onChange={(next) => {
          onChange(next ? istDateTimeLocalFromNaiveDate(next) : '');
        }}
        disabled={disabled}
        ampm={false}
        format="dd MMM yyyy, HH:mm"
        minutesStep={1}
        closeOnSelect={false}
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
