import React from 'react';
import { TableCell, TableSortLabel, type TableCellProps } from '@mui/material';
import type { SortDirection } from '../utils/tableSort';

type Props = {
  columnId: string;
  label: string;
  sortKey: string;
  sortDirection: SortDirection;
  onRequestSort: (columnId: string) => void;
} & Pick<TableCellProps, 'align' | 'width'>;

export const SortableTableHeadCell: React.FC<Props> = ({
  columnId,
  label,
  sortKey,
  sortDirection,
  onRequestSort,
  align,
  width,
}) => (
  <TableCell align={align} width={width} sortDirection={sortKey === columnId ? sortDirection : false}>
    <TableSortLabel
      active={sortKey === columnId}
      direction={sortKey === columnId ? sortDirection : 'asc'}
      onClick={() => onRequestSort(columnId)}
    >
      {label}
    </TableSortLabel>
  </TableCell>
);
