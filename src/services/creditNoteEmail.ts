import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export type SendCreditNotePdfEmailResult = { ok?: boolean; emailedTo?: string };

export async function sendCreditNotePdfToRetailer(
  creditNoteId: string,
  pdfBase64Uri: string,
  fileName?: string
): Promise<SendCreditNotePdfEmailResult> {
  const fn = httpsCallable(functions, 'sendCreditNotePdfEmail', {
    timeout: 120000,
  });
  const res = await fn({
    creditNoteId,
    pdfBase64: pdfBase64Uri,
    ...(fileName ? { pdfFileName: fileName } : {}),
  });
  return res.data as SendCreditNotePdfEmailResult;
}
