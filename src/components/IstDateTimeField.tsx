import React, { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  Box,
  Button,
  Divider,
  IconButton,
  InputAdornment,
  Popover,
  SxProps,
  TextField,
  Theme,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import {
  getTodayDateStringIST,
  istDateTimeLocalFromNaiveDate,
  naiveDateFromIstDateString,
  naiveDateFromIstDateTimeLocal,
} from '../utils/dateTime';

type Meridiem = 'AM' | 'PM';

type IstDateTimeFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** 12-hour date and time controls. Stored values stay `yyyy-MM-ddTHH:mm`. */
  ampm?: boolean;
  sx?: SxProps<Theme>;
};

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const QUICK_MINUTES = [0, 15, 30, 45, 59];

function toMeridiemParts(date: Date): { hour12: number; minute: number; meridiem: Meridiem } {
  const hour24 = date.getHours();
  return {
    hour12: hour24 % 12 || 12,
    minute: date.getMinutes(),
    meridiem: hour24 >= 12 ? 'PM' : 'AM',
  };
}

function hour24From12(hour12: number, meridiem: Meridiem): number {
  if (meridiem === 'AM') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function defaultDay(): Date {
  return naiveDateFromIstDateString(getTodayDateStringIST()) ?? new Date();
}

const AmpmDateTimeField: React.FC<IstDateTimeFieldProps> = ({
  label,
  value,
  onChange,
  disabled,
  sx,
}) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [minuteDraft, setMinuteDraft] = useState<string | null>(null);
  const today = useMemo(() => defaultDay(), []);
  const parsed = value ? naiveDateFromIstDateTimeLocal(value) : null;
  const selected = parsed ? toMeridiemParts(parsed) : null;

  const commit = (patch: {
    date?: Date;
    hour12?: number;
    minute?: number;
    meridiem?: Meridiem;
  }) => {
    const base = parsed ?? today;
    const parts = toMeridiemParts(parsed ?? base);
    const day = patch.date ?? base;
    const next = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      hour24From12(patch.hour12 ?? parts.hour12, patch.meridiem ?? parts.meridiem),
      patch.minute ?? parts.minute,
      0,
      0
    );
    onChange(istDateTimeLocalFromNaiveDate(next));
  };

  const flushMinute = () => {
    if (minuteDraft == null || minuteDraft === '') {
      setMinuteDraft(null);
      return;
    }
    const minute = Number(minuteDraft);
    if (minute <= 59) commit({ minute });
    setMinuteDraft(null);
  };

  const close = () => {
    flushMinute();
    setOpen(false);
  };

  return (
    <>
      <TextField
        ref={anchorRef}
        label={label}
        size="small"
        value={parsed ? format(parsed, 'd MMM yyyy, h:mm a') : ''}
        placeholder="Choose date and time"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        sx={
          [
            { '& input': { cursor: disabled ? 'default' : 'pointer' } },
            ...(sx ? [sx] : []),
          ] as SxProps<Theme>
        }
        InputProps={{
          readOnly: true,
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                size="small"
                edge="end"
                disabled={disabled}
                aria-label={`Choose ${label} date and time`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!disabled) setOpen(true);
                }}
              >
                <CalendarMonthIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        }}
        inputProps={{
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
        }}
      />
      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, maxWidth: '100vw' }}>
          <LocalizationProvider dateAdapter={AdapterDateFns}>
            <DateCalendar
              value={parsed}
              referenceDate={parsed ?? today}
              onChange={(next) => {
                if (next) commit({ date: next });
              }}
            />
          </LocalizationProvider>
          <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
          <Divider sx={{ display: { sm: 'none' } }} />
          <Box sx={{ px: 2, py: 1.5, width: { xs: 320, sm: 248 } }}>
          <Typography variant="caption" color="text.secondary">
            Hour
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 0.5,
              mt: 0.5,
            }}
          >
            {HOURS.map((hour) => (
              <Button
                key={hour}
                size="small"
                variant={selected?.hour12 === hour ? 'contained' : 'outlined'}
                onClick={() => commit({ hour12: hour })}
                sx={{ minWidth: 0 }}
              >
                {hour}
              </Button>
            ))}
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }}>
            Minute
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 0.5,
              mt: 0.5,
            }}
          >
            {QUICK_MINUTES.map((minute) => (
              <Button
                key={minute}
                size="small"
                variant={selected?.minute === minute ? 'contained' : 'outlined'}
                onClick={() => {
                  setMinuteDraft(null);
                  commit({ minute });
                }}
                sx={{ minWidth: 0, px: 0 }}
              >
                {String(minute).padStart(2, '0')}
              </Button>
            ))}
          </Box>
          <TextField
            size="small"
            fullWidth
            placeholder="Other minute"
            value={
              minuteDraft ??
              (selected && !QUICK_MINUTES.includes(selected.minute)
                ? String(selected.minute).padStart(2, '0')
                : '')
            }
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, '').slice(0, 2);
              setMinuteDraft(digits);
              if (digits.length === 2 && Number(digits) <= 59) commit({ minute: Number(digits) });
            }}
            onBlur={flushMinute}
            sx={{ mt: 0.5 }}
            inputProps={{ inputMode: 'numeric', 'aria-label': `${label} minute` }}
          />

          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={selected?.meridiem ?? null}
            onChange={(_, next: Meridiem | null) => {
              if (next) commit({ meridiem: next });
            }}
            sx={{
              mt: 1.5,
              '& .MuiToggleButton-root.Mui-selected': {
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                '&:hover': { bgcolor: 'primary.dark' },
              },
            }}
          >
            <ToggleButton value="AM">AM</ToggleButton>
            <ToggleButton value="PM">PM</ToggleButton>
          </ToggleButtonGroup>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5 }}>
            <Button
              size="small"
              onClick={() => {
                setMinuteDraft(null);
                onChange('');
              }}
            >
              Clear
            </Button>
            <Button size="small" variant="contained" onClick={close}>
              Done
            </Button>
          </Box>
          </Box>
        </Box>
      </Popover>
    </>
  );
};

const ClockDateTimeField: React.FC<IstDateTimeFieldProps> = ({
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
        views={['year', 'month', 'day', 'hours', 'minutes']}
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

export const IstDateTimeField: React.FC<IstDateTimeFieldProps> = (props) =>
  props.ampm ? <AmpmDateTimeField {...props} /> : <ClockDateTimeField {...props} />;
