import { collection, limit, onSnapshot, query, where, db } from './firebase';
import type { PanelRole } from '../auth/permissions';
import type { AdminNotification } from '../types/adminNotification';

const LIST_LIMIT = 25;
const MAX_MERGED = 50;

function toDate(value: unknown): Date {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const d = (value as { toDate: () => Date }).toDate();
    if (d instanceof Date && !isNaN(d.getTime())) return d;
  }
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (value != null) {
    const d = new Date(value as string | number);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

function formatAmount(amount: unknown): string {
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    return `₹${amount.toLocaleString('en-IN')}`;
  }
  return '';
}

export function subscribeAdminNotifications(
  role: PanelRole,
  onUpdate: (notifications: AdminNotification[]) => void
): () => void {
  const buckets: Record<string, AdminNotification[]> = {};

  const emit = () => {
    const merged = Object.values(buckets)
      .flat()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, MAX_MERGED);
    onUpdate(merged);
  };

  const setBucket = (key: string, items: AdminNotification[]) => {
    buckets[key] = items;
    emit();
  };

  const unsubs: (() => void)[] = [];

  const watch = (
    key: string,
    q: ReturnType<typeof query>,
    mapDoc: (id: string, data: Record<string, unknown>) => AdminNotification
  ) => {
    unsubs.push(
      onSnapshot(
        q,
        (snap) => {
          setBucket(
            key,
            snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>))
          );
        },
        () => setBucket(key, [])
      )
    );
  };

  // Pending orders — admin & operations
  watch(
    'orders',
    query(collection(db, 'orders'), where('status', '==', 'Pending'), limit(LIST_LIMIT)),
    (id, data) => {
      const retailer =
        (typeof data.retailerName === 'string' && data.retailerName) ||
        (typeof data.retailerEmail === 'string' && data.retailerEmail) ||
        'Retailer';
      const amt = formatAmount(data.totalAmount);
      return {
        id: `order-${id}`,
        type: 'order',
        title: 'Pending order',
        message: amt ? `${retailer} — ${amt}` : retailer,
        path: `/orders/${id}`,
        createdAt: toDate(data.orderDate ?? data.createdAt),
      };
    }
  );

  // Product demands — admin & operations
  watch(
    'demands',
    query(collection(db, 'product_demands'), where('status', '==', 'pending'), limit(LIST_LIMIT)),
    (id, data) => {
      const product =
        (typeof data.productName === 'string' && data.productName) || 'Product request';
      const retailer =
        (typeof data.retailerName === 'string' && data.retailerName) ||
        (typeof data.retailerEmail === 'string' && data.retailerEmail) ||
        '';
      return {
        id: `demand-${id}`,
        type: 'product_demand',
        title: product,
        message: retailer || 'New product demand',
        path: '/product-demands',
        createdAt: toDate(data.createdAt),
      };
    }
  );

  // Order returns awaiting admin — admin & operations
  watch(
    'orderReturns',
    query(
      collection(db, 'order_return_requests'),
      where('status', '==', 'pending_admin'),
      limit(LIST_LIMIT)
    ),
    (id, data) => {
      const retailer =
        (typeof data.retailerName === 'string' && data.retailerName) ||
        (typeof data.retailerEmail === 'string' && data.retailerEmail) ||
        'Store';
      const refund = formatAmount(data.totalRefundAmount);
      return {
        id: `order-return-${id}`,
        type: 'order_return',
        title: 'Order return — admin review',
        message: refund ? `${retailer} — ${refund}` : retailer,
        path: '/order-returns',
        createdAt: toDate(data.createdAt),
      };
    }
  );

  if (role === 'admin') {
    watch(
      'retailers',
      query(
        collection(db, 'retailer_registration_requests'),
        where('status', '==', 'pending'),
        limit(LIST_LIMIT)
      ),
      (id, data) => {
        const shop =
          (typeof data.shopName === 'string' && data.shopName) ||
          (typeof data.displayName === 'string' && data.displayName) ||
          (typeof data.email === 'string' && data.email) ||
          'New registration';
        return {
          id: `retailer-${id}`,
          type: 'retailer_registration',
          title: 'Retailer registration',
          message: shop,
          path: '/pending-retailers',
          createdAt: toDate(data.createdAt),
        };
      }
    );
  }

  if (role === 'admin' || role === 'operations') {
    watch(
      'expiryReturns',
      query(
        collection(db, 'expiry_return_requests'),
        where('status', '==', 'pending'),
        limit(LIST_LIMIT)
      ),
      (id, data) => {
        const retailer =
          (typeof data.retailerName === 'string' && data.retailerName) ||
          (typeof data.retailerEmail === 'string' && data.retailerEmail) ||
          'Store';
        return {
          id: `expiry-return-${id}`,
          type: 'expiry_return',
          title: 'Expiry return request',
          message: retailer,
          path: '/expiry-returns',
          createdAt: toDate(data.createdAt),
        };
      }
    );
  }

  return () => {
    unsubs.forEach((u) => u());
  };
}

const SEEN_STORAGE_PREFIX = 'simplipharma-admin-notifications-seen-';

export function getNotificationsLastSeenAt(userId: string): number {
  try {
    const raw = localStorage.getItem(`${SEEN_STORAGE_PREFIX}${userId}`);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function setNotificationsLastSeenAt(userId: string, at: number = Date.now()): void {
  try {
    localStorage.setItem(`${SEEN_STORAGE_PREFIX}${userId}`, String(at));
  } catch {
    /* ignore */
  }
}

export function countUnreadNotifications(
  notifications: AdminNotification[],
  lastSeenAt: number
): number {
  if (notifications.length === 0) return 0;
  if (lastSeenAt <= 0) return notifications.length;
  return notifications.filter((n) => n.createdAt.getTime() > lastSeenAt).length;
}
