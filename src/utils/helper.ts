// Pure helper methods extracted from MortgageMap.tsx. Behavior is unchanged;
// this file only relocates the existing functions, the types they use, and
// the storage / script constants they reference internally.
const ROUTE_STORAGE_KEY = "mortgageMap.route.v1";
const GOOGLE_MAPS_SCRIPT_ID = "google-maps-js-api";

export type LatLng = {
  lat: number;
  lng: number;
};

export type Checkpoint = LatLng & {
  name: string;
};

// On-disk shape used by localStorage and the gist. The `name` field is
// optional: auto-generated placeholder names like "Checkpoint 47" are
// stripped at the storage boundary and synthesized back on load. This
// shaves 15–25% off route payloads since most points in long routes
// carry no user-meaningful name.
export type CompactCheckpoint = LatLng & {
  name?: string;
};

// Names matching this pattern are treated as auto-generated placeholders
// and dropped on save. Must stay in sync with the name template used by
// `insertCheckpointAt` in MortgageMap.tsx (`Checkpoint <n+1>`).
const PLACEHOLDER_NAME_RE = /^Checkpoint \d+$/;

export type RouteSegment = {
  start: LatLng;
  end: LatLng;
  km: number;
  startKm: number;
  endKm: number;
};

export function loadStoredNumber(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStoredNumber(key: string, value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {}
}

export function isValidCheckpoint(value: unknown): value is CompactCheckpoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CompactCheckpoint>;
  if (candidate.name !== undefined && typeof candidate.name !== "string") {
    return false;
  }
  return (
    typeof candidate.lat === "number" &&
    typeof candidate.lng === "number" &&
    Number.isFinite(candidate.lat) &&
    Number.isFinite(candidate.lng) &&
    candidate.lat >= -90 &&
    candidate.lat <= 90 &&
    candidate.lng >= -180 &&
    candidate.lng <= 180
  );
}

// Strip auto-generated placeholder names so they don't bloat storage.
// User-renamed checkpoints (anything not matching `PLACEHOLDER_NAME_RE`)
// keep their name verbatim.
export function compactCheckpoints(route: Checkpoint[]): CompactCheckpoint[] {
  return route.map((cp) =>
    PLACEHOLDER_NAME_RE.test(cp.name)
      ? { lat: cp.lat, lng: cp.lng }
      : { lat: cp.lat, lng: cp.lng, name: cp.name },
  );
}

export function expandCheckpoints(compact: CompactCheckpoint[]): Checkpoint[] {
  return compact.map((cp, i) => ({
    lat: cp.lat,
    lng: cp.lng,
    name: cp.name ?? `Checkpoint ${i + 1}`,
  }));
}

export function loadStoredRoute(): Checkpoint[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isValidCheckpoint)) {
      return null;
    }
    return expandCheckpoints(parsed);
  } catch {
    return null;
  }
}

export function saveStoredRoute(route: Checkpoint[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ROUTE_STORAGE_KEY,
      JSON.stringify(compactCheckpoints(route)),
    );
  } catch {
    // ignore quota / serialization errors
  }
}

export function clearStoredRoute(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ROUTE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isApiKeyConfigured(apiKey: string): boolean {
  return Boolean(
    apiKey && apiKey.trim() && apiKey !== "YOUR_GOOGLE_MAPS_API_KEY",
  );
}

export function buildMapsScriptUrl(apiKey: string): string {
  const url = new URL("https://maps.googleapis.com/maps/api/js");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("v", "weekly");
  return url.toString();
}

export function loadGoogleMaps(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isApiKeyConfigured(apiKey)) {
      reject(
        new Error(
          "Missing Google Maps API key. Set VITE_GOOGLE_MAPS_API_KEY in .env.local",
        ),
      );
      return;
    }

    if (window.google?.maps) {
      resolve();
      return;
    }

    const previousAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      previousAuthFailure?.();
      reject(
        new Error(
          "Google Maps rejected this API key. Check that the key is valid, Maps JavaScript API is enabled, billing is enabled, and HTTP referrer restrictions include this site.",
        ),
      );
    };

    const existingScript = document.getElementById(
      GOOGLE_MAPS_SCRIPT_ID,
    ) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener("load", () => {
        if (window.google?.maps) resolve();
        else
          reject(
            new Error(
              "Google Maps script loaded, but window.google.maps is unavailable.",
            ),
          );
      });
      existingScript.addEventListener("error", () => {
        reject(new Error("Failed to load the Google Maps JavaScript file."));
      });
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.src = buildMapsScriptUrl(apiKey);
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps) resolve();
      else
        reject(
          new Error(
            "Google Maps script loaded, but window.google.maps is unavailable.",
          ),
        );
    };
    script.onerror = () => {
      reject(new Error("Failed to load the Google Maps JavaScript file."));
    };
    document.head.appendChild(script);
  });
}

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

// --- GCJ-02 (Mars) <-> WGS-84 conversion ------------------------------------
// AMap returns coordinates in China's mandatory GCJ-02 ("Mars") datum.
// Google Maps JS renders in WGS-84, so AMap output must be converted before
// we plot it. The polynomials below are the standard "eviltransform" form
// used by every open-source library that does this. Accurate to ~1 m within
// mainland China; identity transform outside (where GCJ-02 doesn't apply).
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;
function transformLat(x: number, y: number): number {
  let ret =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret +=
    ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret +=
    ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) *
      2) /
    3;
  return ret;
}
function transformLng(x: number, y: number): number {
  let ret =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret +=
    ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret +=
    ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) *
      2) /
    3;
  return ret;
}
export function outOfChina(lat: number, lng: number): boolean {
  if (lng < 72.004 || lng > 137.8347) return true;
  if (lat < 0.8293 || lat > 55.8271) return true;
  return false;
}
function gcjDelta(lat: number, lng: number): { dLat: number; dLng: number } {
  let dLat = transformLat(lng - 105, lat - 35);
  let dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat =
    (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { dLat, dLng };
}
export function wgs84ToGcj02(
  lat: number,
  lng: number,
): { lat: number; lng: number } {
  if (outOfChina(lat, lng)) return { lat, lng };
  const { dLat, dLng } = gcjDelta(lat, lng);
  return { lat: lat + dLat, lng: lng + dLng };
}
export function gcj02ToWgs84(
  lat: number,
  lng: number,
): { lat: number; lng: number } {
  if (outOfChina(lat, lng)) return { lat, lng };
  // Iteratively invert: start with first-order estimate, then refine once.
  const approx = wgs84ToGcj02(lat, lng);
  const dLat2 = approx.lat - lat;
  const dLng2 = approx.lng - lng;
  return { lat: lat - dLat2, lng: lng - dLng2 };
}

// --- AMap driving directions (mainland China) -------------------------------
// Returns the full driving path as WGS-84 LatLngs, already converted from
// AMap's native GCJ-02 datum. Concatenates every step's `polyline` field.
// Throws on network / API errors; the caller can fall back to Google.
export async function amapDrivingPath(
  apiKey: string,
  origin: LatLng,
  destination: LatLng,
): Promise<LatLng[]> {
  // AMap interprets query-string coords as GCJ-02. Our checkpoints are
  // WGS-84 (Google), so shift them into GCJ-02 before sending, then shift
  // the returned polyline back to WGS-84 for plotting on Google Maps.
  const originGcj = wgs84ToGcj02(origin.lat, origin.lng);
  const destGcj = wgs84ToGcj02(destination.lat, destination.lng);
  const url =
    `https://restapi.amap.com/v3/direction/driving?key=${apiKey}` +
    `&origin=${originGcj.lng.toFixed(6)},${originGcj.lat.toFixed(6)}` +
    `&destination=${destGcj.lng.toFixed(6)},${destGcj.lat.toFixed(6)}` +
    // strategy=2 = shortest distance. Default (0) is fastest and tends
    // to detour onto highways even for short clicks, which produces
    // U-turn loops when the GCJ-shifted destination lands on the far
    // carriageway of a divided road.
    `&strategy=2&extensions=base&output=JSON`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`AMap HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.status !== "1") {
    throw new Error(`AMap error: ${data.info ?? "unknown"} (${data.infocode})`);
  }
  const steps = data.route?.paths?.[0]?.steps ?? [];
  const out: LatLng[] = [];
  for (const step of steps) {
    const polyline: string | undefined = step.polyline;
    if (!polyline) continue;
    for (const pair of polyline.split(";")) {
      const [lngStr, latStr] = pair.split(",");
      const lng = Number(lngStr);
      const lat = Number(latStr);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const wgs = gcj02ToWgs84(lat, lng);
      // Skip exact duplicates at step boundaries.
      const last = out[out.length - 1];
      if (last && last.lat === wgs.lat && last.lng === wgs.lng) continue;
      out.push(wgs);
    }
  }
  // Debug: log first/last raw + converted point so we can eyeball whether
  // the conversion is needed in either direction. Remove once verified.
  if (steps.length > 0 && out.length > 0) {
    const firstRaw = steps[0].polyline?.split(";")[0];
    // eslint-disable-next-line no-console
    console.log(
      "[AMap] sent origin (GCJ)",
      originGcj,
      "raw first pt",
      firstRaw,
      "converted first pt (WGS)",
      out[0],
      "converted last pt (WGS)",
      out[out.length - 1],
    );
  }
  return out;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

// Perpendicular distance, in meters, from point `p` to the line segment
// `a`–`b`, computed in a local equirectangular projection anchored at `a`.
// Accurate enough for RDP simplification at street/walking-route scales.
function pointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const M_PER_DEG = 111320;
  const cosLat = Math.cos((a.lat * Math.PI) / 180);
  const bx = (b.lng - a.lng) * cosLat * M_PER_DEG;
  const by = (b.lat - a.lat) * M_PER_DEG;
  const px = (p.lng - a.lng) * cosLat * M_PER_DEG;
  const py = (p.lat - a.lat) * M_PER_DEG;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  let t = (px * bx + py * by) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = t * bx;
  const cy = t * by;
  return Math.hypot(px - cx, py - cy);
}

// Ramer–Douglas–Peucker polyline simplification. Returns a subset of the
// input points that preserves the path's shape to within `toleranceMeters`
// (perpendicular deviation). Straight runs collapse to their endpoints;
// sharp turns are preserved. Iterative implementation so very long paths
// don't blow the call stack.
export function simplifyPath(
  points: LatLng[],
  toleranceMeters: number,
): LatLng[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let idx = -1;
    const a = points[first];
    const b = points[last];
    for (let i = first + 1; i < last; i++) {
      const d = pointToSegmentMeters(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxDist > toleranceMeters) {
      keep[idx] = true;
      stack.push([first, idx]);
      stack.push([idx, last]);
    }
  }
  const result: LatLng[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

function distanceKm(a: LatLng, b: LatLng): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function interpolateGreatCircle(
  a: LatLng,
  b: LatLng,
  fraction: number,
): LatLng {
  const safeFraction = clamp(fraction, 0, 1);
  const lat1 = toRadians(a.lat);
  const lng1 = toRadians(a.lng);
  const lat2 = toRadians(b.lat);
  const lng2 = toRadians(b.lng);

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
      ),
    );

  if (d === 0) return a;

  const A = Math.sin((1 - safeFraction) * d) / Math.sin(d);
  const B = Math.sin(safeFraction * d) / Math.sin(d);

  const x =
    A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
  const y =
    A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lng = Math.atan2(y, x);

  return { lat: toDegrees(lat), lng: toDegrees(lng) };
}

export function getRouteSegments(route: LatLng[]): {
  segments: RouteSegment[];
  totalKm: number;
} {
  let totalKm = 0;
  const segments: RouteSegment[] = [];

  for (let i = 0; i < route.length - 1; i++) {
    const km = distanceKm(route[i], route[i + 1]);
    segments.push({
      start: route[i],
      end: route[i + 1],
      km,
      startKm: totalKm,
      endKm: totalKm + km,
    });
    totalKm += km;
  }

  return { segments, totalKm };
}

// Takes a pre-computed segments array,
// so callers that already memoize the geometry don't pay the O(n) cost of
// rebuilding the segment list on every render.
export function getPointAlongSegments(
  route: LatLng[],
  segments: RouteSegment[],
  totalKm: number,
  distanceFromStartKm: number,
): LatLng {
  if (route.length === 0) return { lat: 0, lng: 0 };
  if (route.length === 1 || segments.length === 0) return route[0];

  const targetKm = clamp(distanceFromStartKm, 0, totalKm);
  const segment =
    segments.find((s) => targetKm >= s.startKm && targetKm <= s.endKm) ??
    segments[segments.length - 1];
  const fraction =
    segment.km === 0 ? 0 : (targetKm - segment.startKm) / segment.km;

  return interpolateGreatCircle(segment.start, segment.end, fraction);
}

// Variant of getCurrentCheckpoint that takes a pre-computed segments array.
export function getCurrentCheckpointFromSegments(
  route: Checkpoint[],
  segments: RouteSegment[],
  totalKm: number,
  distanceFromStartKm: number,
): string {
  if (route.length === 0) return "Unknown";
  if (route.length === 1 || segments.length === 0) return route[0].name;

  const targetKm = clamp(distanceFromStartKm, 0, totalKm);
  if (targetKm >= totalKm) return route[route.length - 1].name;

  const segmentIndex = segments.findIndex(
    (s) => targetKm >= s.startKm && targetKm <= s.endKm,
  );

  if (segmentIndex < 0) return route[route.length - 1].name;
  return `${route[segmentIndex].name} → ${route[segmentIndex + 1].name}`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function formatCurrencyCents(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

declare global {
  interface Window {
    google?: typeof google;
    gm_authFailure?: () => void;
  }
}
