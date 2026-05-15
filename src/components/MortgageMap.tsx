import { useEffect, useMemo, useRef, useState } from "react";
import { DesktopControlPanel } from "./DesktopControlPanel";
import { MobileControlPanel } from "./MobileControlPanel";
import { MapView } from "./MapView";
import {
  Checkpoint,
  clamp,
  compactCheckpoints,
  getCurrentCheckpointFromSegments,
  getPointAlongSegments,
  getRouteSegments,
  LatLng,
  loadGoogleMaps,
  loadStoredNumber,
  loadStoredRoute,
  saveStoredNumber,
  saveStoredRoute,
  clearStoredRoute,
} from "../utils/helper";
import { isGistConfigured, loadFromGist, saveToGist } from "../utils/gistStore";

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
const ORIGINAL_PRINCIPAL_STORAGE_KEY = "mortgageMap.originalPrincipal.v1";
const CURRENT_BALANCE_STORAGE_KEY = "mortgageMap.currentBalance.v1";

// Lazy loader for the bundled default route. The JSON is only needed when:
//   1. localStorage has no stored route AND the gist has no route either
//      (genuine first run / cleared storage with no remote sync yet)
//   2. the user clicks "Reset to default" in the desktop edit-route flow
// Splitting it into its own chunk via dynamic import() keeps it out of the
// initial bundle for returning users, who almost always have a stored route.
// The promise is memoized so concurrent callers share a single fetch.
let routeJsonPromise: Promise<Checkpoint[]> | null = null;
function loadRouteFromJson(): Promise<Checkpoint[]> {
  if (routeJsonPromise === null) {
    routeJsonPromise = import("../data/defaultRoute.json").then(
      (mod) => mod.default as Checkpoint[],
    );
  }
  return routeJsonPromise;
}

export default function JiuXiangMortgageMap() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const currentMarkerRef = useRef<google.maps.Marker | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const checkpointMarkersRef = useRef<google.maps.Marker[]>([]);

  // Snapshot of the principal/balance values at app load. Used by the Reset
  // button to restore inputs to their initial state without touching
  // localStorage. Stored in a ref so it persists across renders and is not
  // affected by later state updates.
  const initialPrincipalRef = useRef<number>(
    loadStoredNumber(ORIGINAL_PRINCIPAL_STORAGE_KEY) ?? 367260.71,
  );
  const initialBalanceRef = useRef<number>(
    loadStoredNumber(CURRENT_BALANCE_STORAGE_KEY) ?? 367260.71,
  );
  const [originalPrincipal, setOriginalPrincipal] = useState(
    () => initialPrincipalRef.current,
  );
  const [currentBalance, setCurrentBalance] = useState(
    () => initialBalanceRef.current,
  );
  // Raw text shown in the inputs. We keep this separate from the numeric
  // state so partial entries like "3." or "3.80" survive while typing
  // (Number("3.") === 3 would otherwise wipe the trailing period on every
  // keystroke).
  const [originalPrincipalText, setOriginalPrincipalText] = useState(() =>
    String(initialPrincipalRef.current),
  );
  const [currentBalanceText, setCurrentBalanceText] = useState(() =>
    String(initialBalanceRef.current),
  );
  // A valid entry is a non-negative decimal number, optionally with a single
  // decimal point. Empty string is treated as invalid here so we can disable
  // Save / step buttons until the user types something.
  // Allowed examples: "0", "34", "45.56", "0.99", ".5", "34."
  // Rejected examples: "", "abc", "1.2.3", "-5", "1e3", "1,000"
  const NUMERIC_INPUT_RE = /^(?:\d+\.?\d*|\.\d+)$/;
  const isValidNumericInput = (s: string): boolean =>
    NUMERIC_INPUT_RE.test(s.trim());
  const principalValid = isValidNumericInput(originalPrincipalText);
  const balanceSyntaxValid = isValidNumericInput(currentBalanceText);
  // Cross-field rule: current balance cannot exceed original principal.
  // Only meaningful when both fields parse as numbers — otherwise we let
  // the per-field syntax errors speak for themselves.
  const balanceExceedsPrincipal =
    principalValid &&
    balanceSyntaxValid &&
    Number(currentBalanceText.trim()) > Number(originalPrincipalText.trim());
  const balanceValid = balanceSyntaxValid && !balanceExceedsPrincipal;
  const inputsValid = principalValid && balanceValid;

  // While the user is typing we ONLY update the text state — no parsing,
  // no numeric-state updates, so none of the downstream calculations
  // (route position, marker, distances) re-run on every keystroke. We
  // commit the parsed number on blur (or on Enter, see input handlers).
  const commitPrincipalText = () => {
    const raw = originalPrincipalText.trim();
    if (!isValidNumericInput(raw)) {
      // Invalid input: snap the text back to the last valid number so the
      // committed state stays clean.
      setOriginalPrincipalText(String(originalPrincipal));
      return;
    }
    const n = Number(raw);
    setOriginalPrincipal(n);
    setOriginalPrincipalText(String(n));
  };
  const commitBalanceText = () => {
    const raw = currentBalanceText.trim();
    if (!isValidNumericInput(raw)) {
      setCurrentBalanceText(String(currentBalance));
      return;
    }
    const n = Number(raw);
    // Reject values that exceed the original principal.
    if (n > originalPrincipal) {
      setCurrentBalanceText(String(currentBalance));
      return;
    }
    setCurrentBalance(n);
    setCurrentBalanceText(String(n));
  };
  // Updater that bumps the numeric balance AND keeps the text input in sync.
  // Used by the +/- step buttons. Clamps to [0, originalPrincipal].
  const stepCurrentBalance = (delta: number) => {
    setCurrentBalance((v) => {
      const raw = Math.round(((v || 0) + delta) * 100) / 100;
      const next = clamp(raw, 0, originalPrincipal);
      setCurrentBalanceText(String(next));
      return next;
    });
  };
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [editMode, setEditMode] = useState(false);
  // True when the viewport is at Tailwind's `lg` breakpoint (>=1024px).
  // Drives the mobile-friendly mode: map on top, no route list, no
  // Save/Reset buttons, read-only mortgage inputs.
  const [isLargeScreen, setIsLargeScreen] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => setIsLargeScreen(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  // When the layout swaps between mobile and desktop the map's container
  // changes size. Google Maps doesn't observe its own container, so we have
  // to nudge it to recompute the viewport — otherwise the area that was
  // hidden during initial render shows up as black space. The rAF defers
  // the trigger until after the browser has applied the new layout.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const id = window.requestAnimationFrame(() => {
      const center = map.getCenter();
      google.maps.event.trigger(map, "resize");
      if (center) map.setCenter(center);
    });
    return () => window.cancelAnimationFrame(id);
  }, [isLargeScreen, mapReady]);
  // Pixels of the map currently hidden by the mobile bottom sheet (0 on
  // desktop). The sheet reports its visible height here so all map
  // recentering operations can offset their target to keep the point of
  // interest in the visible (top) portion of the map instead of behind
  // the sheet.
  const [bottomOverlayPx, setBottomOverlayPx] = useState(0);
  // Pan the map so `target` lands at the visible (un-occluded) center.
  // panBy with a positive y shifts the map's center DOWN, which renders
  // the target higher on screen by overlay/2 pixels — exactly the offset
  // needed to move it from the geometric center to the center of the
  // area above the sheet.
  const panMapToVisible = (
    map: google.maps.Map,
    target: google.maps.LatLngLiteral,
  ) => {
    map.panTo(target);
    if (bottomOverlayPx > 0) map.panBy(0, bottomOverlayPx / 2);
  };
  // Approximate visible-bounds check: the geographical bounds returned by
  // Google Maps cover the full map div, but the bottom `bottomOverlayPx`
  // pixels are hidden by the sheet. We treat anything in that bottom band
  // as out-of-view so auto-pan kicks in.
  const isVisibleInMap = (
    map: google.maps.Map,
    target: google.maps.LatLngLiteral,
  ): boolean => {
    const bounds = map.getBounds();
    if (!bounds) return false;
    if (!bounds.contains(target)) return false;
    if (bottomOverlayPx <= 0) return true;
    const mapH = map.getDiv().offsetHeight;
    if (mapH <= 0) return true;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    // Linear approximation in latitude — fine for the small viewports
    // and mid-latitudes this app is used at.
    const visibleSouthLat =
      sw.lat() + (ne.lat() - sw.lat()) * (bottomOverlayPx / mapH);
    return target.lat >= visibleSouthLat;
  };
  const [selectedCheckpointIndex, setSelectedCheckpointIndex] = useState<
    number | null
  >(null);
  const [route, setRoute] = useState<Checkpoint[]>(
    () => loadStoredRoute() ?? [],
  );
  // First-run / cleared-storage bootstrap: when the initial route came back
  // empty (no stored route), fetch the bundled default lazily and adopt it.
  // Stored-route users skip this entirely — the JSON chunk is never loaded.
  useEffect(() => {
    if (route.length > 0) return;
    let cancelled = false;
    loadRouteFromJson().then((def) => {
      if (cancelled) return;
      setRoute(def);
    });
    return () => {
      cancelled = true;
    };
    // Only runs once on mount; subsequent route changes shouldn't re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Snapshot of the route taken when edit mode begins, so Cancel can revert.
  const editSnapshotRef = useRef<Checkpoint[] | null>(null);
  // Ref to the currently selected list item, so we can scroll it into view
  // when the user clicks its marker on the map.
  const selectedListItemRef = useRef<HTMLLIElement | null>(null);

  // Ref mirror of selectedCheckpointIndex so the marker-build effect can
  // read the latest value without listing it as a dep (which would force a
  // full marker rebuild on every selection change).
  const selectedIndexRef = useRef<number | null>(selectedCheckpointIndex);
  useEffect(() => {
    selectedIndexRef.current = selectedCheckpointIndex;
  }, [selectedCheckpointIndex]);

  // Clear selection if the route shrinks past the selected index.
  useEffect(() => {
    if (
      selectedCheckpointIndex !== null &&
      selectedCheckpointIndex >= route.length
    ) {
      setSelectedCheckpointIndex(null);
    }
  }, [route.length, selectedCheckpointIndex]);

  // Scroll the selected list item into view when selection changes.
  useEffect(() => {
    if (selectedCheckpointIndex === null) return;
    selectedListItemRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedCheckpointIndex]);

  // Pan the map to the selected checkpoint if it's outside the current view.
  useEffect(() => {
    if (selectedCheckpointIndex === null) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    const cp = route[selectedCheckpointIndex];
    if (!cp) return;
    const target = { lat: cp.lat, lng: cp.lng };
    if (!isVisibleInMap(map, target)) {
      panMapToVisible(map, target);
    }
  }, [selectedCheckpointIndex, route, bottomOverlayPx]);

  // Persist route changes to localStorage — but only when NOT editing,
  // so edits stay tentative until the user clicks Done.
  useEffect(() => {
    if (editMode) return;
    saveStoredRoute(route);
  }, [route, editMode]);

  const startEditingRoute = () => {
    editSnapshotRef.current = route;
    setEditMode(true);
  };
  const finishEditingRoute = () => {
    editSnapshotRef.current = null;
    setEditMode(false);
    if (!isGistConfigured()) {
      showFlash("local-only", "✓ Route saved locally");
      return;
    }
    showFlash("synced", "Syncing route…");
    saveToGist({
      originalPrincipal,
      currentBalance,
      route,
    }).then((ok) => {
      if (ok) {
        showFlash("synced", "✓ Route synced to cloud");
      } else {
        showFlash(
          "local-only",
          "⚠ Route saved locally only (cloud sync failed)",
        );
      }
    });
  };
  const cancelEditingRoute = () => {
    if (editSnapshotRef.current) {
      setRoute(editSnapshotRef.current);
    }
    editSnapshotRef.current = null;
    setEditMode(false);
  };

  // Mortgage inputs are persisted manually via the Save button below; no
  // auto-save effect, so editing the values is tentative until the user
  // explicitly clicks Save.
  // Tracks the values most recently persisted to localStorage. Used by the
  // Save handler to skip writes (and the "Saved" flash) when nothing has
  // changed since the previous save / initial load.
  const lastSavedPrincipalRef = useRef<number>(initialPrincipalRef.current);
  const lastSavedBalanceRef = useRef<number>(initialBalanceRef.current);
  // Transient "Saved" message shown next to the Save button. Cleared after
  // ~2s. The timer ref lets a rapid second Save reset the countdown without
  // stacking timeouts.
  const [savedFlash, setSavedFlash] = useState<null | {
    kind: "synced" | "local-only" | "loaded";
    message: string;
  }>(null);
  const savedFlashTimerRef = useRef<number | null>(null);
  // True from app start until the initial gist load resolves (success or
  // failure). Used to show a "Syncing from cloud…" banner and dim the
  // mortgage value displays so users know the values they're seeing may
  // still get replaced by a fresher remote copy. Defaults to false when
  // the gist isn't configured — there's nothing to wait for.
  const [isLoadingRemote, setIsLoadingRemote] = useState<boolean>(() =>
    isGistConfigured(),
  );
  const showFlash = (
    kind: "synced" | "local-only" | "loaded",
    message: string,
  ) => {
    setSavedFlash({ kind, message });
    if (savedFlashTimerRef.current !== null) {
      window.clearTimeout(savedFlashTimerRef.current);
    }
    savedFlashTimerRef.current = window.setTimeout(() => {
      setSavedFlash(null);
      savedFlashTimerRef.current = null;
    }, 2500);
  };

  // On mount: try to pull the latest mortgage values from the shared gist
  // so that changes made on another device (e.g. desktop save → iPhone
  // refresh) are reflected here. Falls through silently if the gist is
  // not configured or the network call fails — localStorage values loaded
  // synchronously above remain in effect as the offline fallback.
  useEffect(() => {
    if (!isGistConfigured()) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await loadFromGist();
        if (cancelled || !remote) return;
        // Adopt the remote values as the new "committed" state, mirror them
        // into localStorage as a cache, and update the Reset/save baselines
        // so a subsequent Save is a no-op unless the user actually changes
        // something.
        setOriginalPrincipal(remote.originalPrincipal);
        setCurrentBalance(remote.currentBalance);
        setOriginalPrincipalText(String(remote.originalPrincipal));
        setCurrentBalanceText(String(remote.currentBalance));
        saveStoredNumber(
          ORIGINAL_PRINCIPAL_STORAGE_KEY,
          remote.originalPrincipal,
        );
        saveStoredNumber(CURRENT_BALANCE_STORAGE_KEY, remote.currentBalance);
        lastSavedPrincipalRef.current = remote.originalPrincipal;
        lastSavedBalanceRef.current = remote.currentBalance;
        initialPrincipalRef.current = remote.originalPrincipal;
        initialBalanceRef.current = remote.currentBalance;
        // Route sync: prefer the explicit `remote.route` (written by
        // "Done editing" on any device) when present. It's the source of
        // truth and overrides both localStorage and the bundled
        // defaultRoute.json. If the gist has no route field yet (e.g. a
        // fresh gist that's only stored mortgage values so far), keep
        // whatever we already have locally.
        if (remote.route && remote.route.length > 0) {
          setRoute(remote.route);
          saveStoredRoute(remote.route);
        }
        // Only flash if the remote actually differed from what was loaded
        // from localStorage on startup, otherwise it's a no-op.
      } finally {
        if (!cancelled) setIsLoadingRemote(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveMortgageInputs = () => {
    if (!inputsValid) return;
    if (
      originalPrincipal === lastSavedPrincipalRef.current &&
      currentBalance === lastSavedBalanceRef.current
    ) {
      // Nothing changed since the last save / initial load — no-op.
      return;
    }
    // Confirm with the user before persisting. Save writes to localStorage
    // and (if configured) the shared gist, so a misclick can clobber the
    // previously-good values across all devices.
    if (!window.confirm("Save the current mortgage values?")) return;
    saveStoredNumber(ORIGINAL_PRINCIPAL_STORAGE_KEY, originalPrincipal);
    saveStoredNumber(CURRENT_BALANCE_STORAGE_KEY, currentBalance);
    lastSavedPrincipalRef.current = originalPrincipal;
    lastSavedBalanceRef.current = currentBalance;
    // Optimistically show the local-save toast immediately, then upgrade or
    // downgrade it once the gist write resolves. If the gist isn't
    // configured at all, just show "Saved locally".
    if (!isGistConfigured()) {
      showFlash("local-only", "✓ Saved locally");
      return;
    }
    showFlash("synced", "Saving…");
    saveToGist({
      originalPrincipal,
      currentBalance,
      // Echo back the current route so this PATCH doesn't strip it from
      // the gist (PATCH replaces the whole file).
      route,
    }).then((ok) => {
      if (ok) {
        showFlash("synced", "✓ Saved & synced to cloud");
      } else {
        showFlash("local-only", "⚠ Saved locally only (cloud sync failed)");
      }
    });
  };
  const resetMortgageInputs = () => {
    setOriginalPrincipal(initialPrincipalRef.current);
    setCurrentBalance(initialBalanceRef.current);
    setOriginalPrincipalText(String(initialPrincipalRef.current));
    setCurrentBalanceText(String(initialBalanceRef.current));
  };

  // Stable geometry projection: returns the SAME array reference whenever
  // every checkpoint's lat/lng is unchanged, even if `route` itself is a new
  // array (e.g. after a rename). Lets all the geometry-derived memos and
  // effects skip work when only names change.
  const routeLatLngRef = useRef<LatLng[]>([]);
  const routeLatLng = useMemo(() => {
    const next = route.map(({ lat, lng }) => ({ lat, lng }));
    const prev = routeLatLngRef.current;
    if (
      prev.length === next.length &&
      prev.every((p, i) => p.lat === next[i].lat && p.lng === next[i].lng)
    ) {
      return prev;
    }
    routeLatLngRef.current = next;
    return next;
  }, [route]);
  // Compute segments + totalKm once per geometry change and reuse them for
  // currentPosition / currentSegment instead of having those helpers walk
  // the route a second and third time per render.
  const { segments: routeSegments, totalKm } = useMemo(
    () => getRouteSegments(routeLatLng),
    [routeLatLng],
  );

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
    () =>
      getPointAlongSegments(routeLatLng, routeSegments, totalKm, traveledKm),
    [routeLatLng, routeSegments, totalKm, traveledKm],
  );
  const currentSegment = useMemo(
    () =>
      getCurrentCheckpointFromSegments(
        route,
        routeSegments,
        totalKm,
        traveledKm,
      ),
    [route, routeSegments, totalKm, traveledKm],
  );
  const destinationName =
    route.length > 0 ? route[route.length - 1].name : "destination";

  // Initialize the map exactly once.
  useEffect(() => {
    let cancelled = false;

    async function initMap() {
      try {
        await loadGoogleMaps(GOOGLE_MAPS_API_KEY);

        if (cancelled || !mapRef.current || mapInstanceRef.current) return;

        // First load: center on the user's current position along the route
        // (or the start checkpoint if progress is 0) at neighborhood zoom, so
        // the satellite imagery is legible and the blue arrow is immediately
        // visible. Users can pop out to the full route via "Fit map to route".
        const initialCenter =
          currentPosition ?? (route.length > 0 ? route[0] : { lat: 0, lng: 0 });

        // Hide the Map/Satellite toggle on mobile to free up screen real
        // estate; HYBRID (satellite with labels) is the only mode we use.
        // Evaluated only at map init — switching breakpoints later won't
        // toggle the control until the next reload.
        const map = new google.maps.Map(mapRef.current, {
          center: initialCenter,
          zoom: 15,
          mapTypeId: google.maps.MapTypeId.HYBRID,
          fullscreenControl: true,
          streetViewControl: false,
          mapTypeControl: isLargeScreen,
          gestureHandling: "greedy",
        });

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

  // Whenever the sheet's visible height changes (initial mount on mobile,
  // user drag between snap points, rotation), the auto-pan effect below
  // re-checks whether the current position is still visible above the
  // sheet — we add `bottomOverlayPx` to its deps so it re-runs on drag.
  // No separate effect is needed.

  // Initial focus on the user's current position once everything is ready.
  // Hooks the map's `idle` event (fires after tiles + layout settle, AFTER
  // any synchronous setCenter calls in other effects like the
  // breakpoint-resize effect above), so our pan isn't immediately
  // overridden. Runs at most once per mount; uses the same code path as
  // the Locate button so the marker lands in the visible (un-occluded)
  // area of the map regardless of how big the bottom sheet is.
  const initialFocusDoneRef = useRef(false);
  const focusCurrentPositionRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (initialFocusDoneRef.current) return;
    if (!mapReady || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const listener = map.addListener("idle", () => {
      if (initialFocusDoneRef.current) return;
      initialFocusDoneRef.current = true;
      focusCurrentPositionRef.current();
      google.maps.event.removeListener(listener);
    });
    return () => google.maps.event.removeListener(listener);
  }, [mapReady]);

  // Sync the polyline path whenever the route changes.
  useEffect(() => {
    if (!polylineRef.current) return;
    polylineRef.current.setPath(routeLatLng);
  }, [routeLatLng]);

  // Map of route index -> Marker for the currently-rendered checkpoint
  // markers. Used by the selection-styling effect below to update only the
  // previously- and newly-selected markers without rebuilding everything.
  const markerByIndexRef = useRef<Map<number, google.maps.Marker>>(new Map());
  // Tracks which index is currently styled as "selected" on the map. Lets
  // the styling effect know which marker to revert when the selection
  // changes.
  const styledSelectedIndexRef = useRef<number | null>(null);

  // Helper: apply the right icon / zIndex to an existing marker based on its
  // role. Pulled out so the build effect and the selection-styling effect
  // produce identical visuals.
  const styleMarker = (
    marker: google.maps.Marker,
    {
      index,
      routeLength,
      editMode: em,
      isSelected,
    }: {
      index: number;
      routeLength: number;
      editMode: boolean;
      isSelected: boolean;
    },
  ) => {
    const isStart = index === 0;
    const isEnd = index === routeLength - 1;
    const baseFill = isStart ? "#22c55e" : isEnd ? "#ef4444" : "#fbbf24";
    marker.setIcon({
      path: google.maps.SymbolPath.CIRCLE,
      scale: isSelected ? 9 : em ? 5 : 4,
      fillColor: isSelected ? "#38bdf8" : baseFill,
      fillOpacity: 1,
      strokeColor: isSelected ? "#0ea5e9" : "#000",
      strokeWeight: isSelected ? 3 : 1,
    });
    marker.setZIndex(isSelected ? 9998 : null);
  };

  // Build / rebuild checkpoint markers when geometry, edit mode, or the
  // viewport changes. Crucially, this effect does NOT depend on
  // selectedCheckpointIndex — selection-only changes are handled by the
  // small styling effect below, so clicking a row no longer destroys and
  // recreates up to 30 markers.
  //
  // Performance: when NOT in edit mode, we only render the start (green) and
  // end (red) markers — even with thousands of checkpoints, the polyline
  // alone shows the route shape and pan/zoom stays smooth. In edit mode we
  // render only checkpoints inside the current viewport (plus start + end),
  // so the number of live Marker objects stays small even for huge routes.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Clear existing checkpoint markers.
    checkpointMarkersRef.current.forEach((m) => m.setMap(null));
    checkpointMarkersRef.current = [];
    markerByIndexRef.current = new Map();
    // The previous styled-selected marker (if any) was just destroyed, so
    // forget it — the build loop will style the current selection from
    // scratch and the styling effect will pick up subsequent changes.
    styledSelectedIndexRef.current = null;

    let indicesToRender: number[];
    if (!editMode) {
      indicesToRender =
        route.length === 0
          ? []
          : route.length === 1
            ? [0]
            : [0, route.length - 1];
    } else {
      const bounds = map.getBounds();
      const visible: number[] = [];
      if (!bounds) {
        route.forEach((_, i) => visible.push(i));
      } else {
        route.forEach((cp, i) => {
          if (bounds.contains({ lat: cp.lat, lng: cp.lng })) {
            visible.push(i);
          }
        });
      }
      // Always include start and end so they stay visible. The selected
      // marker is intentionally NOT force-included here — the pan-to-selected
      // effect already moves the map when the selection is off-screen, which
      // bumps viewportVersion and causes this effect to re-run with the
      // selection naturally inside `bounds`.
      if (route.length > 0 && !visible.includes(0)) visible.unshift(0);
      if (route.length > 1 && !visible.includes(route.length - 1)) {
        visible.push(route.length - 1);
      }

      // Hard cap: keep at most MAX_EDIT_MARKERS, sampled evenly along the
      // visible set (always preserving the first and last entries).
      const MAX_EDIT_MARKERS = 30;
      if (visible.length > MAX_EDIT_MARKERS) {
        const sampled: number[] = [];
        const lastSlot = MAX_EDIT_MARKERS - 1;
        for (let s = 0; s < MAX_EDIT_MARKERS; s++) {
          const sourceIdx = Math.round((s * (visible.length - 1)) / lastSlot);
          sampled.push(visible[sourceIdx]);
        }
        indicesToRender = Array.from(new Set(sampled));
      } else {
        indicesToRender = visible;
      }
    }

    // Read the current selection via ref so this effect doesn't need it as
    // a dep (and so we don't force a rebuild on every selection change).
    const currentSelected = selectedIndexRef.current;

    indicesToRender.forEach((index) => {
      const checkpoint = route[index];
      const isSelected = currentSelected === index;
      const marker = new google.maps.Marker({
        position: { lat: checkpoint.lat, lng: checkpoint.lng },
        map,
        title: `${index + 1}. ${checkpoint.name}`,
        draggable: editMode,
      });
      styleMarker(marker, {
        index,
        routeLength: route.length,
        editMode,
        isSelected,
      });
      if (isSelected) styledSelectedIndexRef.current = index;

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
      }

      marker.addListener("click", () => {
        setSelectedCheckpointIndex(index);
      });

      checkpointMarkersRef.current.push(marker);
      markerByIndexRef.current.set(index, marker);
    });
  }, [route, editMode, mapReady, viewportVersion]);

  // Selection-only styling effect: when selectedCheckpointIndex changes
  // without a route/edit/viewport change, just retint the previous marker
  // back to its base style and tint the new one as selected. O(1) instead
  // of rebuilding every visible marker.
  useEffect(() => {
    if (!mapReady) return;
    const markers = markerByIndexRef.current;
    const prevIndex = styledSelectedIndexRef.current;

    if (prevIndex !== null && prevIndex !== selectedCheckpointIndex) {
      const prevMarker = markers.get(prevIndex);
      if (prevMarker) {
        styleMarker(prevMarker, {
          index: prevIndex,
          routeLength: route.length,
          editMode,
          isSelected: false,
        });
      }
    }

    if (selectedCheckpointIndex !== null) {
      const nextMarker = markers.get(selectedCheckpointIndex);
      if (nextMarker) {
        styleMarker(nextMarker, {
          index: selectedCheckpointIndex,
          routeLength: route.length,
          editMode,
          isSelected: true,
        });
      }
    }

    styledSelectedIndexRef.current = selectedCheckpointIndex;
    // route/editMode are read for styling only; a change to either of them
    // triggers the build effect above which already handles styling, so we
    // intentionally exclude them from this effect's deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCheckpointIndex, mapReady]);

  // Non-edit mode: when the user picks a checkpoint from the list, briefly
  // show its marker on the map (the build effect normally only renders start
  // + end markers in non-edit mode). Auto-hides after a few seconds.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    if (editMode) return;
    if (selectedCheckpointIndex === null) return;
    // Skip if the selected one is start or end — already rendered.
    if (
      selectedCheckpointIndex === 0 ||
      selectedCheckpointIndex === route.length - 1
    ) {
      return;
    }
    const cp = route[selectedCheckpointIndex];
    if (!cp) return;
    const map = mapInstanceRef.current;

    const marker = new google.maps.Marker({
      position: { lat: cp.lat, lng: cp.lng },
      map,
      title: `${selectedCheckpointIndex + 1}. ${cp.name}`,
    });
    styleMarker(marker, {
      index: selectedCheckpointIndex,
      routeLength: route.length,
      editMode: false,
      isSelected: true,
    });

    const timeoutId = window.setTimeout(() => {
      marker.setMap(null);
    }, 2000);

    return () => {
      window.clearTimeout(timeoutId);
      marker.setMap(null);
    };
  }, [selectedCheckpointIndex, editMode, mapReady, route]);

  // Bump `viewportVersion` (debounced) when the map finishes panning/zooming,
  // so the marker effect can recompute which checkpoints are visible.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    if (!editMode) return;
    const map = mapInstanceRef.current;
    let timeoutId: number | null = null;

    const listener = map.addListener("idle", () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        setViewportVersion((v) => v + 1);
      }, 120);
    });

    // Trigger an initial pass once edit mode begins.
    setViewportVersion((v) => v + 1);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      google.maps.event.removeListener(listener);
    };
  }, [editMode, mapReady]);

  // Map click-to-add-checkpoint was removed: it conflicted with selecting a
  // marker (every miss-click added a stray waypoint). Use the "+" button in
  // the route list to insert checkpoints between existing ones instead.

  // Right-click anywhere on the map (in edit mode) inserts a new checkpoint
  // relative to the currently selected checkpoint:
  //   • plain right-click       → insert AFTER selected
  //   • Shift + right-click     → insert BEFORE selected
  // If no checkpoint is selected, the right-click is a no-op. We register
  // on the map so the gesture works whether the user clicks empty terrain,
  // the route polyline, or on top of an existing marker.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !editMode) return;
    const map = mapInstanceRef.current;

    // Shared handler: right-click inserts a new checkpoint relative to the
    // current selection. Plain right-click inserts AFTER, Shift+right-click
    // inserts BEFORE. Selection moves to the freshly inserted checkpoint so
    // subsequent right-clicks chain (each new marker becomes the anchor
    // for the next).
    const handleRightClick = (e: google.maps.MapMouseEvent) => {
      const selected = selectedIndexRef.current;
      if (selected === null) return;
      const shift = !!(e?.domEvent as MouseEvent | undefined)?.shiftKey;
      // "before" means insert at the selected slot (which pushes the
      // currently-selected one down); "after" means insert at selected+1.
      // insertCheckpointAt is a no-op for index <= 0, so Shift+right-click
      // on the first checkpoint does nothing (matching the disabled +
      // button on the first row).
      const newIndex = shift ? selected : selected + 1;
      if (shift && selected === 0) return;
      insertCheckpointAtRef.current(newIndex);
      setSelectedCheckpointIndex(newIndex);
    };

    const mapListener = map.addListener("rightclick", handleRightClick);
    // Markers swallow the map's rightclick, so also attach to each marker.
    const markerListeners = checkpointMarkersRef.current.map((m) =>
      m.addListener("rightclick", handleRightClick),
    );
    // The current-position marker can also intercept right-clicks.
    const currentMarkerListener = currentMarkerRef.current?.addListener(
      "rightclick",
      handleRightClick,
    );

    return () => {
      google.maps.event.removeListener(mapListener);
      markerListeners.forEach((l) => google.maps.event.removeListener(l));
      if (currentMarkerListener)
        google.maps.event.removeListener(currentMarkerListener);
    };
  }, [editMode, mapReady, viewportVersion, route]);

  // Keyboard navigation in edit mode: Tab selects the next checkpoint,
  // Shift+Tab selects the previous one. Skipped while a text input /
  // contenteditable has focus so the user can still tab through the
  // checkpoint name fields normally. Clamps at the ends of the route
  // (no wrap-around).
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          active.isContentEditable
        ) {
          return;
        }
      }
      const selected = selectedIndexRef.current;
      if (selected === null) return;
      const last = route.length - 1;
      if (last < 0) return;
      const next = e.shiftKey
        ? Math.max(0, selected - 1)
        : Math.min(last, selected + 1);
      if (next === selected) {
        // Still consume the Tab so focus doesn't escape the panel when
        // we're already at the end of the route.
        e.preventDefault();
        return;
      }
      e.preventDefault();
      setSelectedCheckpointIndex(next);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editMode, route.length]);

  // Keep the current-position marker in sync. While in edit mode we pause
  // updates so the blue arrow doesn't jump around as you reshape the route.
  // When you click "Done editing", editMode flips and this effect runs once
  // with the final route.
  useEffect(() => {
    if (!currentMarkerRef.current) return;
    if (editMode) return;
    currentMarkerRef.current.setPosition(currentPosition);
  }, [currentPosition, route, editMode]);

  // Auto-pan: if the current-position marker has moved outside the map's
  // visible bounds (e.g. user kept stepping the balance and the blue arrow
  // walked off-screen), gently recenter the map on it. We only pan when
  // it's actually out of view so users who deliberately scrolled the map
  // elsewhere aren't yanked back on every tick.
  //
  // We also skip the pan on the tick where editMode flips false (i.e. the
  // user just clicked "Done editing"). Otherwise the map yanks back to the
  // blue arrow even though the user was deliberately looking somewhere else
  // while reshaping the route.
  const prevEditModeRef = useRef(editMode);
  useEffect(() => {
    const justExitedEditMode = prevEditModeRef.current && !editMode;
    prevEditModeRef.current = editMode;
    if (!mapReady || !mapInstanceRef.current) return;
    if (editMode || !currentPosition) return;
    if (justExitedEditMode) return;
    const map = mapInstanceRef.current;
    if (!isVisibleInMap(map, currentPosition)) {
      panMapToVisible(map, currentPosition);
    }
  }, [currentPosition, editMode, mapReady, bottomOverlayPx]);

  // Route mutation helpers.
  const renameCheckpoint = (index: number, name: string) => {
    setRoute((prev) =>
      prev.map((cp, i) => (i === index ? { ...cp, name } : cp)),
    );
  };
  const insertCheckpointAt = (index: number) => {
    setRoute((prev) => {
      if (index <= 0 || index > prev.length) return prev;
      const before = prev[index - 1];
      const after = prev[index] ?? before;
      // Place the new checkpoint 95% of the way from `after` toward `before`,
      // so it sits right next to the row the user clicked the + on. This keeps
      // the new marker inside the current view (the selected/clicked
      // checkpoint is almost always already visible) instead of landing at
      // the geometric midpoint, which can be far off-screen for long hops.
      const t = 0.95;
      const lat = after.lat + (before.lat - after.lat) * t;
      const lng = after.lng + (before.lng - after.lng) * t;
      const next = [...prev];
      next.splice(index, 0, {
        name: `Checkpoint ${prev.length + 1}`,
        lat,
        lng,
      });
      return next;
    });
  };
  // Ref mirror so the map-level rightclick listener (registered once per
  // edit-mode session) always calls the freshest insertCheckpointAt.
  const insertCheckpointAtRef = useRef(insertCheckpointAt);
  insertCheckpointAtRef.current = insertCheckpointAt;
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
      loadRouteFromJson().then((def) => setRoute(def));
    }
  };
  const fitMapToRoute = () => {
    if (!mapInstanceRef.current || route.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    route.forEach((p) => bounds.extend(p));
    // Tell Google Maps about the sheet so the route is fit into the
    // visible (top) portion of the map, not the full map div.
    mapInstanceRef.current.fitBounds(
      bounds,
      bottomOverlayPx > 0
        ? { top: 0, right: 0, bottom: bottomOverlayPx, left: 0 }
        : undefined,
    );
  };
  // Re-center the map on the user's current position at neighborhood zoom
  // (matches the initial-load framing). Used by the mobile "Locate" button.
  const focusCurrentPosition = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const target = currentPosition ?? (route.length > 0 ? route[0] : null);
    if (!target) return;
    map.setZoom(15);
    panMapToVisible(map, target);
  };
  // Keep the ref used by the initial-overlay effect pointing at the
  // latest closure (so it sees the current `currentPosition` / `route`).
  focusCurrentPositionRef.current = focusCurrentPosition;
  const exportRouteJson = () => {
    const json = JSON.stringify(compactCheckpoints(route), null, 2) + "\n";
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
    <div className="h-dvh overflow-hidden bg-neutral-950 text-neutral-100 p-4">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-lg border px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-300 ${
          savedFlash?.kind === "local-only"
            ? "border-amber-400/60 bg-amber-500/90"
            : "border-emerald-400/60 bg-emerald-500/90"
        } ${
          savedFlash ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
        }`}
      >
        {savedFlash?.message ?? ""}
      </div>
      {/*
        Outer responsive layout. `MapView` is rendered ONCE (outside the
        conditional) so its DOM node — and the Google Map instance bound to
        it — is preserved when the viewport crosses the lg breakpoint.
        Tailwind's `order-first lg:order-last` puts the map on TOP in mobile
        (flex-col) and on the RIGHT on desktop (flex-row).
      */}
      <div className="w-full h-full relative lg:flex lg:flex-row lg:gap-4">
        <MapView mapRef={mapRef} mapError={mapError} />
        {isLargeScreen ? (
          <DesktopControlPanel
            apiKey={GOOGLE_MAPS_API_KEY}
            destinationName={destinationName}
            originalPrincipalText={originalPrincipalText}
            currentBalanceText={currentBalanceText}
            principalValid={principalValid}
            balanceValid={balanceValid}
            balanceSyntaxValid={balanceSyntaxValid}
            balanceExceedsPrincipal={balanceExceedsPrincipal}
            inputsValid={inputsValid}
            setOriginalPrincipalText={setOriginalPrincipalText}
            setCurrentBalanceText={setCurrentBalanceText}
            commitPrincipalText={commitPrincipalText}
            commitBalanceText={commitBalanceText}
            stepCurrentBalance={stepCurrentBalance}
            saveMortgageInputs={saveMortgageInputs}
            resetMortgageInputs={resetMortgageInputs}
            focusCurrentPosition={focusCurrentPosition}
            progress={progress}
            totalKm={totalKm}
            traveledKm={traveledKm}
            remainingKm={remainingKm}
            paidPrincipal={paidPrincipal}
            safeOriginalPrincipal={safeOriginalPrincipal}
            currentSegment={currentSegment}
            route={route}
            editMode={editMode}
            startEditingRoute={startEditingRoute}
            finishEditingRoute={finishEditingRoute}
            cancelEditingRoute={cancelEditingRoute}
            selectedCheckpointIndex={selectedCheckpointIndex}
            setSelectedCheckpointIndex={setSelectedCheckpointIndex}
            selectedListItemRef={selectedListItemRef}
            renameCheckpoint={renameCheckpoint}
            insertCheckpointAt={insertCheckpointAt}
            deleteCheckpoint={deleteCheckpoint}
            fitMapToRoute={fitMapToRoute}
            exportRouteJson={exportRouteJson}
            resetRoute={resetRoute}
            isLoadingRemote={isLoadingRemote}
          />
        ) : (
          <MobileControlPanel
            apiKey={GOOGLE_MAPS_API_KEY}
            onVisibleHeightChange={setBottomOverlayPx}
            originalPrincipalText={originalPrincipalText}
            currentBalanceText={currentBalanceText}
            balanceValid={balanceValid}
            balanceExceedsPrincipal={balanceExceedsPrincipal}
            stepCurrentBalance={stepCurrentBalance}
            inputsValid={inputsValid}
            saveMortgageInputs={saveMortgageInputs}
            resetMortgageInputs={resetMortgageInputs}
            fitMapToRoute={fitMapToRoute}
            focusCurrentPosition={focusCurrentPosition}
            progress={progress}
            totalKm={totalKm}
            traveledKm={traveledKm}
            remainingKm={remainingKm}
            paidPrincipal={paidPrincipal}
            safeOriginalPrincipal={safeOriginalPrincipal}
            currentSegment={currentSegment}
            isLoadingRemote={isLoadingRemote}
          />
        )}
      </div>
    </div>
  );
}
