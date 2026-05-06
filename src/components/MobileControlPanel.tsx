import { MobileMortgageInputs } from "./MobileMortgageInputs";
import { formatCurrencyCents, isApiKeyConfigured } from "../utils/helper";

type MobileControlPanelProps = {
  apiKey: string;

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

/**
 * Mobile control panel: a compact, scrollable info column shown BELOW the
 * map on small viewports. Intentionally trimmed compared to the desktop
 * panel — no Save/Reset, no route list, no edit-route flow.
 */
export function MobileControlPanel({
  apiKey,
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
  return (
    <section className="rounded-2xl bg-neutral-900 shadow-xl p-4 flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
      {!isApiKeyConfigured(apiKey) && (
        <div className="shrink-0 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100 space-y-2">
          <p className="font-semibold">
            Google Maps API key is not configured.
          </p>
          <p>
            Create a{" "}
            <code className="rounded bg-black/30 px-1">.env.local</code> file in
            the project root and add:
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

      <MobileMortgageInputs
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
    </section>
  );
}
