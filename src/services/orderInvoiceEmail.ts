import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export type SendOrderInvoicePdfEmailResult = { ok?: boolean; emailedTo?: string };

/**
 * Sends a client-generated PDF (same as Print Invoice) to the order's retailer email via SMTP Cloud Function.
 * Optionally attaches an invoice CSV exported with the same line items.
 */
export async function sendOrderInvoicePdfToRetailer(
    orderId: string,
    pdfBase64Uri: string,
    fileName?: string,
    attachments?: {
        csvBase64Uri?: string;
        csvFileName?: string;
    }
): Promise<SendOrderInvoicePdfEmailResult> {
  const fn = httpsCallable(functions, 'sendOrderInvoicePdfEmail', {
    timeout: 120000,
  });
  const res = await fn({
    orderId,
    pdfBase64: pdfBase64Uri,
    ...(fileName ? { fileName } : {}),
    ...(attachments?.csvBase64Uri ? { csvBase64: attachments.csvBase64Uri } : {}),
    ...(attachments?.csvFileName ? { csvFileName: attachments.csvFileName } : {}),
  });
  return res.data as SendOrderInvoicePdfEmailResult;
}
