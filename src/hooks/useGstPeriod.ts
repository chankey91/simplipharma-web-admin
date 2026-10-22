import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCompanyGstSettings } from './useGst';
import {
  dateForGstYm,
  gstFilingGrain,
  gstPeriodParam,
  gstYmFromDate,
  indianGstPeriod,
  parseGstPeriodParam,
  snapGstYmToGrain,
} from '../utils/gstPeriod';

export function useGstPeriodParam() {
  const [params, setParams] = useSearchParams();
  const { data: settings } = useCompanyGstSettings();
  const grain = gstFilingGrain(settings?.filingFrequency);

  const selected = useMemo(() => {
    const parsed = parseGstPeriodParam(params.get('period')) || gstYmFromDate(new Date());
    return snapGstYmToGrain(parsed.year, parsed.month, grain);
  }, [params, grain]);

  const date = useMemo(
    () => dateForGstYm(selected.year, selected.month),
    [selected.year, selected.month]
  );
  const meta = useMemo(() => indianGstPeriod(date, grain), [date, grain]);

  const setPeriod = (year: number, month: number) => {
    const snapped = snapGstYmToGrain(year, month, grain);
    const next = new URLSearchParams(params);
    next.set('period', gstPeriodParam(snapped.year, snapped.month));
    setParams(next, { replace: true });
  };

  return { year: selected.year, month: selected.month, date, meta, setPeriod, grain };
}
