/**
 * Mobile-only mortgage values panel.
 *
 * Rendered below the `lg` breakpoint (<1024px) by `MortgageMap.tsx`, in
 * place of the desktop labels-on-top inputs + Save/Reset row.
 *
 * Layout:
 *   Row 1: Original | Current  (read-only display cards, side by side)
 *   Row 2: +$1  -$1  +1¢  -1¢  (touch-friendly step buttons)
 *
 * On mobile the values are display-only \u2014 there are no text inputs and the
 * on-screen keyboard never pops up. Users adjust the balance via the step
 * buttons.
 */
type MobileMortgageInputsProps = {
  originalPrincipalText: string;
  currentBalanceText: string;
  balanceValid: boolean;
  balanceExceedsPrincipal: boolean;
  stepCurrentBalance: (delta: number) => void;
};

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAmount(text: string): string {
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  return CURRENCY_FORMATTER.format(n);
}

export function MobileMortgageInputs({
  originalPrincipalText,
  currentBalanceText,
  balanceValid,
  balanceExceedsPrincipal,
  stepCurrentBalance,
}: MobileMortgageInputsProps) {
  return (
    <div className="shrink-0 space-y-2">
      {/* Row 1: principal + balance shown as read-only display cards. */}
      <div className="flex items-stretch gap-2">
        <div className="flex flex-1 min-w-0 flex-col rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            Original
          </span>
          <span className="truncate text-sm font-semibold tabular-nums text-neutral-100">
            {formatAmount(originalPrincipalText)}
          </span>
        </div>
        <div className="flex flex-1 min-w-0 flex-col rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            Current
          </span>
          <span className="truncate text-sm font-semibold tabular-nums text-emerald-300">
            {formatAmount(currentBalanceText)}
          </span>
        </div>
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
