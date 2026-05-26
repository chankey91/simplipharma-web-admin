import { useCallback, useEffect, useState } from 'react';
import { auth } from '../services/firebase';
import {
  subscribeAdminNotifications,
  getNotificationsLastSeenAt,
  setNotificationsLastSeenAt,
  countUnreadNotifications,
} from '../services/adminNotificationSubscriptions';
import type { PanelRole } from '../auth/permissions';
import type { AdminNotification } from '../types/adminNotification';

export function useAdminNotifications(panelRole: PanelRole | null) {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSeenAt, setLastSeenAt] = useState(0);

  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (uid) {
      setLastSeenAt(getNotificationsLastSeenAt(uid));
    }
  }, [uid]);

  useEffect(() => {
    if (!panelRole) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = subscribeAdminNotifications(panelRole, (items) => {
      setNotifications(items);
      setLoading(false);
    });

    return unsub;
  }, [panelRole]);

  const unreadCount = countUnreadNotifications(notifications, lastSeenAt);

  const markAllSeen = useCallback(() => {
    if (!uid) return;
    const now = Date.now();
    setNotificationsLastSeenAt(uid, now);
    setLastSeenAt(now);
  }, [uid]);

  return {
    notifications,
    unreadCount,
    loading,
    markAllSeen,
  };
}
