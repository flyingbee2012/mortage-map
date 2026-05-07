import {
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MortgageInputs } from "./MortgageInputs";
import {
  clamp,
  formatCurrencyCents,
  isApiKeyConfigured,
} from "../utils/helper";

type MobileControlPanelProps = {
  apiKey: string;
  // Reports the number of pixels of map currently hidden by this sheet.
  // The parent uses it to keep markers visible above the sheet.
  onVisibleHeightChange?: (px: number) => void;

  // Mortgage values (display-only on mobile; balance adjusted via step buttons).
  originalPrincipalText: string;
  currentBalanceText: string;
  balanceValid: boolean;
  balanceExceedsPrincipal: boolean;
  stepCurrentBalance: (delta: number) => void;
  inputsValid: boolean;
  saveMortgageInputs: () => void;
  resetMortgageInputs: () => void;
  fitMapToRoute: () => void;
  focusCurrentPosition: () => void;

  // Stats.
  progress: number;
  totalKm: number;
  traveledKm: number;
  remainingKm: number;
  paidPrincipal: number;
  safeOriginalPrincipal: number;
  currentSegment: string;
  isLoadingRemote: boolean;
};

type Snap = "collapsed" | "mid" | "full";

// How much sheet is visible at the "collapsed" snap (drag handle + a peek
// of the progress bar). Tuned to feel like the Google Maps "peek" state.
const COLLAPSED_PEEK_PX = 96;
// How much MAP is visible at the "full" snap (so the user can still see
// where they are without dismissing the sheet). Mirrors Google Maps.
const FULL_MAP_PEEK_PX = 72;
// Drag distance below which we treat a pointerup as a tap (so tapping the
// handle cycles snap positions instead of snapping to the same place).
const TAP_THRESHOLD_PX = 6;

/**
 * Mobile control panel: a Google-Maps-style swipeable bottom sheet that
 * floats over the map. The user can drag the handle to snap between
 * three positions:
 *
 *   - collapsed: only a small header peek; map is essentially full-screen
 *   - mid:       sheet covers the bottom half
 *   - full:      sheet covers most of the screen, leaving a small map peek
 *
 * The map underneath is the SAME `MapView` instance used on desktop —
 * we deliberately don't re-mount it across breakpoints, so panning state
 * and the Google Map object are preserved.
 */
export function MobileControlPanel({
  apiKey,
  onVisibleHeightChange,
  originalPrincipalText,
  currentBalanceText,
  balanceValid,
  balanceExceedsPrincipal,
  stepCurrentBalance,
  inputsValid,
  saveMortgageInputs,
  resetMortgageInputs,
  fitMapToRoute,
  focusCurrentPosition,
  progress,
  totalKm,
  traveledKm,
  remainingKm,
  paidPrincipal,
  safeOriginalPrincipal,
  currentSegment,
  isLoadingRemote,
}: MobileControlPanelProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // Height of the sheet's parent (the layout container in MortgageMap).
  // We measure it instead of using 100vh because the page has padding
  // and the layout container is what we're absolutely positioned within.
  const [containerH, setContainerH] = useState(0);
  const [snap, setSnap] = useState<Snap>("mid");
  // While dragging we override the snapped translate with the live one.
  // null means "use the snap target" (and also "not currently dragging").
  const [dragOffsetY, setDragOffsetY] = useState<number | null>(null);
  const dragging = dragOffsetY !== null;
  // Drag bookkeeping. `captured` flips true once the pointer moves past
  // the tap threshold; until then we don't apply a transform, so taps on
  // empty space are still cheap.
  const dragStateRef = useRef<{
    startY: number;
    startTranslate: number;
    captured: boolean;
  } | null>(null);

  // Observe the parent (positioning context) so we re-snap correctly on
  // viewport rotation, browser-chrome show/hide, etc.
  useEffect(() => {
    const parent = sheetRef.current?.parentElement;
    if (!parent) return;
    const update = () => setContainerH(parent.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  const snapY = useMemo(() => {
    // translateY values, in px, applied to a sheet whose height equals
    // the container. Larger value = sheet pushed further down = smaller
    // visible portion.
    const collapsed = Math.max(containerH - COLLAPSED_PEEK_PX, 0);
    const full = Math.max(FULL_MAP_PEEK_PX, 0);
    const mid = containerH * 0.5;
    return { collapsed, mid, full };
  }, [containerH]);

  const targetY = dragOffsetY ?? snapY[snap];

  // Tell the parent how many pixels of map are currently hidden by us so
  // it can offset map recentering. visibleHeight = containerH - targetY.
  // Cleanup resets to 0 so desktop reverts to no-overlay on unmount.
  useEffect(() => {
    if (!onVisibleHeightChange) return;
    onVisibleHeightChange(Math.max(containerH - targetY, 0));
    return () => onVisibleHeightChange(0);
  }, [containerH, targetY, onVisibleHeightChange]);

  // Pointer handlers attached to the entire content area so the user can
  // drag the sheet by touching anywhere inside it (Google Maps style).
  // We rely on touchAction: "none" on the content div to suppress the
  // browser's native scroll, which would otherwise eat the drag gesture.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    // Skip drag if the user is interacting with a control. Lets buttons
    // and inputs behave normally; everything else is a drag surface.
    const target = e.target as HTMLElement;
    if (target.closest("button, input, a, textarea, select")) return;
    dragStateRef.current = {
      startY: e.clientY,
      startTranslate: snapY[snap],
      captured: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    const dy = e.clientY - state.startY;
    if (!state.captured) {
      if (Math.abs(dy) <= TAP_THRESHOLD_PX) return;
      state.captured = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragOffsetY(snapY[snap]);
    }
    const next = clamp(state.startTranslate + dy, snapY.full, snapY.collapsed);
    setDragOffsetY(next);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    if (state.captured) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const final = dragOffsetY ?? snapY[snap];
      // Snap to whichever target is closest.
      const snaps: Snap[] = ["full", "mid", "collapsed"];
      const nearest = snaps.reduce((best, s) =>
        Math.abs(final - snapY[s]) < Math.abs(final - snapY[best]) ? s : best,
      );
      setSnap(nearest);
      setDragOffsetY(null);
    }
    dragStateRef.current = null;
  };

  return (
    <div
      ref={sheetRef}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl bg-neutral-900 shadow-[0_-8px_24px_rgba(0,0,0,0.5)] lg:hidden"
      style={{
        height: containerH > 0 ? containerH : "100%",
        transform: `translateY(${targetY}px)`,
        transition: dragging ? "none" : "transform 220ms ease-out",
        // Hide before we know the container size to avoid an initial flash
        // of the sheet at the wrong position.
        visibility: containerH > 0 ? "visible" : "hidden",
      }}
    >
      {/* Content area. The sheet itself doesn't scroll — if more space is
          needed, the user drags it to a taller snap. touchAction: "none"
          suppresses the browser's native scroll so it doesn't eat our
          drag gesture. */}
      <div
        className="flex-1 min-h-0 pt-4 px-4 pb-4 flex flex-col gap-3"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {!isApiKeyConfigured(apiKey) && (
          <div className="shrink-0 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100 space-y-2">
            <p className="font-semibold">
              Google Maps API key is not configured.
            </p>
            <p>
              Create a{" "}
              <code className="rounded bg-black/30 px-1">.env.local</code> file
              in the project root and add:
              <br />
              <code className="rounded bg-black/30 px-1">
                VITE_GOOGLE_MAPS_API_KEY=your_key_here
              </code>
            </p>
          </div>
        )}

        {/* Progress bar */}
        <div className="shrink-0 relative h-5 rounded-full bg-neutral-800 overflow-hidden">
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

        <MortgageInputs
          originalPrincipalText={originalPrincipalText}
          currentBalanceText={currentBalanceText}
          balanceValid={balanceValid}
          balanceExceedsPrincipal={balanceExceedsPrincipal}
          stepCurrentBalance={stepCurrentBalance}
          isLoadingRemote={isLoadingRemote}
        />

        {/* Save / Reset / Fit route / Locate — single row of map + persistence actions. */}
        <div className="shrink-0 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-2 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-500/20"
            onClick={saveMortgageInputs}
            disabled={!inputsValid}
            title={
              inputsValid
                ? "Persist the current principal and balance."
                : "Fix the invalid input(s) above before saving."
            }
          >
            Save
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 transition"
            onClick={resetMortgageInputs}
            title="Restore the values to whatever was loaded when the app started."
          >
            Reset
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 transition"
            onClick={fitMapToRoute}
            title="Zoom out to show the entire route."
          >
            Fit route
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 transition"
            onClick={focusCurrentPosition}
            title="Re-center the map on your current position."
          >
            Locate
          </button>
        </div>

        {/* Stats card */}
        <div className="shrink-0 rounded-2xl bg-neutral-800 p-3 space-y-2 text-sm">
          <p>
            Total: <strong>{totalKm.toFixed(4)} km</strong>
            <span className="mx-2 text-neutral-500">·</span>
            Traveled: <strong>{traveledKm.toFixed(4)} km</strong>
          </p>
          <p>
            Remaining: <strong>{remainingKm.toFixed(4)} km</strong>
          </p>

          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>
              Paid off: <strong>{formatCurrencyCents(paidPrincipal)}</strong>
            </span>
            <span className="text-neutral-300">
              $1 ={" "}
              <strong>
                {safeOriginalPrincipal > 0
                  ? ((totalKm * 1000) / safeOriginalPrincipal).toFixed(2)
                  : "0.00"}{" "}
                m
              </strong>
            </span>
          </p>
          <p>
            Currently at: <strong>{currentSegment}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
