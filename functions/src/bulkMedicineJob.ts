import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';
import * as nodemailer from 'nodemailer';

function escapeHtmlText(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendBulkJobMail(
  to: string,
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const smtpConfig = functions.config().smtp;
    if (!smtpConfig?.user || !smtpConfig?.password) {
      console.warn('bulkMedicineJob: SMTP not configured');
      return { ok: false, error: 'SMTP not configured' };
    }
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: smtpConfig.user, pass: smtpConfig.password },
    });
    await transporter.sendMail({
      from: smtpConfig.user,
      to,
      subject,
      html,
    });
    return { ok: true };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('sendBulkJobMail failed:', msg, to);
    return { ok: false, error: msg };
  }
}

interface ParsedRow {
  name: string;
  code?: string;
  category: string;
  unit: string;
  manufacturer: string;
  gstRate: number;
  description?: string;
  rowNum: number;
}

function parseRows(jsonData: any[]): { rows: ParsedRow[]; errors: string[] } {
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  for (let i = 0; i < jsonData.length; i++) {
    const row = jsonData[i] as Record<string, unknown>;
    const rowNum = i + 2;
    if (!row['Medicine Name']) {
      errors.push(`Row ${rowNum}: Medicine Name is required`);
      continue;
    }
    if (!row['Manufacturer']) {
      errors.push(`Row ${rowNum}: Manufacturer is required`);
      continue;
    }
    if (!row['Type']) {
      errors.push(`Row ${rowNum}: Type is required`);
      continue;
    }
    if (!row['Packaging']) {
      errors.push(`Row ${rowNum}: Packaging is required`);
      continue;
    }
    rows.push({
      name: String(row['Medicine Name'] || '').trim(),
      code: row['Code'] ? String(row['Code']).trim() : undefined,
      category: String(row['Type'] || '').trim(),
      unit: String(row['Packaging'] || '').trim(),
      manufacturer: String(row['Manufacturer'] || '').trim(),
      gstRate: row['GST Rate (%)'] ? parseFloat(String(row['GST Rate (%)'])) : 5,
      description: row['Description'] ? String(row['Description']).trim() : undefined,
      rowNum,
    });
  }
  return { rows, errors };
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Admin uploads Excel to Storage and creates bulk_medicine_jobs/{jobId} with status queued.
 * Processes create/update by medicine name (case-insensitive); stock is not changed.
 * Sends email to notifyEmail when done (success or failure).
 */
export const onBulkMedicineJobCreated = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .firestore.document('bulk_medicine_jobs/{jobId}')
  .onCreate(async (snap, context) => {
    const jobId = context.params.jobId;
    const data = snap.data() as Record<string, unknown> | undefined;
    if (!data || data.status !== 'queued') {
      console.log('onBulkMedicineJobCreated: skip', jobId, data?.status);
      return null;
    }

    const db = admin.firestore();
    const jobRef = db.collection('bulk_medicine_jobs').doc(jobId);
    const notifyEmail = String(data.notifyEmail || '').trim();
    const storagePath = String(data.storagePath || '').trim();
    const createdBy = String(data.createdBy || '').trim();
    const expectedPath = `bulk_medicine_uploads/${createdBy}/${jobId}.xlsx`;

    if (!createdBy || storagePath !== expectedPath) {
      await jobRef.update({
        status: 'failed',
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        errorMessage: 'Invalid storagePath for this job',
      });
      if (notifyEmail) {
        await sendBulkJobMail(
          notifyEmail,
          'SimpliPharma — Bulk medicine import failed',
          `<p>Job ${escapeHtmlText(jobId)} failed: invalid file path.</p>`
        );
      }
      return null;
    }

    await jobRef.update({
      status: 'processing',
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let createCount = 0;
    let updateCount = 0;
    let failCount = 0;
    const processErrors: string[] = [];
    const BATCH_SIZE = 400;

    try {
      const bucket = admin.storage().bucket();
      const [fileBuf] = await bucket.file(storagePath).download();
      const workbook = XLSX.read(fileBuf, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

      if (!jsonData.length) {
        throw new Error('Excel file is empty');
      }

      const { rows, errors: parseErrors } = parseRows(jsonData);
      await jobRef.update({
        parseErrorCount: parseErrors.length,
        validRowCount: rows.length,
      });

      if (rows.length === 0) {
        throw new Error('No valid medicine rows after validation');
      }

      const medicinesSnap = await db.collection('medicines').get();
      const nameToId = new Map<string, string>();
      for (const d of medicinesSnap.docs) {
        const n = String(d.data()?.name || '')
          .toLowerCase()
          .trim();
        if (n && !nameToId.has(n)) {
          nameToId.set(n, d.id);
        }
      }

      let writeBatch = db.batch();
      let opCount = 0;

      const flushBatch = async () => {
        if (opCount === 0) return;
        await writeBatch.commit();
        writeBatch = db.batch();
        opCount = 0;
      };

      for (let i = 0; i < rows.length; i++) {
        const m = rows[i];
        try {
          const key = m.name.toLowerCase().trim();
          const existingId = nameToId.get(key);

          if (existingId) {
            const ref = db.collection('medicines').doc(existingId);
            const updatePayload = stripUndefined({
              name: m.name,
              code: m.code,
              category: m.category,
              unit: m.unit,
              manufacturer: m.manufacturer,
              gstRate: m.gstRate,
              description: m.description,
            });
            writeBatch.update(ref, updatePayload as Record<string, unknown>);
            updateCount++;
          } else {
            const ref = db.collection('medicines').doc();
            const newDoc = stripUndefined({
              name: m.name,
              category: m.category,
              manufacturer: m.manufacturer,
              stock: 0,
              currentStock: 0,
              stockBatches: [],
              gstRate: m.gstRate,
              price: 0,
              unit: m.unit,
              code: m.code,
              description: m.description,
            });
            writeBatch.set(ref, newDoc);
            nameToId.set(key, ref.id);
            createCount++;
          }
          opCount++;

          if (opCount >= BATCH_SIZE) {
            await flushBatch();
            await jobRef.update({
              processedRows: i + 1,
              progressNote: `Committed Firestore batch at row ${i + 1}`,
            });
          }
        } catch (e: any) {
          failCount++;
          const msg = `Row ${m.rowNum} (${m.name}): ${e?.message || String(e)}`;
          if (processErrors.length < 30) processErrors.push(msg);
        }
      }

      await flushBatch();

      await jobRef.update({
        status: 'completed',
        createCount,
        updateCount,
        failCount,
        parseErrors: parseErrors.slice(0, 25),
        processErrors,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const summary = `
        <p><strong>Job ID:</strong> ${escapeHtmlText(jobId)}</p>
        <ul>
          <li>Created: <strong>${createCount}</strong></li>
          <li>Updated: <strong>${updateCount}</strong></li>
          <li>Failed rows: <strong>${failCount}</strong></li>
          <li>Sheet validation messages: <strong>${parseErrors.length}</strong></li>
        </ul>
        ${
          parseErrors.length
            ? `<p><strong>Sample validation messages:</strong><br/>${parseErrors
                .slice(0, 8)
                .map(escapeHtmlText)
                .join('<br/>')}</p>`
            : ''
        }
        ${
          processErrors.length
            ? `<p><strong>Sample processing errors:</strong><br/>${processErrors
                .slice(0, 8)
                .map(escapeHtmlText)
                .join('<br/>')}</p>`
            : ''
        }
      `;

      if (notifyEmail) {
        const mail = await sendBulkJobMail(
          notifyEmail,
          'SimpliPharma — Bulk medicine import finished',
          `<div style="font-family:Arial,sans-serif;max-width:640px;">
            <h2 style="color:#2E7D32;">Bulk import complete</h2>
            ${summary}
            <p style="color:#666;font-size:12px;">Stock levels were not changed. Existing products are matched by name (case-insensitive) and updated.</p>
          </div>`
        );
        await jobRef.update({
          completionEmailSent: mail.ok,
          ...(mail.ok
            ? {}
            : { completionEmailError: mail.error || 'unknown' }),
        });
      }
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      console.error('onBulkMedicineJobCreated failed', jobId, errMsg);
      await jobRef.update({
        status: 'failed',
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        errorMessage: errMsg,
      });
      if (notifyEmail) {
        await sendBulkJobMail(
          notifyEmail,
          'SimpliPharma — Bulk medicine import failed',
          `<div style="font-family:Arial,sans-serif;"><h2 style="color:#c62828;">Import failed</h2>
          <p><strong>Job ID:</strong> ${escapeHtmlText(jobId)}</p>
          <pre style="background:#f5f5f5;padding:12px;white-space:pre-wrap;">${escapeHtmlText(errMsg)}</pre></div>`
        );
      }
    }

    return null;
  });
