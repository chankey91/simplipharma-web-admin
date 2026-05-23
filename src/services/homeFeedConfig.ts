import { doc, getDoc, onSnapshot, setDoc, db } from './firebase';
import { serverTimestamp } from 'firebase/firestore';

export const HOME_FEED_COLLECTION = 'home_feed_config';
export const HOME_FEED_DOC_ID = 'main';

export const HOME_FEED_SLOT_CAP = 8;

export interface HomeFeedConfigState {
  showRecommended: boolean;
  showFeatured: boolean;
  recommendedMedicineIds: string[];
  featuredMedicineIds: string[];
  recommendedSectionTitle: string;
  featuredSectionTitle: string;
}

export const DEFAULT_SECTION_TITLES = {
  recommended: 'Recommended for you',
  featured: 'Featured picks',
} as const;

export function emptyHomeFeedConfig(): HomeFeedConfigState {
  return {
    showRecommended: true,
    showFeatured: true,
    recommendedMedicineIds: [],
    featuredMedicineIds: [],
    recommendedSectionTitle: DEFAULT_SECTION_TITLES.recommended,
    featuredSectionTitle: DEFAULT_SECTION_TITLES.featured,
  };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
}

function capUniqueIds(ids: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

export function parseHomeFeedData(data: Record<string, unknown> | undefined): HomeFeedConfigState {
  const base = emptyHomeFeedConfig();
  if (!data) return base;
  if (typeof data.showRecommended === 'boolean') base.showRecommended = data.showRecommended;
  if (typeof data.showFeatured === 'boolean') base.showFeatured = data.showFeatured;
  base.recommendedMedicineIds = capUniqueIds(asStringArray(data.recommendedMedicineIds), HOME_FEED_SLOT_CAP);
  base.featuredMedicineIds = capUniqueIds(asStringArray(data.featuredMedicineIds), HOME_FEED_SLOT_CAP);
  const rt = data.recommendedSectionTitle;
  const ft = data.featuredSectionTitle;
  if (typeof rt === 'string' && rt.trim()) base.recommendedSectionTitle = rt.trim().slice(0, 80);
  if (typeof ft === 'string' && ft.trim()) base.featuredSectionTitle = ft.trim().slice(0, 80);
  return base;
}

export async function fetchHomeFeedConfigOnce(): Promise<HomeFeedConfigState> {
  const ref = doc(db, HOME_FEED_COLLECTION, HOME_FEED_DOC_ID);
  const snap = await getDoc(ref);
  return parseHomeFeedData(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined);
}

export function subscribeHomeFeedConfig(
  onValue: (v: HomeFeedConfigState) => void,
  onError?: (e: Error) => void
): () => void {
  const ref = doc(db, HOME_FEED_COLLECTION, HOME_FEED_DOC_ID);
  return onSnapshot(
    ref,
    (snap) => {
      const v = parseHomeFeedData(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined);
      onValue(v);
    },
    (err) => onError?.(err as Error)
  );
}

export async function saveHomeFeedConfig(updatedByUid: string, state: HomeFeedConfigState): Promise<void> {
  const ref = doc(db, HOME_FEED_COLLECTION, HOME_FEED_DOC_ID);
  const payload = {
    showRecommended: !!state.showRecommended,
    showFeatured: !!state.showFeatured,
    recommendedMedicineIds: capUniqueIds(state.recommendedMedicineIds || [], HOME_FEED_SLOT_CAP),
    featuredMedicineIds: capUniqueIds(state.featuredMedicineIds || [], HOME_FEED_SLOT_CAP),
    recommendedSectionTitle: state.recommendedSectionTitle?.trim() || DEFAULT_SECTION_TITLES.recommended,
    featuredSectionTitle: state.featuredSectionTitle?.trim() || DEFAULT_SECTION_TITLES.featured,
    updatedAt: serverTimestamp(),
    updatedBy: updatedByUid,
  };
  await setDoc(ref, payload, { merge: true });
}
