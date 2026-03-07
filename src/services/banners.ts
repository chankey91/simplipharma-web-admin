import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  query,
  orderBy,
  Timestamp,
  db,
} from './firebase';

export interface Banner {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  icon: string;
  isActive: boolean;
  order: number;
  linkTo?: string;
  createdAt?: Date | any;
  updatedAt?: Date | any;
}

export const getAllBanners = async (): Promise<Banner[]> => {
  try {
    const q = query(
      collection(db, 'banners'),
      orderBy('order', 'asc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data(),
    })) as Banner[];
  } catch (e) {
    // Fallback if orderBy index doesn't exist
    const snapshot = await getDocs(collection(db, 'banners'));
    const banners = snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data(),
    })) as Banner[];
    return banners.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
};

export const addBanner = async (bannerData: Omit<Banner, 'id'>): Promise<string> => {
  const cleanData = Object.fromEntries(
    Object.entries(bannerData).filter(([, v]) => v !== undefined)
  );
  const docRef = await addDoc(collection(db, 'banners'), {
    ...cleanData,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
};

export const updateBanner = async (bannerId: string, bannerData: Partial<Banner>): Promise<void> => {
  const cleanData = Object.fromEntries(
    Object.entries(bannerData).filter(([, v]) => v !== undefined)
  );
  await updateDoc(doc(db, 'banners', bannerId), {
    ...cleanData,
    updatedAt: Timestamp.now(),
  });
};

export const deleteBanner = async (bannerId: string): Promise<void> => {
  await updateDoc(doc(db, 'banners', bannerId), { isActive: false });
};
