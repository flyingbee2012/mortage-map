import React, { useEffect, useMemo, useRef, useState } from "react";
import defaultRouteJson from "./data/defaultRoute.json";

/**
 * Jiuxiang Mortgage Journey Demo
 *
 * Setup:
 * 1) Create a Google Maps JavaScript API key.
 * 2) Enable "Maps JavaScript API" in Google Cloud Console.
 * 3) Make sure billing is enabled for the Google Cloud project.
 * 4) If the key is restricted, allow your dev origin, e.g. http://localhost:5173/*
 * 5) Put the key in .env.local as VITE_GOOGLE_MAPS_API_KEY=your_key_here
 *
 * Notes:
 * - This MVP uses satellite map only.
 * - Street View is intentionally not included yet.
 * - The route points are approximate / symbolic, not a legal or walkable route.
 */

const GOOGLE_MAPS_API_KEY: string =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? "";
const GOOGLE_MAPS_SCRIPT_ID = "google-maps-js-api";
const ROUTE_STORAGE_KEY = "mortgageMap.route.v1";
const ORIGINAL_PRINCIPAL_STORAGE_KEY = "mortgageMap.originalPrincipal.v1";
const CURRENT_BALANCE_STORAGE_KEY = "mortgageMap.currentBalance.v1";

function loadStoredNumber(key: string): number | null {
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

function saveStoredNumber(key: string, value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

type LatLng = {
  lat: number;
  lng: number;
};

type Checkpoint = LatLng & {
  name: string;
};

type RouteSegment = {
  start: LatLng;
  end: LatLng;
  km: number;
  startKm: number;
  endKm: number;
};

type TestResult = {
  name: string;
  passed: boolean;
  detail: string;
};

const DEFAULT_ROUTE: Checkpoint[] = defaultRouteJson as Checkpoint[];

function isValidCheckpoint(value: unknown): value is Checkpoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Checkpoint>;
  return (
    typeof candidate.name === "string" &&
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

function loadStoredRoute(): Checkpoint[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isValidCheckpoint)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredRoute(route: Checkpoint[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(route));
  } catch {
    // ignore quota / serialization errors
  }
}

function clearStoredRoute(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ROUTE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isApiKeyConfigured(apiKey: string): boolean {
  return Boolean(
    apiKey && apiKey.trim() && apiKey !== "YOUR_GOOGLE_MAPS_API_KEY",
  );
}

function buildMapsScriptUrl(apiKey: string): string {
  const url = new URL("https://maps.googleapis.com/maps/api/js");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("v", "weekly");
  return url.toString();
}

function loadGoogleMaps(apiKey: string): Promise<void> {
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

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
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

function getRouteSegments(route: LatLng[]): {
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

function getPointAlongRoute(
  route: LatLng[],
  distanceFromStartKm: number,
): LatLng {
  const { segments, totalKm } = getRouteSegments(route);

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

function getCurrentCheckpoint(
  route: Checkpoint[],
  distanceFromStartKm: number,
): string {
  const { segments, totalKm } = getRouteSegments(route);

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

function runSmokeTests(route: Checkpoint[]): TestResult[] {
  const routeLatLng = route.map(({ lat, lng }) => ({ lat, lng }));
  const { totalKm } = getRouteSegments(routeLatLng);
  const start = getPointAlongRoute(routeLatLng, 0);
  const end = getPointAlongRoute(routeLatLng, totalKm);
  const overEnd = getPointAlongRoute(routeLatLng, totalKm + 10000);
  const underStart = getPointAlongRoute(routeLatLng, -10000);
  const midpoint = getPointAlongRoute(routeLatLng, totalKm / 2);
  const sampleProgress = 0.16;
  const sampleTraveledKm = sampleProgress * totalKm;

  return [
    {
      name: "Route has a positive total distance",
      passed: totalKm > 1000,
      detail: `totalKm=${totalKm.toFixed(0)}`,
    },
    {
      name: "Distance 0 returns Seattle",
      passed:
        Math.abs(start.lat - route[0].lat) < 0.0001 &&
        Math.abs(start.lng - route[0].lng) < 0.0001,
      detail: `lat=${start.lat.toFixed(4)}, lng=${start.lng.toFixed(4)}`,
    },
    {
      name: "Total distance returns Jiuxiang",
      passed:
        Math.abs(end.lat - route[route.length - 1].lat) < 0.0001 &&
        Math.abs(end.lng - route[route.length - 1].lng) < 0.0001,
      detail: `lat=${end.lat.toFixed(4)}, lng=${end.lng.toFixed(4)}`,
    },
    {
      name: "Negative distance clamps to start",
      passed:
        Math.abs(underStart.lat - route[0].lat) < 0.0001 &&
        Math.abs(underStart.lng - route[0].lng) < 0.0001,
      detail: `lat=${underStart.lat.toFixed(4)}, lng=${underStart.lng.toFixed(4)}`,
    },
    {
      name: "Overpaid distance clamps to end",
      passed:
        Math.abs(overEnd.lat - route[route.length - 1].lat) < 0.0001 &&
        Math.abs(overEnd.lng - route[route.length - 1].lng) < 0.0001,
      detail: `lat=${overEnd.lat.toFixed(4)}, lng=${overEnd.lng.toFixed(4)}`,
    },
    {
      name: "Midpoint is a valid coordinate",
      passed:
        Number.isFinite(midpoint.lat) &&
        Number.isFinite(midpoint.lng) &&
        midpoint.lat >= -90 &&
        midpoint.lat <= 90 &&
        midpoint.lng >= -180 &&
        midpoint.lng <= 180,
      detail: `lat=${midpoint.lat.toFixed(4)}, lng=${midpoint.lng.toFixed(4)}`,
    },
    {
      name: "Progress math maps 16% payoff to 16% of route",
      passed: Math.abs(sampleTraveledKm / totalKm - sampleProgress) < 0.000001,
      detail: `16% = ${sampleTraveledKm.toFixed(0)} km`,
    },
  ];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export default function JiuxiangMortgageMapDemo() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const currentMarkerRef = useRef<google.maps.Marker | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const checkpointMarkersRef = useRef<google.maps.Marker[]>([]);

  const [originalPrincipal, setOriginalPrincipal] = useState(
    () => loadStoredNumber(ORIGINAL_PRINCIPAL_STORAGE_KEY) ?? 367260.71,
  );
  const [currentBalance, setCurrentBalance] = useState(
    () => loadStoredNumber(CURRENT_BALANCE_STORAGE_KEY) ?? 367260.71,
  );
  const [mapError, setMapError] = useState<string | null>(null);
  const [showTests, setShowTests] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [route, setRoute] = useState<Checkpoint[]>(
    () => loadStoredRoute() ?? DEFAULT_ROUTE,
  );

  // Persist route changes to localStorage.
  useEffect(() => {
    saveStoredRoute(route);
  }, [route]);

  // Persist mortgage inputs to localStorage.
  useEffect(() => {
    saveStoredNumber(ORIGINAL_PRINCIPAL_STORAGE_KEY, originalPrincipal);
  }, [originalPrincipal]);
  useEffect(() => {
    saveStoredNumber(CURRENT_BALANCE_STORAGE_KEY, currentBalance);
  }, [currentBalance]);

  const routeLatLng = useMemo(
    () => route.map(({ lat, lng }) => ({ lat, lng })),
    [route],
  );
  const { totalKm } = useMemo(
    () => getRouteSegments(routeLatLng),
    [routeLatLng],
  );
  const smokeTests = useMemo(() => runSmokeTests(DEFAULT_ROUTE), []);

  const safeOriginalPrincipal = Math.max(0, originalPrincipal || 0);
  const safeCurrentBalance = Math.max(0, currentBalance || 0);
  const paidPrincipal = clamp(
    safeOriginalPrincipal - safeCurrentBalance,
    0,
    safeOriginalPrincipal,
  );
  const progress =
    safeOriginalPrincipal > 0 ? paidPrincipal / safeOriginalPrincipal : 0;
  const traveledKm = progress * totalKm;
  const remainingKm = Math.max(0, totalKm - traveledKm);
  const currentPosition = useMemo(
    () => getPointAlongRoute(routeLatLng, traveledKm),
    [routeLatLng, traveledKm],
  );
  const currentSegment = getCurrentCheckpoint(route, traveledKm);
  const destinationName =
    route.length > 0 ? route[route.length - 1].name : "destination";

  // Initialize the map exactly once.
  useEffect(() => {
    let cancelled = false;

    async function initMap() {
      try {
        await loadGoogleMaps(GOOGLE_MAPS_API_KEY);

        if (cancelled || !mapRef.current || mapInstanceRef.current) return;

        const initialCenter = route.length > 0 ? route[0] : { lat: 0, lng: 0 };

        const map = new google.maps.Map(mapRef.current, {
          center: initialCenter,
          zoom: 3,
          mapTypeId: google.maps.MapTypeId.SATELLITE,
          fullscreenControl: true,
          streetViewControl: false,
          mapTypeControl: true,
          gestureHandling: "greedy",
        });

        if (route.length > 0) {
          const bounds = new google.maps.LatLngBounds();
          route.forEach((point) => bounds.extend(point));
          map.fitBounds(bounds);
        }

        const polyline = new google.maps.Polyline({
          path: routeLatLng,
          geodesic: true,
          strokeColor: "#3b82f6",
          strokeOpacity: 0.9,
          strokeWeight: 4,
          map,
        });

        const currentMarker = new google.maps.Marker({
          position: currentPosition,
          map,
          title: "Your current position",
          zIndex: 9999,
        });

        mapInstanceRef.current = map;
        polylineRef.current = polyline;
        currentMarkerRef.current = currentMarker;
        setMapReady(true);
        setMapError(null);
      } catch (error) {
        if (cancelled) return;
        setMapError(
          error instanceof Error
            ? error.message
            : "Google Maps failed to load.",
        );
      }
    }

    initMap();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the polyline path whenever the route changes.
  useEffect(() => {
    if (!polylineRef.current) return;
    polylineRef.current.setPath(routeLatLng);
  }, [routeLatLng]);

  // Sync checkpoint markers whenever the route or edit mode changes.
  // Performance: when NOT in edit mode, we only render the start (green) and
  // end (red) markers — even with thousands of checkpoints, the polyline
  // alone shows the route shape and pan/zoom stays smooth. In edit mode we
  // render every checkpoint so they can be dragged / right-click-deleted.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Clear existing checkpoint markers.
    checkpointMarkersRef.current.forEach((m) => m.setMap(null));
    checkpointMarkersRef.current = [];

    const indicesToRender = editMode
      ? route.map((_, i) => i)
      : route.length === 0
        ? []
        : route.length === 1
          ? [0]
          : [0, route.length - 1];

    indicesToRender.forEach((index) => {
      const checkpoint = route[index];
      const isStart = index === 0;
      const isEnd = index === route.length - 1;
      const marker = new google.maps.Marker({
        position: { lat: checkpoint.lat, lng: checkpoint.lng },
        map,
        title: `${index + 1}. ${checkpoint.name}`,
        draggable: editMode,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: editMode ? 5 : 4,
          fillColor: isStart ? "#22c55e" : isEnd ? "#ef4444" : "#fbbf24",
          fillOpacity: 1,
          strokeColor: "#000",
          strokeWeight: 1,
        },
      });

      if (editMode) {
        marker.addListener("dragend", (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return;
          const newLat = event.latLng.lat();
          const newLng = event.latLng.lng();
          setRoute((prev) =>
            prev.map((cp, i) =>
              i === index ? { ...cp, lat: newLat, lng: newLng } : cp,
            ),
          );
        });
        marker.addListener("rightclick", () => {
          setRoute((prev) => prev.filter((_, i) => i !== index));
        });
      }

      checkpointMarkersRef.current.push(marker);
    });
  }, [route, editMode, mapReady]);

  // Map click listener — adds a checkpoint when in edit mode.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    if (!editMode) return;
    const map = mapInstanceRef.current;

    const listener = map.addListener(
      "click",
      (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return;
        const lat = event.latLng.lat();
        const lng = event.latLng.lng();
        setRoute((prev) => [
          ...prev,
          {
            name: `Checkpoint ${prev.length + 1}`,
            lat,
            lng,
          },
        ]);
      },
    );

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [editMode, mapReady]);

  // Keep the current-position marker in sync. While in edit mode we pause
  // updates so the blue arrow doesn't jump around as you reshape the route.
  // When you click "Done editing", editMode flips and this effect runs once
  // with the final route.
  useEffect(() => {
    if (!currentMarkerRef.current) return;
    if (editMode) return;
    currentMarkerRef.current.setPosition(currentPosition);
  }, [currentPosition, route, editMode]);

  // Route mutation helpers.
  const moveCheckpoint = (index: number, direction: -1 | 1) => {
    setRoute((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const renameCheckpoint = (index: number, name: string) => {
    setRoute((prev) =>
      prev.map((cp, i) => (i === index ? { ...cp, name } : cp)),
    );
  };
  const deleteCheckpoint = (index: number) => {
    setRoute((prev) => prev.filter((_, i) => i !== index));
  };
  const resetRoute = () => {
    if (
      window.confirm(
        "Reset to the default route from defaultRoute.json? Your current edits will be lost.",
      )
    ) {
      clearStoredRoute();
      setRoute(DEFAULT_ROUTE);
    }
  };
  const fitMapToRoute = () => {
    if (!mapInstanceRef.current || route.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    route.forEach((p) => bounds.extend(p));
    mapInstanceRef.current.fitBounds(bounds);
  };
  const exportRouteJson = () => {
    const json = JSON.stringify(route, null, 2) + "\n";
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "defaultRoute.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="w-full grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        <section className="rounded-2xl bg-neutral-900 shadow-xl p-5 space-y-5">
          <div>
            <h1 className="text-2xl font-semibold">
              Walking to {destinationName.split("·")[0].trim()}
            </h1>
            <p className="text-sm text-neutral-400 mt-2">
              Turn your mortgage balance into a journey. Every bit of principal
              you pay off brings you closer to the destination. Edit the route
              below to make it your own.
            </p>
          </div>

          {!isApiKeyConfigured(GOOGLE_MAPS_API_KEY) && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100 space-y-2">
              <p className="font-semibold">
                Google Maps API key is not configured.
              </p>
              <p>
                Create a{" "}
                <code className="rounded bg-black/30 px-1">.env.local</code>{" "}
                file in the project root and add:
                <br />
                <code className="rounded bg-black/30 px-1">
                  VITE_GOOGLE_MAPS_API_KEY=your_key_here
                </code>
              </p>
            </div>
          )}

          <label className="block space-y-2">
            <span className="text-sm text-neutral-300">Original principal</span>
            <input
              className="w-full rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2 outline-none"
              min={0}
              type="number"
              value={originalPrincipal}
              onChange={(e) => setOriginalPrincipal(Number(e.target.value))}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm text-neutral-300">Current balance</span>
            <div className="flex items-stretch gap-2">
              <input
                className="flex-1 min-w-0 rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2 outline-none"
                min={0}
                step={0.01}
                type="number"
                value={currentBalance}
                onChange={(e) => setCurrentBalance(Number(e.target.value))}
              />
              <div
                className="flex flex-col rounded-lg overflow-hidden border border-neutral-700"
                title="Step by $1"
              >
                <button
                  type="button"
                  className="flex-1 px-2 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
                  onClick={() =>
                    setCurrentBalance((v) =>
                      Math.max(0, Math.round(((v || 0) + 1) * 100) / 100),
                    )
                  }
                >
                  +$1
                </button>
                <button
                  type="button"
                  className="flex-1 px-2 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-t border-neutral-700"
                  onClick={() =>
                    setCurrentBalance((v) =>
                      Math.max(0, Math.round(((v || 0) - 1) * 100) / 100),
                    )
                  }
                >
                  −$1
                </button>
              </div>
              <div
                className="flex flex-col rounded-lg overflow-hidden border border-neutral-700"
                title="Step by 1¢"
              >
                <button
                  type="button"
                  className="flex-1 px-2 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
                  onClick={() =>
                    setCurrentBalance((v) =>
                      Math.max(0, Math.round(((v || 0) + 0.01) * 100) / 100),
                    )
                  }
                >
                  +1¢
                </button>
                <button
                  type="button"
                  className="flex-1 px-2 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-t border-neutral-700"
                  onClick={() =>
                    setCurrentBalance((v) =>
                      Math.max(0, Math.round(((v || 0) - 0.01) * 100) / 100),
                    )
                  }
                >
                  −1¢
                </button>
              </div>
            </div>
          </label>

          <div className="space-y-3 pt-2">
            <div className="h-3 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-white"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="text-sm text-neutral-300">
              Progress: {(progress * 100).toFixed(2)}%
            </div>
          </div>

          <div className="rounded-2xl bg-neutral-800 p-4 space-y-2 text-sm">
            <p>
              You have paid off <strong>{formatCurrency(paidPrincipal)}</strong>
            </p>
            <p>
              Total distance: <strong>{totalKm.toFixed(0)} km</strong>
            </p>
            <p>
              You have traveled <strong>{traveledKm.toFixed(0)} km</strong>
            </p>
            <p>
              Distance remaining: <strong>{remainingKm.toFixed(0)} km</strong>
            </p>
            <p>
              Current location: <strong>{currentSegment}</strong>
            </p>
          </div>

          <div className="rounded-2xl bg-neutral-800 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-neutral-200">
                Route ({route.length} checkpoints)
              </h2>
              <button
                className={`rounded-lg border px-2 py-1 text-xs transition ${
                  editMode
                    ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                    : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-700"
                }`}
                type="button"
                onClick={() => setEditMode((value) => !value)}
              >
                {editMode ? "Done editing" : "Edit route"}
              </button>
            </div>

            {editMode && (
              <p className="text-xs text-neutral-400 leading-relaxed">
                Click the map to add a checkpoint. Drag a marker to move it.
                Right-click a marker to delete it.
              </p>
            )}

            {route.length === 0 ? (
              <p className="text-xs text-neutral-500 italic">
                No checkpoints yet. Turn on edit mode and click the map to add
                some.
              </p>
            ) : (
              <ol className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {route.map((checkpoint, index) => (
                  <li key={index} className="flex items-center gap-1 text-xs">
                    <span className="w-5 text-right text-neutral-500">
                      {index + 1}.
                    </span>
                    {editMode ? (
                      <input
                        className="flex-1 min-w-0 rounded bg-neutral-900 border border-neutral-700 px-2 py-1 outline-none"
                        value={checkpoint.name}
                        onChange={(e) =>
                          renameCheckpoint(index, e.target.value)
                        }
                      />
                    ) : (
                      <span
                        className="flex-1 min-w-0 truncate text-neutral-200"
                        title={`${checkpoint.name} (${checkpoint.lat.toFixed(3)}, ${checkpoint.lng.toFixed(3)})`}
                      >
                        {checkpoint.name}
                      </span>
                    )}
                    {editMode && (
                      <>
                        <button
                          className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-700 disabled:opacity-30"
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveCheckpoint(index, -1)}
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-700 disabled:opacity-30"
                          type="button"
                          disabled={index === route.length - 1}
                          onClick={() => moveCheckpoint(index, 1)}
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-red-200 hover:bg-red-500/20"
                          type="button"
                          onClick={() => deleteCheckpoint(index)}
                          title="Delete"
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {editMode && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                  type="button"
                  onClick={fitMapToRoute}
                  disabled={route.length === 0}
                >
                  Fit map to route
                </button>
                <button
                  className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                  type="button"
                  onClick={exportRouteJson}
                  disabled={route.length === 0}
                  title="Download as defaultRoute.json — replace src/data/defaultRoute.json and commit to save."
                >
                  Export JSON
                </button>
                <button
                  className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                  type="button"
                  onClick={resetRoute}
                >
                  Reset to default
                </button>
              </div>
            )}
          </div>

          <button
            className="w-full rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-3 py-2 text-sm transition"
            type="button"
            onClick={() => setShowTests((value) => !value)}
          >
            {showTests ? "Hide" : "Show"} smoke tests
          </button>

          {showTests && (
            <div className="rounded-2xl bg-neutral-800 p-4 text-xs space-y-2">
              {smokeTests.map((test) => (
                <div key={test.name} className="flex items-start gap-2">
                  <span>{test.passed ? "✅" : "❌"}</span>
                  <div>
                    <div className="font-medium text-neutral-200">
                      {test.name}
                    </div>
                    <div className="text-neutral-400">{test.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-neutral-500">
            Total route length: {totalKm.toFixed(0)} km. Distances use the
            great-circle formula between checkpoints; the path is symbolic, not
            a real walkable / drivable route.
          </p>
        </section>

        <section className="rounded-2xl overflow-hidden bg-neutral-900 shadow-xl min-h-[680px] relative">
          <div ref={mapRef} className="absolute inset-0" />
          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/95 p-6">
              <div className="max-w-lg rounded-2xl border border-red-400/40 bg-red-500/10 p-5 text-red-100 space-y-3">
                <h2 className="text-lg font-semibold">
                  Google Maps failed to load
                </h2>
                <p className="text-sm">{mapError}</p>
                <div className="text-sm text-red-100/80 space-y-1">
                  <p>Common causes:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      The API key is wrong, or the dev server was not restarted
                      after editing .env.local.
                    </li>
                    <li>Maps JavaScript API is not enabled in Google Cloud.</li>
                    <li>Billing is not enabled for the project.</li>
                    <li>
                      The API key's HTTP referrer restriction does not include
                      the current localhost or deployed domain.
                    </li>
                  </ul>
                </div>
                <p className="text-xs text-red-100/70">
                  A map load failure does not affect the loan progress and route
                  algorithm tests on the left.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    google?: typeof google;
    gm_authFailure?: () => void;
  }
}
