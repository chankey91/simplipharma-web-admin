import React, { useMemo, useState } from 'react';
import {
  Box,
  Breadcrumbs,
  Card,
  CardContent,
  Grid,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAreaManagers } from '../hooks/useAreaManagers';
import { useSalesOfficers } from '../hooks/useSalesOfficers';
import { useStores } from '../hooks/useStores';
import { getOrdersInRange } from '../services/orders';
import { IstDateField } from '../components/IstDateField';
import { Loading } from '../components/Loading';
import { User } from '../types';
import {
  coerceToDate,
  getTodayDateStringIST,
  istDayEndExclusiveMs,
  istDayStartMs,
} from '../utils/dateTime';
import {
  bucketLabel,
  defaultFromForGrain,
  grainBucket,
  listBuckets,
  previousWindow,
  type PerfGrain,
} from '../utils/performanceSeries';

const NO_AM = '__no_am__';
const NO_SO = '__no_so__';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function changeText(change: number, previous: number): string {
  if (Math.round(change) === 0) return 'Same';
  const pct = previous > 0 ? ` (${Math.round((change / previous) * 100)}%)` : '';
  return change > 0 ? `Up ${inr(change)}${pct}` : `Down ${inr(Math.abs(change))}${pct}`;
}

function personName(user: User | undefined, fallback: string): string {
  if (!user) return fallback;
  return user.shopName || user.displayName || user.email || fallback;
}

type Sale = {
  retailerId: string;
  date: string;
  amount: number;
  orderId: string;
  invoiceNumber?: string;
  status: string;
  retailerName?: string;
};

type RankRow = {
  id: string;
  name: string;
  detail: string;
  current: number;
  previous: number;
  orders: number;
};

export const PerformancePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [grain, setGrain] = useState<PerfGrain>('day');
  const [fromDate, setFromDate] = useState(() => defaultFromForGrain('day'));
  const [toDate, setToDate] = useState(() => getTodayDateStringIST());

  const amId = searchParams.get('am') || '';
  const soId = searchParams.get('so') || '';
  const retailerId = searchParams.get('retailer') || '';
  const level = retailerId ? 'retailer' : soId ? 'so' : amId ? 'am' : 'company';

  const { data: areaManagers = [], isLoading: amLoading } = useAreaManagers();
  const { data: salesOfficers = [], isLoading: soLoading } = useSalesOfficers();
  const { data: stores = [], isLoading: storesLoading } = useStores();

  const invalid = Boolean(fromDate && toDate && fromDate > toDate);
  const prev = useMemo(
    () => (!invalid && fromDate && toDate ? previousWindow(fromDate, toDate) : null),
    [invalid, fromDate, toDate]
  );
  const range = useMemo(() => {
    if (!prev || !toDate) return null;
    return { startMs: istDayStartMs(prev.from), endMs: istDayEndExclusiveMs(toDate) };
  }, [prev, toDate]);

  const {
    data: orders = [],
    isLoading: ordersLoading,
    isError,
  } = useQuery({
    queryKey: ['performanceOrders', range?.startMs, range?.endMs],
    queryFn: () => getOrdersInRange(range!.startMs, range!.endMs),
    enabled: range != null,
  });

  const peopleReady = !amLoading && !soLoading && !storesLoading;

  const model = useMemo(() => {
    const amById = new Map(areaManagers.map((user) => [user.id, user]));
    const soById = new Map(salesOfficers.map((user) => [user.id, user]));
    const storeById = new Map(stores.map((user) => [user.id, user]));

    const ownerOf = (id: string): { soId: string; amId: string } => {
      const store = storeById.get(id);
      const soKey = store?.salesOfficerId || (soById.has(id) ? id : '');
      const so = soKey ? soById.get(soKey) : undefined;
      return {
        soId: soKey || NO_SO,
        amId: so?.areaManagerId || NO_AM,
      };
    };

    const sales: Sale[] = [];
    for (const order of orders) {
      if (order.status === 'Cancelled' || !order.retailerId) continue;
      const date = coerceToDate(order.orderDate);
      if (!date) continue;
      sales.push({
        retailerId: order.retailerId,
        date: getTodayDateStringIST(date),
        amount: Number(order.totalAmount) || 0,
        orderId: order.id,
        invoiceNumber: order.invoiceNumber,
        status: order.status,
        retailerName: order.retailerName,
      });
    }

    const inCurrent = (date: string) => date >= fromDate && date <= toDate;
    const inPrevious = (date: string) => Boolean(prev && date >= prev.from && date <= prev.to);

    return { amById, soById, storeById, ownerOf, sales, inCurrent, inPrevious };
  }, [areaManagers, salesOfficers, stores, orders, fromDate, toDate, prev]);

  const scopeSales = useMemo(() => {
    return model.sales.filter((sale) => {
      const owner = model.ownerOf(sale.retailerId);
      if (retailerId) return sale.retailerId === retailerId;
      if (soId) return owner.soId === soId;
      if (amId) return owner.amId === amId;
      return true;
    });
  }, [model, retailerId, soId, amId]);

  const chartRows = useMemo(() => {
    const buckets = listBuckets(fromDate, toDate, grain);
    const totals = new Map(buckets.map((key) => [key, { amount: 0, orders: 0 }]));
    for (const sale of scopeSales) {
      if (!model.inCurrent(sale.date)) continue;
      const key = grainBucket(sale.date, grain);
      const bucket = totals.get(key);
      if (!bucket) continue;
      bucket.amount += sale.amount;
      bucket.orders += 1;
    }
    return buckets.map((key) => ({
      label: bucketLabel(key, grain),
      amount: Math.round(totals.get(key)?.amount || 0),
      orders: totals.get(key)?.orders || 0,
    }));
  }, [scopeSales, model, fromDate, toDate, grain]);

  const currentTotal = chartRows.reduce((sum, row) => sum + row.amount, 0);
  const currentOrders = chartRows.reduce((sum, row) => sum + row.orders, 0);
  const previousTotal = scopeSales.reduce(
    (sum, sale) => (model.inPrevious(sale.date) ? sum + sale.amount : sum),
    0
  );

  const rankRows = useMemo((): RankRow[] => {
    const add = (
      map: Map<string, RankRow>,
      id: string,
      name: string,
      detail: string,
      amount: number,
      previous: boolean
    ) => {
      const row = map.get(id) || { id, name, detail, current: 0, previous: 0, orders: 0 };
      if (previous) row.previous += amount;
      else {
        row.current += amount;
        row.orders += 1;
      }
      map.set(id, row);
    };

    if (level === 'retailer') return [];

    const map = new Map<string, RankRow>();
    const consider = (sale: Sale, previous: boolean) => {
      const owner = model.ownerOf(sale.retailerId);
      if (level === 'company') {
        const id = owner.amId;
        const name =
          id === NO_AM ? 'No area manager' : personName(model.amById.get(id), 'Area manager');
        add(map, id, name, 'Area manager', sale.amount, previous);
        return;
      }
      if (level === 'am') {
        if (owner.amId !== amId) return;
        const id = owner.soId;
        const name = id === NO_SO ? 'No sales officer' : personName(model.soById.get(id), 'Sales officer');
        add(map, id, name, 'Sales officer', sale.amount, previous);
        return;
      }
      if (owner.soId !== soId) return;
      const store = model.storeById.get(sale.retailerId);
      add(
        map,
        sale.retailerId,
        personName(store, sale.retailerName || 'Retailer'),
        store?.storeCode || 'Retailer',
        sale.amount,
        previous
      );
    };

    for (const sale of model.sales) {
      if (model.inCurrent(sale.date)) consider(sale, false);
      else if (model.inPrevious(sale.date)) consider(sale, true);
    }

    if (level === 'company') {
      for (const am of model.amById.values()) {
        if (!map.has(am.id)) {
          map.set(am.id, {
            id: am.id,
            name: personName(am, 'Area manager'),
            detail: 'Area manager',
            current: 0,
            previous: 0,
            orders: 0,
          });
        }
      }
    }
    if (level === 'am' && amId !== NO_AM) {
      for (const so of model.soById.values()) {
        if ((so.areaManagerId || NO_AM) === amId && !map.has(so.id)) {
          map.set(so.id, {
            id: so.id,
            name: personName(so, 'Sales officer'),
            detail: 'Sales officer',
            current: 0,
            previous: 0,
            orders: 0,
          });
        }
      }
    }

    return [...map.values()].sort((a, b) => b.current - a.current || a.name.localeCompare(b.name));
  }, [level, model, amId, soId]);

  const retailerOrders = useMemo(() => {
    if (level !== 'retailer') return [];
    return scopeSales
      .filter((sale) => model.inCurrent(sale.date))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [level, scopeSales, model]);

  const openDrill = (next: { am?: string; so?: string; retailer?: string }) => {
    const params = new URLSearchParams();
    if (next.am) params.set('am', next.am);
    if (next.so) params.set('so', next.so);
    if (next.retailer) params.set('retailer', next.retailer);
    setSearchParams(params);
  };

  const retailerOwner = retailerId ? model.ownerOf(retailerId) : null;
  const soRecord = soId ? model.soById.get(soId) : undefined;
  const crumbAm = amId || soRecord?.areaManagerId || retailerOwner?.amId || '';
  const crumbSo = soId || (retailerId ? retailerOwner?.soId || '' : '');

  const amName = (id: string) =>
    id === NO_AM ? 'No area manager' : personName(model.amById.get(id), 'Area manager');
  const soName = (id: string) =>
    id === NO_SO ? 'No sales officer' : personName(model.soById.get(id), 'Sales officer');
  const retailerName = retailerId
    ? personName(model.storeById.get(retailerId), model.sales.find((s) => s.retailerId === retailerId)?.retailerName || 'Retailer')
    : '';

  const title =
    level === 'retailer'
      ? retailerName
      : level === 'so'
        ? soName(soId)
        : level === 'am'
          ? amName(amId)
          : 'Network performance';

  const listTitle =
    level === 'company' ? 'Area managers' : level === 'am' ? 'Sales officers' : 'Retailers';

  if (!peopleReady || ordersLoading) {
    return <Loading message="Loading performance..." />;
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Performance
      </Typography>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link
          component="button"
          underline="hover"
          color={level === 'company' ? 'text.primary' : 'inherit'}
          onClick={() => setSearchParams(new URLSearchParams())}
        >
          All area managers
        </Link>
        {crumbAm && level !== 'company' && (
          <Link
            component="button"
            underline="hover"
            color={level === 'am' ? 'text.primary' : 'inherit'}
            onClick={() => openDrill({ am: crumbAm })}
          >
            {amName(crumbAm)}
          </Link>
        )}
        {crumbSo && (level === 'so' || level === 'retailer') && (
          <Link
            component="button"
            underline="hover"
            color={level === 'so' ? 'text.primary' : 'inherit'}
            onClick={() => openDrill({ am: crumbAm || undefined, so: crumbSo })}
          >
            {soName(crumbSo)}
          </Link>
        )}
        {level === 'retailer' && <Typography color="text.primary">{retailerName}</Typography>}
      </Breadcrumbs>

      <Box display="flex" gap={2} flexWrap="wrap" alignItems="center" sx={{ mb: 2 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={grain}
          onChange={(_, value: PerfGrain | null) => {
            if (!value) return;
            setGrain(value);
            const today = getTodayDateStringIST();
            setToDate(today);
            setFromDate(defaultFromForGrain(value, today));
          }}
        >
          <ToggleButton value="day">Daily</ToggleButton>
          <ToggleButton value="week">Weekly</ToggleButton>
          <ToggleButton value="month">Monthly</ToggleButton>
        </ToggleButtonGroup>
        <IstDateField label="From" value={fromDate} onChange={setFromDate} />
        <IstDateField label="To" value={toDate} onChange={setToDate} />
      </Box>

      {invalid && (
        <Typography color="error" sx={{ mb: 2 }}>
          From date must be on or before the to date.
        </Typography>
      )}

      <Typography variant="h5" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Sales follow each retailer's current sales officer and area manager. Cancelled orders are left out.
      </Typography>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Sales in this range
              </Typography>
              <Typography variant="h5">{inr(currentTotal)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Orders
              </Typography>
              <Typography variant="h5">{currentOrders}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Vs previous range
              </Typography>
              <Typography
                variant="h6"
                color={currentTotal - previousTotal > 0 ? 'success.main' : currentTotal - previousTotal < 0 ? 'error.main' : 'text.primary'}
              >
                {changeText(currentTotal - previousTotal, previousTotal)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2, mb: 2, height: 340 }}>
        {isError ? (
          <Typography color="error">Could not load orders for this range.</Typography>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => inr(Number(value) || 0)} />
              <Line type="monotone" dataKey="amount" name="Sales" stroke="#1565c0" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Paper>

      {level === 'retailer' ? (
        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 480 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Invoice</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {retailerOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>No sales in this range.</TableCell>
                </TableRow>
              ) : (
                retailerOrders.map((sale) => (
                  <TableRow
                    key={sale.orderId}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/orders/${sale.orderId}`)}
                  >
                    <TableCell>{sale.date}</TableCell>
                    <TableCell>{sale.invoiceNumber || sale.orderId}</TableCell>
                    <TableCell>{sale.status}</TableCell>
                    <TableCell align="right">{inr(sale.amount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            {listTitle}, highest sales first
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell align="right">Orders</TableCell>
                  <TableCell align="right">Sales</TableCell>
                  <TableCell align="right">Vs previous range</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rankRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>No sales in this range.</TableCell>
                  </TableRow>
                ) : (
                  rankRows.map((row, index) => (
                    <TableRow
                      key={row.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => {
                        if (level === 'company') openDrill({ am: row.id });
                        else if (level === 'am') openDrill({ am: amId, so: row.id });
                        else openDrill({ am: amId || undefined, so: soId, retailer: row.id });
                      }}
                    >
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell align="right">{row.orders}</TableCell>
                      <TableCell align="right">{inr(row.current)}</TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          color:
                            row.current - row.previous > 0
                              ? 'success.main'
                              : row.current - row.previous < 0
                                ? 'error.main'
                                : 'text.secondary',
                        }}
                      >
                        {changeText(row.current - row.previous, row.previous)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
};
