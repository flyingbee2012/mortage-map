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
  } catch {
    // ignore
  }
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

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
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
