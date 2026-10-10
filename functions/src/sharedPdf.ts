import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { ff } from './functionRegion';

const COLLECTION = 'pdf_shares';

function resolveShareId(req: functions.Request): string {
  const fromQuery = String(req.query.n || req.query.f || '').trim();
  if (fromQuery) {
    try {
      return decodeURIComponent(fromQuery);
    } catch {
      return fromQuery;
    }
  }
  const parts = String(req.path || '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1] || '';
  if (!last || last === 'pdf') return '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Public GET: /openSharedPdf/<filename.pdf> → 302 to the stored download URL. */
export const openSharedPdf = ff
  .runWith({ minInstances: 0, memory: '256MB', timeoutSeconds: 15 })
  .https.onRequest(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.status(204).send('');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Method not allowed');
      return;
    }

    const shareId = resolveShareId(req);
    if (!shareId) {
      res.status(400).type('html').send('<p>Missing PDF name.</p>');
      return;
    }

    try {
      const snap = await admin.firestore().collection(COLLECTION).doc(shareId).get();
      const downloadUrl = String(snap.data()?.downloadUrl || '').trim();
      if (!snap.exists || !downloadUrl) {
        res.status(404).type('html').send('<p>This PDF link is not available.</p>');
        return;
      }
      res.set('Cache-Control', 'public, max-age=120');
      res.redirect(302, downloadUrl);
    } catch (err) {
      console.error('open shared pdf failed', shareId, err);
      res.status(500).type('html').send('<p>Could not open this PDF.</p>');
    }
  });
