import React, { useMemo } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { Badge, Box, Button, Chip, MenuItem, Paper, Tab, Tabs, TextField, Typography } from '@mui/material';
import { Settings } from '@mui/icons-material';
import { useGstPeriodParam } from '../../hooks/useGstPeriod';
import { useGstHealthReport, useGstPeriodRecord, useMarkGstPeriodStatus } from '../../hooks/useGst';
import { useAuth } from '../../context/AuthContext';
import { useAppDialog } from '../../context/AppDialogProvider';
import { gstPeriodParam, periodIsLocked } from '../../utils/gstPeriod';
import type { GstPeriodStatus } from '../../types/gst';

const TABS = [
  { label: 'Overview', path: '/gst', badgeKey: 'legacy' as const },
  { label: 'GSTR-1', path: '/gst/gstr-1', badgeKey: 'gstr1' as const },
  { label: 'GSTR-3B', path: '/gst/gstr-3b', badgeKey: 'none' as const },
  { label: 'ITC / GSTR-2B', path: '/gst/itc', badgeKey: 'itc' as const },
  { label: 'E-invoice', path: '/gst/e-invoice', badgeKey: 'none' as const },
];

const YEARS = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 4 + i);
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function statusColor(status: GstPeriodStatus): 'default' | 'success' | 'warning' | 'info' {
  if (status === 'open') return 'info';
  if (status === 'gstr3b_filed') return 'success';
  if (status === 'gstr1_filed' || status === 'gstr1_ready') return 'warning';
  return 'default';
}

export const GstWorkspace: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const { alert, confirm, prompt } = useAppDialog();
  const { year, month, date, meta, setPeriod } = useGstPeriodParam();
  const periodQuery = useGstPeriodRecord(date);
  const healthQuery = useGstHealthReport(date);
  const markStatus = useMarkGstPeriodStatus(date);
  const writable = canWrite('gst');
  const status = periodQuery.data?.status || 'open';
  const periodQs = `?period=${gstPeriodParam(year, month)}`;

  const tabValue =
    TABS.find((tab) =>
      tab.path === '/gst' ? location.pathname === '/gst' : location.pathname.startsWith(tab.path)
    )?.path || '/gst';

  const badges = useMemo(() => {
    const report = healthQuery.data;
    const legacy =
      (report?.legacyInvoicesThisPeriod ?? 0) +
      (report?.legacyCreditNotesThisPeriod ?? 0) +
      (report?.legacyDebitNotesThisPeriod ?? 0) +
      (report?.legacyPurchaseInvoicesThisPeriod ?? 0);
    return {
      legacy,
      gstr1: report?.legacyInvoicesThisPeriod ?? 0,
      itc: report?.legacyPurchaseInvoicesThisPeriod ?? 0,
    };
  }, [healthQuery.data]);

  const handleStatus = async (next: GstPeriodStatus) => {
    const labels: Record<GstPeriodStatus, string> = {
      open: 'Reopen this period for backfill?',
      locked: 'Lock this period?',
      gstr1_ready: 'Mark GSTR-1 ready (lock backfill)?',
      gstr1_filed: 'Mark GSTR-1 as filed on the GST portal?',
      gstr3b_filed: 'Mark GSTR-3B as filed on the GST portal?',
    };
    const ok = await confirm(labels[next]);
    if (!ok) return;
    let arn: string | undefined;
    if (next === 'gstr1_filed' || next === 'gstr3b_filed') {
      const entered = await prompt('GST portal ARN (optional)', {
        placeholder: 'ARN',
        confirmLabel: 'Save',
      });
      if (entered === null) return;
      arn = entered.trim() || undefined;
    }
    try {
      await markStatus.mutateAsync({ status: next, arn });
      await alert('Period status updated.', { severity: 'success' });
    } catch (err) {
      await alert(err instanceof Error ? err.message : 'Could not update period', { severity: 'error' });
    }
  };

  const tabLabel = (tab: (typeof TABS)[number]) => {
    const count = tab.badgeKey === 'none' ? 0 : badges[tab.badgeKey];
    if (!count) return tab.label;
    return (
      <Badge color="warning" badgeContent={count} max={999} sx={{ pr: 1 }}>
        {tab.label}
      </Badge>
    );
  };

  return (
    <Box>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <Typography variant="h6" sx={{ mr: 1 }}>
            {meta.label}
          </Typography>
          <TextField
            select
            size="small"
            label="Month"
            value={month}
            onChange={(e) => setPeriod(year, Number(e.target.value))}
            sx={{ minWidth: 140 }}
          >
            {MONTHS.map((label, idx) => (
              <MenuItem key={label} value={idx + 1}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Year"
            value={year}
            onChange={(e) => setPeriod(Number(e.target.value), month)}
            sx={{ minWidth: 100 }}
          >
            {YEARS.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </TextField>
          <Chip size="small" label={status.replace(/_/g, ' ')} color={statusColor(status)} />
          {periodQuery.data?.gstr1Arn ? (
            <Typography variant="caption" color="text.secondary">
              GSTR-1 ARN {periodQuery.data.gstr1Arn}
            </Typography>
          ) : null}
          {periodQuery.data?.gstr3bArn ? (
            <Typography variant="caption" color="text.secondary">
              GSTR-3B ARN {periodQuery.data.gstr3bArn}
            </Typography>
          ) : null}
          {periodIsLocked(status) ? (
            <Button size="small" disabled={!writable} onClick={() => void handleStatus('open')}>
              Reopen
            </Button>
          ) : (
            <Button size="small" disabled={!writable} onClick={() => void handleStatus('gstr1_ready')}>
              Lock period
            </Button>
          )}
          {status === 'gstr1_ready' ? (
            <Button size="small" disabled={!writable} onClick={() => void handleStatus('gstr1_filed')}>
              Mark GSTR-1 filed
            </Button>
          ) : null}
          {status === 'gstr1_filed' ? (
            <Button size="small" disabled={!writable} onClick={() => void handleStatus('gstr3b_filed')}>
              Mark GSTR-3B filed
            </Button>
          ) : null}
          <Box sx={{ flexGrow: 1 }} />
          <Button
            size="small"
            startIcon={<Settings />}
            onClick={() => navigate(`/gst/settings${periodQs}`)}
          >
            Settings
          </Button>
        </Box>
        <Tabs
          value={tabValue}
          sx={{ mt: 1 }}
          onChange={(_e, path: string) => navigate(`${path}${periodQs}`)}
        >
          {TABS.map((tab) => (
            <Tab
              key={tab.path}
              value={tab.path}
              label={tabLabel(tab)}
              component={RouterLink}
              to={`${tab.path}${periodQs}`}
            />
          ))}
        </Tabs>
      </Paper>
      {children}
    </Box>
  );
};
