/** Earth radius in meters (mean). */
const EARTH_RADIUS_M = 6371000;

export type LatLng = { latitude: number; longitude: number };

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two WGS84 points in meters. */
export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Soft-check radius for SO visit vs store geo-tag (meters). */
export const VISIT_LOCATION_SOFT_WARN_METERS = 500;

export function formatDistanceMeters(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function visitDistanceStatus(
  meters: number | null | undefined
): 'ok' | 'far' | 'unknown' {
  if (meters == null || !Number.isFinite(meters)) return 'unknown';
  return meters <= VISIT_LOCATION_SOFT_WARN_METERS ? 'ok' : 'far';
}
