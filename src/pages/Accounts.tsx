import React, { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add, Delete } from '@mui/icons-material';
import { format } from 'date-fns';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAppDialog } from '../context/AppDialogProvider';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import {
  useAccountLedgers,
  useAccountVouchers,
  useAccountVouchersUpTo,
  useCreateAccountLedger,
  useCreateAccountVoucher,
  useDeleteAccountVoucher,
  useUpdateAccountLedgerOpening,
} from '../hooks/useAccounts';
import { useVendors } from '../hooks/useVendors';
import { useStores } from '../hooks/useStores';
import { usePayablePurchaseInvoices } from '../hooks/usePurchaseInvoices';
import { useReceivableOrders } from '../hooks/useOrders';
import { buildAccountBook, expenseTotalsByLedger, type AccountBookResult } from '../utils/accountBooks';
import { defaultVendorLedgerDateRange, toLedgerDate } from '../utils/vendorLedger';
import type {
  AccountLedger,
  AccountLedgerType,
  AccountVoucher,
  AccountVoucherType,
  PaymentMethod,
  PurchaseInvoice,
  Order,
  User,
  Vendor,
} from '../types';

const toInputDate = (d: Date) => format(d, 'yyyy-MM-dd');

const parseInputDate = (value: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatCurrency = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const VOUCHER_LABEL: Record<AccountVoucherType, string> = {
  receipt: 'Receipt',
  payment: 'Payment',
  contra: 'Contra',
  expense: 'Expense',
};

const voucherChipColor = (
  type: AccountVoucherType
): 'success' | 'error' | 'info' | 'warning' => {
  if (type === 'receipt') return 'success';
  if (type === 'payment') return 'error';
  if (type === 'expense') return 'warning';
  return 'info';
};

const storeLabel = (s: User) =>
  s.shopName || [s.firstName, s.lastName].filter(Boolean).join(' ') || s.email || s.id;

const invoiceDue = (inv: PurchaseInvoice) =>
  Math.max(0, (Number(inv.totalAmount) || 0) - (Number(inv.paidAmount) || 0));

const orderDue = (order: Order) =>
  Math.max(0, (Number(order.totalAmount) || 0) - (Number(order.paidAmount) || 0));

const BookTable: React.FC<{ book: AccountBookResult }> = ({ book }) => (
  <Box>
    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={12} sm={4}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Opening
          </Typography>
          <Typography variant="h6">{formatCurrency(book.openingBalance)}</Typography>
        </Paper>
      </Grid>
      <Grid item xs={12} sm={4}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            In / Out
          </Typography>
          <Typography variant="h6">
            {formatCurrency(book.totalIn)} / {formatCurrency(book.totalOut)}
          </Typography>
        </Paper>
      </Grid>
      <Grid item xs={12} sm={4}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Closing
          </Typography>
          <Typography variant="h6">{formatCurrency(book.closingBalance)}</Typography>
        </Paper>
      </Grid>
    </Grid>
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Date</TableCell>
            <TableCell>Voucher</TableCell>
            <TableCell>Particulars</TableCell>
            <TableCell align="right">In</TableCell>
            <TableCell align="right">Out</TableCell>
            <TableCell align="right">Balance</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {book.lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6}>No entries in this period.</TableCell>
            </TableRow>
          ) : (
            book.lines.map((line, i) => (
              <TableRow key={`${line.voucherNo}-${i}`}>
                <TableCell>{format(line.date, 'dd MMM yyyy')}</TableCell>
                <TableCell>
                  <Chip size="small" label={VOUCHER_LABEL[line.voucherType]} color={voucherChipColor(line.voucherType)} />
                  <Typography variant="caption" display="block" color="text.secondary">
                    {line.voucherNo}
                  </Typography>
                </TableCell>
                <TableCell>{line.particulars}</TableCell>
                <TableCell align="right">{line.inflow ? formatCurrency(line.inflow) : '—'}</TableCell>
                <TableCell align="right">{line.outflow ? formatCurrency(line.outflow) : '—'}</TableCell>
                <TableCell align="right">{formatCurrency(line.balance)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  </Box>
);

type TabKey = 'daybook' | 'cash' | 'bank' | 'expenses' | 'ledgers';

export const AccountsPage: React.FC = () => {
  const { canWrite } = useAuth();
  const writable = canWrite('accounts');
  const { alert, confirm, prompt } = useAppDialog();
  const defaults = useMemo(() => defaultVendorLedgerDateRange(), []);
  const [fromDate, setFromDate] = useState(toInputDate(defaults.from));
  const [toDate, setToDate] = useState(toInputDate(defaults.to));
  const [tab, setTab] = useState<TabKey>('daybook');
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  const from = parseInputDate(fromDate);
  const to = parseInputDate(toDate);
  const datesValid = !!from && !!to && from <= to;

  const { data: ledgers, isLoading: ledgersLoading, error: ledgersError } = useAccountLedgers();
  const { data: vouchers, isLoading: vouchersLoading, error: vouchersError } = useAccountVouchers(
    from || defaults.from,
    to || defaults.to,
    datesValid
  );
  const { data: vouchersUpTo, isLoading: upToLoading } = useAccountVouchersUpTo(to || defaults.to, datesValid);
  const { data: vendors } = useVendors();
  const { data: stores } = useStores();
  const { data: payableInvoices } = usePayablePurchaseInvoices({ enabled: voucherOpen });
  const { data: receivableOrders } = useReceivableOrders({ enabled: voucherOpen });

  const createVoucher = useCreateAccountVoucher();
  const deleteVoucher = useDeleteAccountVoucher();
  const createLedger = useCreateAccountLedger();
  const updateOpening = useUpdateAccountLedgerOpening();

  const cashLedgers = useMemo(
    () => (ledgers ?? []).filter((l) => l.type === 'cash' && l.isActive !== false),
    [ledgers]
  );
  const bankLedgers = useMemo(
    () => (ledgers ?? []).filter((l) => l.type === 'bank' && l.isActive !== false),
    [ledgers]
  );
  const cashBankLedgers = useMemo(() => [...cashLedgers, ...bankLedgers], [cashLedgers, bankLedgers]);
  const expenseLedgers = useMemo(
    () => (ledgers ?? []).filter((l) => l.type === 'expense' && l.isActive !== false),
    [ledgers]
  );

  const [cashLedgerId, setCashLedgerId] = useState('');
  const [bankLedgerId, setBankLedgerId] = useState('');
  const selectedCash = cashLedgers.find((l) => l.id === cashLedgerId) || cashLedgers[0];
  const selectedBank = bankLedgers.find((l) => l.id === bankLedgerId) || bankLedgers[0];

  const cashBook = useMemo(() => {
    if (!selectedCash || !from || !to) return null;
    return buildAccountBook(selectedCash, vouchersUpTo ?? [], from, to);
  }, [selectedCash, vouchersUpTo, from, to]);

  const bankBook = useMemo(() => {
    if (!selectedBank || !from || !to) return null;
    return buildAccountBook(selectedBank, vouchersUpTo ?? [], from, to);
  }, [selectedBank, vouchersUpTo, from, to]);

  const expenseRows = useMemo(() => {
    if (!from || !to) return [];
    return expenseTotalsByLedger(vouchers ?? [], from, to);
  }, [vouchers, from, to]);

  const daybookTotals = useMemo(() => {
    const rows = vouchers ?? [];
    return {
      receipt: rows.filter((v) => v.voucherType === 'receipt').reduce((s, v) => s + v.amount, 0),
      payment: rows.filter((v) => v.voucherType === 'payment').reduce((s, v) => s + v.amount, 0),
      expense: rows.filter((v) => v.voucherType === 'expense').reduce((s, v) => s + v.amount, 0),
      contra: rows.filter((v) => v.voucherType === 'contra').reduce((s, v) => s + v.amount, 0),
    };
  }, [vouchers]);

  const handleDelete = async (voucher: AccountVoucher) => {
    if (voucher.linkedPurchaseInvoiceId || voucher.linkedOrderId) {
      await alert(
        'This voucher marked a bill or order paid. Reverse that payment from the invoice or order first.',
        { severity: 'warning' }
      );
      return;
    }
    const ok = await confirm(`Delete voucher ${voucher.voucherNo}?`, {
      title: 'Delete voucher',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteVoucher.mutateAsync(voucher.id);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      await alert(msg, { severity: 'error' });
    }
  };

  const handleOpening = async (ledger: AccountLedger) => {
    const next = await prompt(`Opening balance for ${ledger.name}`, {
      title: 'Opening balance',
      defaultValue: String(ledger.openingBalance ?? 0),
    });
    if (next == null) return;
    const value = Number(next);
    if (!Number.isFinite(value)) {
      await alert('Enter a valid number.', { severity: 'warning' });
      return;
    }
    try {
      await updateOpening.mutateAsync({ ledgerId: ledger.id, openingBalance: value });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      await alert(msg, { severity: 'error' });
    }
  };

  if (ledgersLoading && !ledgers) {
    return <Loading message="Loading accounts..." />;
  }

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Accounts' }]} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5">Accounts</Typography>
        {writable && (
          <Button variant="contained" startIcon={<Add />} onClick={() => setVoucherOpen(true)}>
            New voucher
          </Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Company cash and bank book. A payment or receipt voucher can also mark a purchase invoice or order paid — it is not
        counted twice.
      </Typography>

      {ledgersError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(ledgersError as Error).message || 'Could not load ledgers.'}
        </Alert>
      )}
      {vouchersError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(vouchersError as Error).message || 'Could not load vouchers.'}
        </Alert>
      )}
      {!writable && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You can view accounts. Ask an admin if you need to record vouchers.
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4} md={3}>
          <TextField
            label="From"
            type="date"
            size="small"
            fullWidth
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>
        <Grid item xs={12} sm={4} md={3}>
          <TextField
            label="To"
            type="date"
            size="small"
            fullWidth
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>
      </Grid>
      {!datesValid && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Choose a valid from / to date range.
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable">
        <Tab value="daybook" label="Day book" />
        <Tab value="cash" label="Cash" />
        <Tab value="bank" label="Bank" />
        <Tab value="expenses" label="Expenses" />
        <Tab value="ledgers" label="Ledgers" />
      </Tabs>

      {tab === 'daybook' && (
        <Box>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={6} sm={3}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="caption">Receipts</Typography>
                <Typography>{formatCurrency(daybookTotals.receipt)}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="caption">Payments</Typography>
                <Typography>{formatCurrency(daybookTotals.payment)}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="caption">Expenses</Typography>
                <Typography>{formatCurrency(daybookTotals.expense)}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="caption">Contra</Typography>
                <Typography>{formatCurrency(daybookTotals.contra)}</Typography>
              </Paper>
            </Grid>
          </Grid>
          {vouchersLoading ? (
            <Loading message="Loading day book..." />
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Account</TableCell>
                    <TableCell>Particulars</TableCell>
                    <TableCell>Linked</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    {writable && <TableCell align="right"> </TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(vouchers ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={writable ? 7 : 6}>No vouchers in this period.</TableCell>
                    </TableRow>
                  ) : (
                    (vouchers ?? []).map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>{format(toLedgerDate(v.date), 'dd MMM yyyy')}</TableCell>
                        <TableCell>
                          <Chip size="small" label={VOUCHER_LABEL[v.voucherType]} color={voucherChipColor(v.voucherType)} />
                          <Typography variant="caption" display="block" color="text.secondary">
                            {v.voucherNo}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {v.cashBankLedgerName}
                          {v.voucherType === 'contra' && v.contraLedgerName ? ` → ${v.contraLedgerName}` : ''}
                        </TableCell>
                        <TableCell>
                          {[v.partyName, v.categoryLedgerName, v.narration].filter(Boolean).join(' · ') || '—'}
                        </TableCell>
                        <TableCell>
                          {v.linkedPurchaseInvoiceId ? (
                            <Typography
                              component={RouterLink}
                              to={`/purchases/${v.linkedPurchaseInvoiceId}`}
                              variant="body2"
                              sx={{ textDecoration: 'none' }}
                            >
                              PI {v.linkedPurchaseInvoiceNumber || v.linkedPurchaseInvoiceId}
                            </Typography>
                          ) : null}
                          {v.linkedOrderId ? (
                            <Typography
                              component={RouterLink}
                              to={`/orders/${v.linkedOrderId}`}
                              variant="body2"
                              sx={{ textDecoration: 'none' }}
                            >
                              {v.linkedOrderNumber || v.linkedOrderId}
                            </Typography>
                          ) : null}
                          {!v.linkedPurchaseInvoiceId && !v.linkedOrderId ? '—' : null}
                        </TableCell>
                        <TableCell align="right">{formatCurrency(v.amount)}</TableCell>
                        {writable && (
                          <TableCell align="right">
                            <Tooltip title="Delete">
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={() => void handleDelete(v)}
                                  disabled={deleteVoucher.isPending}
                                >
                                  <Delete fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {tab === 'cash' && (
        <Box>
          {cashLedgers.length > 1 && (
            <FormControl size="small" sx={{ mb: 2, minWidth: 220 }}>
              <InputLabel>Cash account</InputLabel>
              <Select
                label="Cash account"
                value={selectedCash?.id || ''}
                onChange={(e) => setCashLedgerId(e.target.value)}
              >
                {cashLedgers.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {upToLoading ? <Loading message="Loading cash book..." /> : cashBook ? <BookTable book={cashBook} /> : <Alert severity="info">No cash ledger yet.</Alert>}
        </Box>
      )}

      {tab === 'bank' && (
        <Box>
          {bankLedgers.length > 1 && (
            <FormControl size="small" sx={{ mb: 2, minWidth: 220 }}>
              <InputLabel>Bank account</InputLabel>
              <Select
                label="Bank account"
                value={selectedBank?.id || ''}
                onChange={(e) => setBankLedgerId(e.target.value)}
              >
                {bankLedgers.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {upToLoading ? <Loading message="Loading bank book..." /> : bankBook ? <BookTable book={bankBook} /> : <Alert severity="info">No bank ledger yet.</Alert>}
        </Box>
      )}

      {tab === 'expenses' && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Ledger</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {expenseRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2}>No expenses in this period.</TableCell>
                </TableRow>
              ) : (
                expenseRows.map((row) => (
                  <TableRow key={row.ledgerId}>
                    <TableCell>{row.ledgerName}</TableCell>
                    <TableCell align="right">{formatCurrency(row.amount)}</TableCell>
                  </TableRow>
                ))
              )}
              {expenseRows.length > 0 && (
                <TableRow>
                  <TableCell>
                    <strong>Total</strong>
                  </TableCell>
                  <TableCell align="right">
                    <strong>{formatCurrency(expenseRows.reduce((s, r) => s + r.amount, 0))}</strong>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tab === 'ledgers' && (
        <Box>
          {writable && (
            <Button variant="outlined" startIcon={<Add />} sx={{ mb: 2 }} onClick={() => setLedgerOpen(true)}>
              New ledger
            </Button>
          )}
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Code</TableCell>
                  <TableCell align="right">Opening</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(ledgers ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.name}</TableCell>
                    <TableCell sx={{ textTransform: 'capitalize' }}>{l.type}</TableCell>
                    <TableCell>{l.code}</TableCell>
                    <TableCell align="right">
                      {formatCurrency(l.openingBalance || 0)}
                      {writable && (l.type === 'cash' || l.type === 'bank') && (
                        <Button size="small" sx={{ ml: 1 }} onClick={() => void handleOpening(l)}>
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      <VoucherDialog
        open={voucherOpen}
        onClose={() => setVoucherOpen(false)}
        cashBankLedgers={cashBankLedgers}
        expenseLedgers={expenseLedgers}
        vendors={vendors ?? []}
        stores={stores ?? []}
        payableInvoices={payableInvoices ?? []}
        receivableOrders={receivableOrders ?? []}
        pending={createVoucher.isPending}
        onSubmit={async (input) => {
          const result = await createVoucher.mutateAsync(input);
          if (result.linkWarnings.length) {
            await alert(result.linkWarnings.join('\n'), { severity: 'warning', title: 'Voucher saved' });
          }
          setVoucherOpen(false);
        }}
      />

      <LedgerDialog
        open={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
        pending={createLedger.isPending}
        onSubmit={async (input) => {
          await createLedger.mutateAsync(input);
          setLedgerOpen(false);
        }}
      />
    </Box>
  );
};

type VoucherFormSubmit = Parameters<
  ReturnType<typeof useCreateAccountVoucher>['mutateAsync']
>[0];

const VoucherDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  cashBankLedgers: AccountLedger[];
  expenseLedgers: AccountLedger[];
  vendors: Vendor[];
  stores: User[];
  payableInvoices: PurchaseInvoice[];
  receivableOrders: Order[];
  pending: boolean;
  onSubmit: (input: VoucherFormSubmit) => Promise<void>;
}> = ({
  open,
  onClose,
  cashBankLedgers,
  expenseLedgers,
  vendors,
  stores,
  payableInvoices,
  receivableOrders,
  pending,
  onSubmit,
}) => {
  const { alert } = useAppDialog();
  const [voucherType, setVoucherType] = useState<AccountVoucherType>('payment');
  const [date, setDate] = useState(toInputDate(new Date()));
  const [amount, setAmount] = useState('');
  const [cashBankLedgerId, setCashBankLedgerId] = useState('');
  const [contraLedgerId, setContraLedgerId] = useState('');
  const [categoryLedgerId, setCategoryLedgerId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [linkedPurchaseInvoiceId, setLinkedPurchaseInvoiceId] = useState('');
  const [linkedOrderId, setLinkedOrderId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [transactionId, setTransactionId] = useState('');
  const [narration, setNarration] = useState('');

  const cashBank = cashBankLedgers.find((l) => l.id === cashBankLedgerId) || cashBankLedgers[0];
  const vendor = vendors.find((v) => v.id === vendorId);
  const store = stores.find((s) => s.id === storeId);
  const vendorInvoices = payableInvoices.filter((inv) => !vendorId || inv.vendorId === vendorId);
  const storeOrders = receivableOrders.filter((o) => !storeId || o.retailerId === storeId);

  const reset = () => {
    setVoucherType('payment');
    setDate(toInputDate(new Date()));
    setAmount('');
    setCashBankLedgerId(cashBankLedgers[0]?.id || '');
    setContraLedgerId('');
    setCategoryLedgerId(expenseLedgers[0]?.id || '');
    setVendorId('');
    setStoreId('');
    setPartyName('');
    setLinkedPurchaseInvoiceId('');
    setLinkedOrderId('');
    setPaymentMethod('Cash');
    setTransactionId('');
    setNarration('');
  };

  const handleTypeChange = (next: AccountVoucherType) => {
    setVoucherType(next);
    setLinkedPurchaseInvoiceId('');
    setLinkedOrderId('');
    if (next !== 'payment') setVendorId('');
    if (next !== 'receipt') setStoreId('');
    if (next === 'expense' && !categoryLedgerId && expenseLedgers[0]) {
      setCategoryLedgerId(expenseLedgers[0].id);
    }
  };

  const handleInvoice = (inv: PurchaseInvoice | null) => {
    setLinkedPurchaseInvoiceId(inv?.id || '');
    if (!inv) return;
    setVendorId(inv.vendorId);
    setPartyName(inv.vendorName);
    const due = invoiceDue(inv);
    if (due > 0) setAmount(String(due));
  };

  const handleOrder = (order: Order | null) => {
    setLinkedOrderId(order?.id || '');
    if (!order) return;
    setStoreId(order.retailerId);
    const storeRow = stores.find((s) => s.id === order.retailerId);
    setPartyName(storeRow ? storeLabel(storeRow) : order.retailerName || order.retailerId);
    const due = orderDue(order);
    if (due > 0) setAmount(String(due));
  };

  const handleSave = async () => {
    const parsedDate = parseInputDate(date);
    const parsedAmount = Number(amount);
    if (!parsedDate) {
      await alert('Enter a valid date.', { severity: 'warning' });
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      await alert('Amount must be greater than 0.', { severity: 'warning' });
      return;
    }
    if (!cashBank) {
      await alert('Select a Cash or Bank account.', { severity: 'warning' });
      return;
    }
    try {
      await onSubmit({
        voucherType,
        date: parsedDate,
        amount: parsedAmount,
        cashBankLedgerId: cashBank.id,
        contraLedgerId: voucherType === 'contra' ? contraLedgerId || undefined : undefined,
        categoryLedgerId:
          voucherType === 'expense' || (voucherType === 'payment' && categoryLedgerId)
            ? categoryLedgerId || undefined
            : undefined,
        partyType:
          voucherType === 'payment'
            ? 'vendor'
            : voucherType === 'receipt'
              ? 'retailer'
              : undefined,
        partyId: voucherType === 'payment' ? vendorId || undefined : voucherType === 'receipt' ? storeId || undefined : undefined,
        partyName:
          voucherType === 'payment'
            ? vendor?.vendorName || partyName || undefined
            : voucherType === 'receipt'
              ? store
                ? storeLabel(store)
                : partyName || undefined
              : partyName || undefined,
        paymentMethod,
        transactionId: transactionId.trim() || undefined,
        narration: narration.trim() || undefined,
        linkedPurchaseInvoiceId:
          voucherType === 'payment' ? linkedPurchaseInvoiceId || undefined : undefined,
        linkedOrderId: voucherType === 'receipt' ? linkedOrderId || undefined : undefined,
      });
      reset();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      await alert(msg, { severity: 'error' });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={pending ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      TransitionProps={{ onEnter: reset }}
    >
      <DialogTitle>New voucher</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select
                label="Type"
                value={voucherType}
                onChange={(e) => handleTypeChange(e.target.value as AccountVoucherType)}
              >
                <MenuItem value="payment">Payment (pay vendor / party)</MenuItem>
                <MenuItem value="receipt">Receipt (collect from store)</MenuItem>
                <MenuItem value="expense">Expense (salary, rent…)</MenuItem>
                <MenuItem value="contra">Contra (cash ↔ bank)</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Date"
              type="date"
              size="small"
              fullWidth
              value={date}
              onChange={(e) => setDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Amount"
              size="small"
              fullWidth
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputProps={{ inputMode: 'decimal' }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth size="small">
              <InputLabel>{voucherType === 'contra' ? 'From' : 'Cash / Bank'}</InputLabel>
              <Select
                label={voucherType === 'contra' ? 'From' : 'Cash / Bank'}
                value={cashBank?.id || ''}
                onChange={(e) => {
                  setCashBankLedgerId(e.target.value);
                  const next = cashBankLedgers.find((l) => l.id === e.target.value);
                  setPaymentMethod(next?.type === 'cash' ? 'Cash' : 'Online');
                }}
              >
                {cashBankLedgers.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          {voucherType === 'contra' && (
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel>To</InputLabel>
                <Select
                  label="To"
                  value={contraLedgerId}
                  onChange={(e) => setContraLedgerId(e.target.value)}
                >
                  {cashBankLedgers
                    .filter((l) => l.id !== cashBank?.id)
                    .map((l) => (
                      <MenuItem key={l.id} value={l.id}>
                        {l.name}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>
          )}
          {(voucherType === 'expense' || voucherType === 'payment') && (
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel>{voucherType === 'expense' ? 'Expense ledger' : 'Category (optional)'}</InputLabel>
                <Select
                  label={voucherType === 'expense' ? 'Expense ledger' : 'Category (optional)'}
                  value={categoryLedgerId}
                  onChange={(e) => setCategoryLedgerId(e.target.value)}
                >
                  {voucherType === 'payment' && <MenuItem value="">None</MenuItem>}
                  {expenseLedgers.map((l) => (
                    <MenuItem key={l.id} value={l.id}>
                      {l.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
          {voucherType === 'payment' && (
            <>
              <Grid item xs={12}>
                <Autocomplete
                  options={vendors.filter((v) => v.isActive !== false)}
                  getOptionLabel={(v) => v.vendorName}
                  value={vendor || null}
                  onChange={(_, v) => {
                    setVendorId(v?.id || '');
                    setPartyName(v?.vendorName || '');
                    if (v && linkedPurchaseInvoiceId) {
                      const inv = payableInvoices.find((i) => i.id === linkedPurchaseInvoiceId);
                      if (inv && inv.vendorId !== v.id) setLinkedPurchaseInvoiceId('');
                    }
                  }}
                  renderInput={(params) => <TextField {...params} size="small" label="Vendor" />}
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  options={vendorInvoices}
                  getOptionLabel={(inv) =>
                    `${inv.invoiceNumber} · ${inv.vendorName} · due ${formatCurrency(invoiceDue(inv))}`
                  }
                  value={payableInvoices.find((i) => i.id === linkedPurchaseInvoiceId) || null}
                  onChange={(_, inv) => handleInvoice(inv)}
                  renderInput={(params) => (
                    <TextField {...params} size="small" label="Mark purchase invoice paid (optional)" />
                  )}
                />
              </Grid>
            </>
          )}
          {voucherType === 'receipt' && (
            <>
              <Grid item xs={12}>
                <Autocomplete
                  options={stores.filter((s) => s.isActive !== false)}
                  getOptionLabel={storeLabel}
                  value={store || null}
                  onChange={(_, s) => {
                    setStoreId(s?.id || '');
                    setPartyName(s ? storeLabel(s) : '');
                    if (s && linkedOrderId) {
                      const order = receivableOrders.find((o) => o.id === linkedOrderId);
                      if (order && order.retailerId !== s.id) setLinkedOrderId('');
                    }
                  }}
                  renderInput={(params) => <TextField {...params} size="small" label="Store" />}
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  options={storeOrders}
                  getOptionLabel={(o) =>
                    `${o.invoiceNumber || o.id} · ${o.retailerName || o.retailerId} · due ${formatCurrency(orderDue(o))}`
                  }
                  value={receivableOrders.find((o) => o.id === linkedOrderId) || null}
                  onChange={(_, o) => handleOrder(o)}
                  renderInput={(params) => (
                    <TextField {...params} size="small" label="Mark order paid (optional)" />
                  )}
                />
              </Grid>
            </>
          )}
          {voucherType !== 'contra' && (
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Method</InputLabel>
                <Select
                  label="Method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                >
                  <MenuItem value="Cash">Cash</MenuItem>
                  <MenuItem value="Online">Online</MenuItem>
                  <MenuItem value="UPI">UPI</MenuItem>
                  <MenuItem value="Bank Transfer">Bank Transfer</MenuItem>
                  <MenuItem value="Cheque">Cheque</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          )}
          {voucherType !== 'contra' && (
            <Grid item xs={12} sm={6}>
              <TextField
                label="Transaction / cheque no."
                size="small"
                fullWidth
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
              />
            </Grid>
          )}
          <Grid item xs={12}>
            <TextField
              label="Narration"
              size="small"
              fullWidth
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={pending}>
          {pending ? 'Saving…' : 'Save voucher'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const LedgerDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  pending: boolean;
  onSubmit: (input: { name: string; type: AccountLedgerType; openingBalance?: number }) => Promise<void>;
}> = ({ open, onClose, pending, onSubmit }) => {
  const { alert } = useAppDialog();
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountLedgerType>('expense');
  const [opening, setOpening] = useState('0');

  const handleSave = async () => {
    if (!name.trim()) {
      await alert('Ledger name is required.', { severity: 'warning' });
      return;
    }
    try {
      await onSubmit({
        name: name.trim(),
        type,
        openingBalance: Number(opening) || 0,
      });
      setName('');
      setType('expense');
      setOpening('0');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      await alert(msg, { severity: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={pending ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>New ledger</DialogTitle>
      <DialogContent>
        <TextField
          label="Name"
          size="small"
          fullWidth
          sx={{ mt: 1, mb: 2 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel>Type</InputLabel>
          <Select label="Type" value={type} onChange={(e) => setType(e.target.value as AccountLedgerType)}>
            <MenuItem value="cash">Cash</MenuItem>
            <MenuItem value="bank">Bank</MenuItem>
            <MenuItem value="expense">Expense</MenuItem>
            <MenuItem value="income">Income</MenuItem>
          </Select>
        </FormControl>
        {(type === 'cash' || type === 'bank') && (
          <TextField
            label="Opening balance"
            size="small"
            fullWidth
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
