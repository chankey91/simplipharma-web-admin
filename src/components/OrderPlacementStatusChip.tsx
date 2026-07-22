import React from 'react';
import { Chip, Typography } from '@mui/material';
import { format } from 'date-fns';
import { isOrderBlockOverrideActive } from '../utils/retailerPaymentBlock';

type Props = {
  retailerId: string;
  overdue: boolean;
  overrideUntil?: Date | unknown;
  onGrantOverride: (retailerId: string) => void;
  disabled?: boolean;
};

/**
 * Shows Order blocked / Unlocked until… for payment-overdue retailers.
 * Click grants or extends a 6-hour admin unlock.
 */
export const OrderPlacementStatusChip: React.FC<Props> = ({
  retailerId,
  overdue,
  overrideUntil,
  onGrantOverride,
  disabled,
}) => {
  if (!overdue) {
    return (
      <Typography variant="caption" color="text.secondary">
        —
      </Typography>
    );
  }

  const unlocked = isOrderBlockOverrideActive(overrideUntil);
  if (unlocked && overrideUntil) {
    const until =
      overrideUntil instanceof Date
        ? overrideUntil
        : typeof (overrideUntil as { toDate?: () => Date })?.toDate === 'function'
          ? (overrideUntil as { toDate: () => Date }).toDate()
          : new Date(overrideUntil as string | number);
    const label = Number.isNaN(until.getTime())
      ? 'Unlocked 6h'
      : `Unlocked until ${format(until, 'h:mm a')}`;
    return (
      <Chip
        label={label}
        color="success"
        size="small"
        clickable={!disabled}
        onClick={
          disabled
            ? undefined
            : () => onGrantOverride(retailerId)
        }
        title="Click to extend unlock by another 6 hours"
        sx={{ cursor: disabled ? 'default' : 'pointer' }}
      />
    );
  }

  return (
    <Chip
      label="Order blocked"
      color="warning"
      size="small"
      clickable={!disabled}
      onClick={disabled ? undefined : () => onGrantOverride(retailerId)}
      title="Click to enable ordering for 6 hours"
      sx={{ cursor: disabled ? 'default' : 'pointer' }}
    />
  );
};
