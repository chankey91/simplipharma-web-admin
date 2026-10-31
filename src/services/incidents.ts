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
export type IncidentLevel = 'salesOfficer' | 'areaManager' | 'admin';

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
  /** Who should act next. Missing on older incidents means admin. */
  level?: IncidentLevel;
  /** Level at the moment it was closed, so reopen can put it back there. */
  closedAtLevel?: IncidentLevel;
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

export function incidentLevel(incident: { level?: string | null }): IncidentLevel {
  if (incident.level === 'salesOfficer' || incident.level === 'areaManager' || incident.level === 'admin') {
    return incident.level;
  }
  return 'admin';
}

export function incidentLevelLabel(level: IncidentLevel): string {
  if (level === 'salesOfficer') return 'With sales officer';
  if (level === 'areaManager') return 'With area manager';
  return 'With admin';
}

/** Retailer starts with the sales officer. A sales officer starts with the area manager. */
export function startIncidentLevel(
  raisedByRole: string,
  salesOfficerId?: string,
  areaManagerId?: string
): IncidentLevel {
  if (raisedByRole === 'retailer') return salesOfficerId ? 'salesOfficer' : 'admin';
  if (raisedByRole === 'salesOfficer') return areaManagerId ? 'areaManager' : 'admin';
  return 'admin';
}

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
      level: startIncidentLevel(input.raisedByRole, input.salesOfficerId, input.areaManagerId),
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

export async function closeIncident(
  incidentId: string,
  closeNote: string,
  level: IncidentLevel
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in');
  const note = closeNote.trim();
  if (!note) throw new Error('Enter a closing note');
  await updateDoc(doc(db, 'incidents', incidentId), {
    status: 'closed',
    level,
    closedAtLevel: level,
    closeNote: note,
    closedById: user.uid,
    closedByName: user.displayName || user.email || 'Admin',
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function reopenIncident(incidentId: string, note: string, restoreLevel: IncidentLevel): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in');
  const body = note.trim();
  if (!body) throw new Error('Enter why this is being reopened');
  await updateDoc(doc(db, 'incidents', incidentId), {
    status: 'open',
    level: restoreLevel,
    updatedAt: serverTimestamp(),
  });
  await addIncidentComment(incidentId, `Reopened: ${body}`, 'admin');
}

export function incidentTimeLabel(value: Incident['createdAt']): string {
  const ms = stampMillis(value);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}
