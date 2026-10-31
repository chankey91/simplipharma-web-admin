import {
  addDoc,
  collection,
  db,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  doc,
  Timestamp,
} from './firebase';
import { auth } from './firebase';

export type IncidentSubjectType = 'retailer' | 'salesOfficer' | 'areaManager' | 'purchaseOfficer';
export type IncidentStatus = 'open' | 'closed';
export type IncidentPriority = 'normal' | 'urgent';

export type Incident = {
  id: string;
  subjectType: IncidentSubjectType;
  subjectId: string;
  subjectName: string;
  subjectCode?: string;
  /** Retailer's current sales officer, or the officer when the incident is about them. */
  salesOfficerId?: string;
  /** That officer's area manager, or the manager when the incident is about them. */
  areaManagerId?: string;
  /** Set when the incident is about a purchase officer, or raised by one. */
  purchaseOfficerId?: string;
  raisedById: string;
  raisedByName: string;
  raisedByRole: string;
  title: string;
  details: string;
  priority: IncidentPriority;
  status: IncidentStatus;
  createdAt?: Timestamp | Date | null;
  updatedAt?: Timestamp | Date | null;
  closedAt?: Timestamp | Date | null;
  closedById?: string;
  closedByName?: string;
  closeNote?: string;
};

export type IncidentComment = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  text: string;
  createdAt?: Timestamp | Date | null;
};

export const INCIDENT_SUBJECT_LABEL: Record<IncidentSubjectType, string> = {
  retailer: 'Retailer',
  salesOfficer: 'Sales officer',
  areaManager: 'Area manager',
  purchaseOfficer: 'Purchase officer',
};

function stampMillis(value: Incident['createdAt']): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as Timestamp).toMillis === 'function') return (value as Timestamp).toMillis();
  return 0;
}

function clean(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

export async function listIncidents(): Promise<Incident[]> {
  const snap = await getDocs(query(collection(db, 'incidents'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Incident, 'id'>) }));
}

export async function createIncident(input: {
  subjectType: IncidentSubjectType;
  subjectId: string;
  subjectName: string;
  subjectCode?: string;
  salesOfficerId?: string;
  areaManagerId?: string;
  purchaseOfficerId?: string;
  title: string;
  details: string;
  priority: IncidentPriority;
  raisedByRole: string;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in');
  const title = input.title.trim();
  const details = input.details.trim();
  if (!title) throw new Error('Enter a subject');
  if (!details) throw new Error('Enter the details');
  const ref = await addDoc(
    collection(db, 'incidents'),
    clean({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectName: input.subjectName,
      subjectCode: input.subjectCode?.trim(),
      salesOfficerId: input.salesOfficerId,
      areaManagerId: input.areaManagerId,
      purchaseOfficerId: input.purchaseOfficerId,
      raisedById: user.uid,
      raisedByName: user.displayName || user.email || 'Admin',
      raisedByRole: input.raisedByRole,
      title,
      details,
      priority: input.priority,
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  return ref.id;
}

export async function listIncidentComments(incidentId: string): Promise<IncidentComment[]> {
  const snap = await getDocs(
    query(collection(db, 'incidents', incidentId, 'comments'), orderBy('createdAt', 'asc'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<IncidentComment, 'id'>) }));
}

export async function addIncidentComment(
  incidentId: string,
  text: string,
  authorRole: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in');
  const body = text.trim();
  if (!body) throw new Error('Enter a reply');
  await addDoc(collection(db, 'incidents', incidentId, 'comments'), {
    authorId: user.uid,
    authorName: user.displayName || user.email || 'Admin',
    authorRole,
    text: body,
    createdAt: serverTimestamp(),
  });
}

export async function closeIncident(incidentId: string, closeNote: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in');
  const note = closeNote.trim();
  if (!note) throw new Error('Enter a closing note');
  await updateDoc(doc(db, 'incidents', incidentId), {
    status: 'closed',
    closeNote: note,
    closedById: user.uid,
    closedByName: user.displayName || user.email || 'Admin',
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function incidentTimeLabel(value: Incident['createdAt']): string {
  const ms = stampMillis(value);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}
