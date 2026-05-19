import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  writeBatch,
  db,
} from './firebase';
import { serverTimestamp } from 'firebase/firestore';

export type SupportTicketStatus = 'open' | 'pending_user' | 'resolved';

export interface SupportTicketRow {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayLabel?: string;
  subject: string;
  status: SupportTicketStatus;
  lastMessagePreview?: string;
  createdAt?: Timestamp | Date | null;
  updatedAt?: Timestamp | Date | null;
}

export interface SupportThreadMessage {
  id: string;
  from: string;
  text: string;
  createdAt?: Timestamp | Date | null;
}

const openTicketStatuses = ['open', 'pending_user'];

function updatedAtMillis(v: SupportTicketRow['updatedAt']): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof (v as Timestamp).toMillis === 'function') return (v as Timestamp).toMillis();
  return 0;
}

export function subscribeOpenSupportTickets(
  onRows: (rows: SupportTicketRow[]) => void,
  onError?: (e: Error) => void
): () => void {
  // No server orderBy: `where(..., 'in', ...)` + `orderBy(updatedAt)` needs a composite index that may
  // still be building after deploy. Sort client-side instead (typical open-ticket count is small).
  const q = query(collection(db, 'support_tickets'), where('status', 'in', openTicketStatuses));
  return onSnapshot(
    q,
    (snap) => {
      const rows: SupportTicketRow[] = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          userId: String(x.userId || ''),
          userEmail: String(x.userEmail || ''),
          userDisplayLabel: x.userDisplayLabel != null ? String(x.userDisplayLabel) : undefined,
          subject: String(x.subject || ''),
          status: x.status as SupportTicketStatus,
          lastMessagePreview: x.lastMessagePreview != null ? String(x.lastMessagePreview) : undefined,
          createdAt: x.createdAt ?? null,
          updatedAt: x.updatedAt ?? null,
        };
      });
      rows.sort((a, b) => updatedAtMillis(b.updatedAt) - updatedAtMillis(a.updatedAt));
      onRows(rows);
    },
    (err) => onError?.(err as Error)
  );
}

export function subscribeSupportThreadMessages(
  userId: string,
  onMessages: (messages: SupportThreadMessage[]) => void,
  onError?: (e: Error) => void
): () => void {
  const threadRef = doc(db, 'support_threads', userId);
  const q = query(collection(threadRef, 'messages'), orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const messages: SupportThreadMessage[] = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          from: String(x.from || 'user'),
          text: String(x.text || ''),
          createdAt: x.createdAt ?? null,
        };
      });
      onMessages(messages);
    },
    (err) => onError?.(err as Error)
  );
}

export async function postAdminSupportReply(
  userId: string,
  ticketId: string,
  text: string
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length < 1) {
    throw new Error('Enter a message to send.');
  }
  const batch = writeBatch(db);
  const threadRef = doc(db, 'support_threads', userId);
  const msgRef = doc(collection(threadRef, 'messages'));
  batch.set(msgRef, {
    from: 'admin',
    text: trimmed,
    createdAt: serverTimestamp(),
  });
  batch.update(threadRef, {
    updatedAt: serverTimestamp(),
  });
  const ticketRef = doc(db, 'support_tickets', ticketId);
  batch.update(ticketRef, {
    updatedAt: serverTimestamp(),
    status: 'pending_user',
    lastMessagePreview: trimmed.slice(0, 220),
  });
  await batch.commit();
}

export async function resolveSupportTicket(userId: string, ticketId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'support_tickets', ticketId), {
    status: 'resolved',
    updatedAt: serverTimestamp(),
  });
  const threadRef = doc(db, 'support_threads', userId);
  const msgRef = doc(collection(threadRef, 'messages'));
  batch.set(msgRef, {
    from: 'system',
    text: 'This ticket was marked resolved. If you need more help, open a new request from Help & support.',
    createdAt: serverTimestamp(),
  });
  batch.update(threadRef, {
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}
