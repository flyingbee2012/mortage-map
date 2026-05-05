import { MobileMortgageInputs } from "./MobileMortgageInputs";
import { formatCurrencyCents, isApiKeyConfigured } from "../utils/helper";

type MobileControlPanelProps = {
  apiKey: string;
  destinationName: string;

  // Mortgage inputs (read-only on mobile; adjusted via step buttons).
  originalPrincipalText: string;
  currentBalanceText: string;
  principalValid: boolean;
  balanceValid: boolean;
  balanceExceedsPrincipal: boolean;
  setOriginalPrincipalText: (s: string) => void;
  setCurrentBalanceText: (s: string) => void;
  stepCurrentBalance: (delta: number) => void;

  // Stats.
  progress: number;
  totalKm: number;
  traveledKm: number;
  remainingKm: number;
  paidPrincipal: number;
  safeOriginalPrincipal: number;
  currentSegment: string;
};

/**
 * Mobile control panel: a compact, scrollable info column shown BELOW the
 * map on small viewports. Intentionally trimmed compared to the desktop
 * panel — no Save/Reset, no route list, no edit-route flow.
 */
export function MobileControlPanel({
  apiKey,
  destinationName,
  originalPrincipalText,
  currentBalanceText,
  principalValid,
  balanceValid,
  balanceExceedsPrincipal,
  setOriginalPrincipalText,
  setCurrentBalanceText,
  stepCurrentBalance,
  progress,
  totalKm,
  traveledKm,
  remainingKm,
  paidPrincipal,
  safeOriginalPrincipal,
  currentSegment,
}: MobileControlPanelProps) {
  return (
    <section className="rounded-2xl bg-neutral-900 shadow-xl p-4 flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold">
          Walking to {destinationName.split("·")[0].trim()}
        </h1>
        <p className="text-xs text-neutral-400 mt-1">
          Turn your mortgage balance into a journey. Every bit of principal you
          pay off brings you closer to the destination.
        </p>
      </div>

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

      <MobileMortgageInputs
        originalPrincipalText={originalPrincipalText}
        currentBalanceText={currentBalanceText}
        principalValid={principalValid}
        balanceValid={balanceValid}
        balanceExceedsPrincipal={balanceExceedsPrincipal}
        setOriginalPrincipalText={setOriginalPrincipalText}
        setCurrentBalanceText={setCurrentBalanceText}
        stepCurrentBalance={stepCurrentBalance}
      />

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

      {/* Stats card */}
      <div className="shrink-0 rounded-2xl bg-neutral-800 p-3 space-y-3 text-sm">
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
              Paid off: <strong>{formatCurrencyCents(paidPrincipal)}</strong>
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
    </section>
  );
}
