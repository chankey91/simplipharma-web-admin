import { collection, getDocs, query, where, db } from './firebase';
import { User } from '../types';

/** Users whose primary `role` or `roles[]` includes any of the given roles. */
export async function getUsersMatchingRoles(roles: string[]): Promise<User[]> {
  const usersCol = collection(db, 'users');
  const snaps = await Promise.all(
    roles.flatMap((role) => [
      getDocs(query(usersCol, where('role', '==', role))),
      getDocs(query(usersCol, where('roles', 'array-contains', role))),
    ])
  );
  const byId = new Map<string, User>();
  for (const snap of snaps) {
    for (const d of snap.docs) {
      byId.set(d.id, { id: d.id, uid: d.id, ...d.data() } as User);
    }
  }
  return Array.from(byId.values());
}
