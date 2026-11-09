import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { UploadFile } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { useVendors } from '../hooks/useVendors';
import { useAppDialog } from '../context/AppDialogProvider';
import { parsePurchaseOrderExcel, type PurchaseOrderExcelLine } from '../utils/purchaseOrderDraftExcel';
import {
  buildDraftGroups,
  findMedicinesByProductIds,
  listOpenPurchaseOrderDrafts,
  savePurchaseOrderDrafts,
  type PurchaseOrderDraft,
  type PurchaseOrderDraftLine,
} from '../services/purchaseOrderDrafts';

type DraftGroup = {
  vendorName: string;
  vendorId?: string;
  lines: PurchaseOrderDraftLine[];
};

function lineCount(draft: PurchaseOrderDraft, matched: boolean): number {
  return draft.lines.filter((line) => Boolean(line.medicineId) === matched).length;
}

export const PurchaseOrderDraftsPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { alert } = useAppDialog();
  const { data: vendors = [] } = useVendors();
  const draftsQuery = useQuery({
    queryKey: ['purchaseOrderDrafts'],
    queryFn: listOpenPurchaseOrderDrafts,
  });
  const [fileName, setFileName] = useState('');
  const [parsedLines, setParsedLines] = useState<PurchaseOrderExcelLine[] | null>(null);
  const [medicines, setMedicines] = useState<Awaited<ReturnType<typeof findMedicinesByProductIds>> | null>(null);
  const [reading, setReading] = useState(false);
  const preview = useMemo<DraftGroup[] | null>(() => {
    if (!parsedLines || !medicines) return null;
    return buildDraftGroups(parsedLines, vendors, medicines);
  }, [parsedLines, medicines, vendors]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!preview?.length) throw new Error('Choose an Excel file first');
      await savePurchaseOrderDrafts(preview, fileName);
    },
    onSuccess: async () => {
      setParsedLines(null);
      setMedicines(null);
      setFileName('');
      await queryClient.invalidateQueries({ queryKey: ['purchaseOrderDrafts'] });
      await alert('Drafts saved. Stock is unchanged until you save the real purchase bill.', { severity: 'success' });
    },
    onError: (error: unknown) => {
      void alert(error instanceof Error ? error.message : 'Could not save the drafts', { severity: 'error' });
    },
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setParsedLines(null);
    setMedicines(null);
    try {
      setFileName(file.name);
      const lines = parsePurchaseOrderExcel(await file.arrayBuffer());
      if (!lines.length) throw new Error('No rows found under the header.');
      setParsedLines(lines);
      setMedicines(await findMedicinesByProductIds(lines.map((line) => line.productId)));
    } catch (error) {
      setFileName('');
      await alert(error instanceof Error ? error.message : 'Could not read the Excel file', { severity: 'error' });
    } finally {
      setReading(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
            Purchase order drafts
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Upload the Excel you send to a vendor before the bill arrives. Each product id is matched to a
            medicine. The draft keeps the medicine name and quantity only. Stock, price, and batch are filled
            when the real bill is saved.
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => navigate('/purchases')} sx={{ flexShrink: 0 }}>
          Purchase invoices
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        The first sheet needs columns named Product ID and Quantity. Vendor and item name are used when those
        columns are present.
      </Alert>

      <Button variant="contained" component="label" startIcon={<UploadFile />} disabled={reading} sx={{ mb: 2 }}>
        {reading ? 'Reading…' : 'Choose Excel'}
        <input
          hidden
          type="file"
          accept=".xlsx,.xls"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void onFile(file);
          }}
        />
      </Button>

      {preview ? (
        <Box sx={{ mb: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h6">{fileName}</Typography>
            <Button variant="contained" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? 'Saving…' : 'Save drafts'}
            </Button>
          </Stack>
          {preview.map((group) => (
            <DraftTable
              key={`${group.vendorId || group.vendorName}`}
              title={group.vendorId ? group.vendorName : `${group.vendorName} (vendor not matched)`}
              lines={group.lines}
            />
          ))}
        </Box>
      ) : null}

      <Typography variant="h6" sx={{ mb: 1 }}>
        Open drafts
      </Typography>
      {draftsQuery.isLoading ? <Loading message="Loading drafts..." /> : null}
      {draftsQuery.isError ? <Typography color="error">Could not load drafts.</Typography> : null}
      {(draftsQuery.data ?? []).length === 0 && !draftsQuery.isLoading ? (
        <Typography color="text.secondary">No open drafts.</Typography>
      ) : null}
      {(draftsQuery.data ?? []).map((draft) => (
        <Paper key={draft.id} variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} sx={{ mb: 1 }}>
            <Box>
              <Typography fontWeight={700}>{draft.vendorName}</Typography>
              <Typography variant="body2" color="text.secondary">
                {lineCount(draft, true)} matched · {lineCount(draft, false)} not in catalog
                {draft.vendorId ? '' : ' · vendor not matched'}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              disabled={!draft.vendorId || lineCount(draft, true) === 0}
              onClick={() => navigate(`/purchases/new?orderDraft=${encodeURIComponent(draft.id)}`)}
            >
              Create bill
            </Button>
          </Stack>
          <DraftTable title="" lines={draft.lines} />
        </Paper>
      ))}
    </Box>
  );
};

function DraftTable({
  title,
  lines,
}: {
  title: string;
  lines: PurchaseOrderDraft['lines'];
}) {
  return (
    <Box sx={{ mb: 2 }}>
      {title ? (
        <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
          {title}
        </Typography>
      ) : null}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Product ID</TableCell>
              <TableCell>Medicine</TableCell>
              <TableCell align="right">Quantity</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line, index) => (
              <TableRow key={`${line.productId}-${index}`}>
                <TableCell>{line.productId || '—'}</TableCell>
                <TableCell>
                  {line.medicineName || line.excelName || 'Not in catalog'}
                  {!line.medicineId ? ' · not matched' : ''}
                </TableCell>
                <TableCell align="right">{line.quantity || ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
