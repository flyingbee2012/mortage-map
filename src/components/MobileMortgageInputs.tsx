/**
 * Mobile-only mortgage inputs panel.
 *
 * Rendered below the `lg` breakpoint (<1024px) by `MortgageMap.tsx`, in
 * place of the desktop labels-on-top inputs + Save/Reset row.
 *
 * Layout:
 *   Row 1: Original | Current  (read-only inputs, side by side)
 *   Row 2: +$1  -$1  +1¢  -1¢  (touch-friendly step buttons)
 *
 * The inputs are read-only on mobile so the on-screen keyboard never pops
 * up; users adjust the balance via the step buttons instead.
 */
type MobileMortgageInputsProps = {
  originalPrincipalText: string;
  currentBalanceText: string;
  principalValid: boolean;
  balanceValid: boolean;
  balanceExceedsPrincipal: boolean;
  setOriginalPrincipalText: (s: string) => void;
  setCurrentBalanceText: (s: string) => void;
  stepCurrentBalance: (delta: number) => void;
};

export function MobileMortgageInputs({
  originalPrincipalText,
  currentBalanceText,
  principalValid,
  balanceValid,
  balanceExceedsPrincipal,
  setOriginalPrincipalText,
  setCurrentBalanceText,
  stepCurrentBalance,
}: MobileMortgageInputsProps) {
  return (
    <div className="space-y-2">
      {/* Row 1: principal + balance side by side */}
      <div className="flex items-center gap-2">
        <label className="flex flex-1 min-w-0 items-center gap-1">
          <span className="shrink-0 text-xs text-neutral-400">Original</span>
          <input
            className={`flex-1 min-w-0 rounded-lg bg-neutral-800 border px-2 py-1 text-sm outline-none ${
              principalValid
                ? "border-neutral-700"
                : "border-red-500/70 focus:border-red-400"
            }`}
            type="text"
            inputMode="decimal"
            value={originalPrincipalText}
            readOnly
            aria-invalid={!principalValid}
            onChange={(e) => setOriginalPrincipalText(e.target.value)}
          />
        </label>
        <label className="flex flex-1 min-w-0 items-center gap-1">
          <span className="shrink-0 text-xs text-neutral-400">Current</span>
          <input
            className={`flex-1 min-w-0 rounded-lg bg-neutral-800 border px-2 py-1 text-sm outline-none ${
              balanceValid
                ? "border-neutral-700"
                : "border-red-500/70 focus:border-red-400"
            }`}
            type="text"
            inputMode="decimal"
            value={currentBalanceText}
            readOnly
            aria-invalid={!balanceValid}
            onChange={(e) => setCurrentBalanceText(e.target.value)}
          />
        </label>
      </div>
      {/* Row 2: 4 step buttons in a single horizontal row */}
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-2 text-sm text-neutral-200 hover:bg-neutral-700 active:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => stepCurrentBalance(1)}
          disabled={!balanceValid}
        >
          +$1
        </button>
        <button
          type="button"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-2 text-sm text-neutral-200 hover:bg-neutral-700 active:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => stepCurrentBalance(-1)}
          disabled={!balanceValid}
        >
          −$1
        </button>
        <button
          type="button"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-2 text-sm text-neutral-200 hover:bg-neutral-700 active:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => stepCurrentBalance(0.01)}
          disabled={!balanceValid}
        >
          +1¢
        </button>
        <button
          type="button"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-2 text-sm text-neutral-200 hover:bg-neutral-700 active:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => stepCurrentBalance(-0.01)}
          disabled={!balanceValid}
        >
          −1¢
        </button>
      </div>
      {balanceExceedsPrincipal && (
        <p className="text-xs text-red-400">
          Current balance cannot exceed the original principal.
        </p>
      )}
    </div>
  );
}
