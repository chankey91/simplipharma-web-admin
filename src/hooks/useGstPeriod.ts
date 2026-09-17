import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  dateForGstYm,
  gstPeriodParam,
  gstYmFromDate,
  indianGstPeriod,
  parseGstPeriodParam,
} from '../utils/gstPeriod';

export function useGstPeriodParam() {
  const [params, setParams] = useSearchParams();
  const selected = useMemo(() => {
    const parsed = parseGstPeriodParam(params.get('period'));
    if (parsed) return parsed;
    return gstYmFromDate(new Date());
  }, [params]);

  const date = useMemo(() => dateForGstYm(selected.year, selected.month), [selected.year, selected.month]);
  const meta = useMemo(() => indianGstPeriod(date), [date]);

  const setPeriod = (year: number, month: number) => {
    const next = new URLSearchParams(params);
    next.set('period', gstPeriodParam(year, month));
    setParams(next, { replace: true });
  };

  return { year: selected.year, month: selected.month, date, meta, setPeriod };
}
