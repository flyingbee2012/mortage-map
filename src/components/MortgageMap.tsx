import { useEffect, useMemo, useRef, useState } from "react";
import defaultRouteJson from "../data/defaultRoute.json";
import { CheckpointNameInput } from "./CheckpointNameInput";
import {
  Checkpoint,
  clamp,
  formatCurrencyCents,
  getCurrentCheckpointFromSegments,
  getPointAlongSegments,
  getRouteSegments,
  isApiKeyConfigured,
  LatLng,
  loadGoogleMaps,
  loadStoredNumber,
  loadStoredRoute,
  saveStoredNumber,
  saveStoredRoute,
  clearStoredRoute,
} from "../utils/helper";

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

const DEFAULT_ROUTE: Checkpoint[] = defaultRouteJson as Checkpoint[];

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
  const [selectedCheckpointIndex, setSelectedCheckpointIndex] = useState<
    number | null
  >(null);
  const [route, setRoute] = useState<Checkpoint[]>(
    () => loadStoredRoute() ?? DEFAULT_ROUTE,
  );
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
    const bounds = map.getBounds();
    if (!bounds || !bounds.contains(target)) {
      map.panTo(target);
    }
  }, [selectedCheckpointIndex, route]);

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
  const [savedFlash, setSavedFlash] = useState(false);
  const savedFlashTimerRef = useRef<number | null>(null);
  const saveMortgageInputs = () => {
    if (!inputsValid) return;
    if (
      originalPrincipal === lastSavedPrincipalRef.current &&
      currentBalance === lastSavedBalanceRef.current
    ) {
      // Nothing changed since the last save / initial load — no-op.
      return;
    }
    saveStoredNumber(ORIGINAL_PRINCIPAL_STORAGE_KEY, originalPrincipal);
    saveStoredNumber(CURRENT_BALANCE_STORAGE_KEY, currentBalance);
    lastSavedPrincipalRef.current = originalPrincipal;
    lastSavedBalanceRef.current = currentBalance;
    setSavedFlash(true);
    if (savedFlashTimerRef.current !== null) {
      window.clearTimeout(savedFlashTimerRef.current);
    }
    savedFlashTimerRef.current = window.setTimeout(() => {
      setSavedFlash(false);
      savedFlashTimerRef.current = null;
    }, 2000);
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

        const map = new google.maps.Map(mapRef.current, {
          center: initialCenter,
          zoom: 15,
          mapTypeId: google.maps.MapTypeId.HYBRID,
          fullscreenControl: true,
          streetViewControl: false,
          mapTypeControl: true,
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
        marker.addListener("rightclick", () => {
          setRoute((prev) => prev.filter((_, i) => i !== index));
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
    <div className="h-screen overflow-hidden bg-neutral-950 text-neutral-100 p-4">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-lg border border-emerald-400/60 bg-emerald-500/90 px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-300 ${
          savedFlash ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
        }`}
      >
        ✓ Saved to local storage
      </div>
      <div className="w-full h-full flex flex-col lg:flex-row gap-4">
        <section className="rounded-2xl bg-neutral-900 shadow-xl p-4 flex-1 min-h-0 lg:flex-none lg:w-[380px] lg:h-full flex flex-col gap-3">
          {!editMode && (
            <>
              <div>
                <h1 className="text-xl font-semibold">
                  Walking to {destinationName.split("·")[0].trim()}
                </h1>
                <p className="text-xs text-neutral-400 mt-1">
                  Turn your mortgage balance into a journey. Every bit of
                  principal you pay off brings you closer to the destination.
                  Edit the route below to make it your own.
                </p>
              </div>
            </>
          )}

          {!editMode && !isApiKeyConfigured(GOOGLE_MAPS_API_KEY) && (
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

          {!editMode && (
            <label className="block space-y-1">
              <span className="text-sm text-neutral-300">
                Original principal
              </span>
              <input
                className={`w-full rounded-xl bg-neutral-800 border px-3 py-1.5 outline-none ${
                  principalValid
                    ? "border-neutral-700"
                    : "border-red-500/70 focus:border-red-400"
                }`}
                type="text"
                inputMode="decimal"
                value={originalPrincipalText}
                aria-invalid={!principalValid}
                onChange={(e) => setOriginalPrincipalText(e.target.value)}
                onBlur={commitPrincipalText}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              {!principalValid && (
                <p className="text-xs text-red-400">
                  Enter a non-negative number, e.g. 34 or 45.56.
                </p>
              )}
            </label>
          )}

          {!editMode && (
            <label className="block space-y-1">
              <span className="text-sm text-neutral-300">Current balance</span>
              <div className="flex items-stretch gap-2">
                <input
                  className={`flex-1 min-w-0 rounded-xl bg-neutral-800 border px-3 py-1.5 outline-none ${
                    balanceValid
                      ? "border-neutral-700"
                      : "border-red-500/70 focus:border-red-400"
                  }`}
                  type="text"
                  inputMode="decimal"
                  value={currentBalanceText}
                  aria-invalid={!balanceValid}
                  onChange={(e) => setCurrentBalanceText(e.target.value)}
                  onBlur={commitBalanceText}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      (e.target as HTMLInputElement).blur();
                  }}
                />
                <div
                  className="flex flex-col rounded-lg overflow-hidden border border-neutral-700"
                  title="Step by $1"
                >
                  <button
                    type="button"
                    className="flex-1 px-2 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => stepCurrentBalance(1)}
                    disabled={!balanceValid}
                  >
                    +$1
                  </button>
                  <button
                    type="button"
                    className="flex-1 px-2 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-t border-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => stepCurrentBalance(-1)}
                    disabled={!balanceValid}
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
                    className="flex-1 px-2 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => stepCurrentBalance(0.01)}
                    disabled={!balanceValid}
                  >
                    +1¢
                  </button>
                  <button
                    type="button"
                    className="flex-1 px-2 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-t border-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => stepCurrentBalance(-0.01)}
                    disabled={!balanceValid}
                  >
                    −1¢
                  </button>
                </div>
              </div>
              {!balanceSyntaxValid && (
                <p className="text-xs text-red-400">
                  Enter a non-negative number, e.g. 34 or 45.56.
                </p>
              )}
              {balanceSyntaxValid && balanceExceedsPrincipal && (
                <p className="text-xs text-red-400">
                  Current balance cannot exceed the original principal.
                </p>
              )}
            </label>
          )}

          {!editMode && (
            <div className="space-y-1">
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-500/20"
                  onClick={saveMortgageInputs}
                  disabled={!inputsValid}
                  title={
                    inputsValid
                      ? "Persist the current principal and balance to localStorage so they reload next time."
                      : "Fix the invalid input(s) above before saving."
                  }
                >
                  Save
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 transition"
                  onClick={resetMortgageInputs}
                  title="Restore the values to whatever was loaded when the app started. Does not modify localStorage."
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {!editMode && (
            <div className="relative h-5 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${progress * 100}%` }}
              />
              <div
                className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.7)" }}
              >
                {(progress * 100).toFixed(2)}%
              </div>
            </div>
          )}

          {!editMode && (
            <div className="rounded-2xl bg-neutral-800 p-3 space-y-3 text-sm">
              <div className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Distance
                </h3>
                <p>
                  Total: <strong>{totalKm.toFixed(4)} km</strong>
                  <span className="mx-2 text-neutral-500">·</span>
                  Traveled: <strong>{traveledKm.toFixed(4)} km</strong>
                </p>
                <p>
                  Remaining: <strong>{remainingKm.toFixed(4)} km</strong>
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    Money
                  </h3>
                  <span>
                    Paid off:{" "}
                    <strong>{formatCurrencyCents(paidPrincipal)}</strong>
                  </span>
                </div>
                <p>
                  Each $1 paid moves you{" "}
                  <strong>
                    {safeOriginalPrincipal > 0
                      ? ((totalKm * 1000) / safeOriginalPrincipal).toFixed(2)
                      : "0.00"}{" "}
                    m
                  </strong>
                </p>
              </div>

              <div className="space-y-1">
                <p>
                  Currently at: <strong>{currentSegment}</strong>
                </p>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-neutral-800 p-3 space-y-2 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-neutral-200">
                Route ({route.length} checkpoints)
              </h2>
              <div className="flex items-center gap-2">
                {!editMode && (
                  <button
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 transition disabled:opacity-40"
                    type="button"
                    onClick={fitMapToRoute}
                    disabled={route.length === 0}
                    title="Zoom out to show the entire route"
                  >
                    Fit route
                  </button>
                )}
                {editMode && (
                  <button
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 transition"
                    type="button"
                    onClick={cancelEditingRoute}
                    title="Discard all edits and revert to the route from when you started editing"
                  >
                    Cancel
                  </button>
                )}
                <button
                  className={`rounded-lg border px-2 py-1 text-xs transition ${
                    editMode
                      ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                      : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-700"
                  }`}
                  type="button"
                  onClick={editMode ? finishEditingRoute : startEditingRoute}
                >
                  {editMode ? "Done editing" : "Edit route"}
                </button>
              </div>
            </div>

            {editMode && (
              <p className="text-xs text-neutral-300">
                Total: <strong>{totalKm.toFixed(4)} km</strong>
              </p>
            )}

            {editMode && (
              <p className="text-xs text-neutral-400 leading-relaxed">
                Use the + buttons below to insert checkpoints between existing
                ones. Drag a marker to move it. Right-click a marker to delete
                it.
              </p>
            )}

            {route.length === 0 ? (
              <p className="text-xs text-neutral-500 italic">
                No checkpoints yet. Turn on edit mode and click the map to add
                some.
              </p>
            ) : (
              <ol className="space-y-1 overflow-y-auto pr-1 flex-1 min-h-0">
                {route.map((checkpoint, index) => {
                  const isSelected = selectedCheckpointIndex === index;
                  return (
                    <li
                      key={index}
                      ref={isSelected ? selectedListItemRef : undefined}
                      onClick={() => setSelectedCheckpointIndex(index)}
                      className={`flex items-center gap-1 text-xs rounded px-1 py-0.5 cursor-pointer transition ${
                        isSelected
                          ? "bg-amber-500/20 ring-1 ring-amber-400/60"
                          : "hover:bg-neutral-700/40"
                      }`}
                    >
                      <span className="shrink-0 w-10 text-right tabular-nums text-neutral-500">
                        {index + 1}.
                      </span>
                      {editMode ? (
                        <CheckpointNameInput
                          initialName={checkpoint.name}
                          onCommit={(name) => renameCheckpoint(index, name)}
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
                            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-30"
                            type="button"
                            disabled={index === 0}
                            onClick={() => insertCheckpointAt(index)}
                            title={
                              index === 0
                                ? "Cannot insert before the first checkpoint"
                                : `Insert a new checkpoint between ${route[index - 1].name} and ${checkpoint.name}`
                            }
                          >
                            +
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
                  );
                })}
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
        </section>

        <section className="rounded-2xl overflow-hidden bg-neutral-900 shadow-xl flex-1 min-h-0 lg:h-full relative">
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
