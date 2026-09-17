import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCompanyGstSettings,
  saveCompanyGstSettings,
} from '../services/gstSettings';
import { loadGstHealthReport } from '../services/gstExceptions';
import { applyGstBackfill, previewGstBackfill, patchPartyGstin } from '../services/gstBackfill';
import { buildGstr1Export } from '../services/gstGstr1';
import { buildGstr3bExport } from '../services/gstGstr3b';
import { buildEinvoiceExport } from '../services/gstEinvoice';
import { loadGstItcBooks, reconcileGstr2b } from '../services/gstItc';
import { getGstPeriod, lockGstPeriod, markGstPeriodStatus } from '../services/gstPeriods';
import { indianGstPeriod } from '../utils/gstPeriod';
import type { CompanyGstSettings, GstFiledFingerprint, GstPeriodStatus } from '../types/gst';

function periodKey(date: Date) {
  return indianGstPeriod(date).periodId;
}

export function useCompanyGstSettings() {
  return useQuery({
    queryKey: ['companyGstSettings'],
    queryFn: getCompanyGstSettings,
  });
}

export function useSaveCompanyGstSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CompanyGstSettings, 'id' | 'updatedAt' | 'updatedBy'>) =>
      saveCompanyGstSettings(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['companyGstSettings'] });
    },
  });
}

export function useGstPeriodRecord(date: Date) {
  return useQuery({
    queryKey: ['gstPeriod', periodKey(date)],
    queryFn: () => getGstPeriod(date),
  });
}

export function useGstHealthReport(date: Date) {
  return useQuery({
    queryKey: ['gstHealthReport', periodKey(date)],
    queryFn: () => loadGstHealthReport(date),
  });
}

export function usePreviewGstBackfill(date: Date, enabled: boolean) {
  return useQuery({
    queryKey: ['gstBackfillPreview', periodKey(date)],
    queryFn: () => previewGstBackfill(date),
    enabled,
  });
}

export function useApplyGstBackfill(date: Date) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => applyGstBackfill(date),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gstHealthReport'] });
      void queryClient.invalidateQueries({ queryKey: ['gstBackfillPreview'] });
      void queryClient.invalidateQueries({ queryKey: ['gstr1Export'] });
      void queryClient.invalidateQueries({ queryKey: ['gstr3bExport'] });
      void queryClient.invalidateQueries({ queryKey: ['gstPeriodBooks'] });
      void queryClient.invalidateQueries({ queryKey: ['gstItcBooks'] });
    },
  });
}

export function usePatchPartyGstin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: patchPartyGstin,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gstHealthReport'] });
    },
  });
}

export function useGstr1Export(date: Date, enabled: boolean, mode: 'original' | 'amendment' = 'original') {
  return useQuery({
    queryKey: ['gstr1Export', periodKey(date), mode],
    queryFn: () => buildGstr1Export(date, mode),
    enabled,
  });
}

export function useGstr3bExport(date: Date, enabled: boolean) {
  return useQuery({
    queryKey: ['gstr3bExport', periodKey(date)],
    queryFn: () => buildGstr3bExport(date),
    enabled,
  });
}

export function useEinvoiceExport(date: Date, enabled: boolean) {
  return useQuery({
    queryKey: ['einvoiceExport', periodKey(date)],
    queryFn: () => buildEinvoiceExport(date),
    enabled,
  });
}

export function useGstItcBooks(date: Date) {
  return useQuery({
    queryKey: ['gstItcBooks', periodKey(date)],
    queryFn: () => loadGstItcBooks(date),
  });
}

export function useReconcileGstr2b(date: Date) {
  return useMutation({
    mutationFn: (portalJson: unknown) => reconcileGstr2b(date, portalJson),
  });
}

export function useLockGstPeriod(date: Date) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      fingerprints: GstFiledFingerprint[];
      filename: string;
      payloadHash?: string;
      byteLength?: number;
    }) => lockGstPeriod(date, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gstPeriod'] });
    },
  });
}

export function useMarkGstPeriodStatus(date: Date) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { status: GstPeriodStatus; arn?: string }) =>
      markGstPeriodStatus(date, input.status, { arn: input.arn }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gstPeriod'] });
    },
  });
}
