/**
 * Mortgage values panel — shared by mobile (read-only) and desktop
 * (editable).
 *
 * Layout (identical in both modes):
 *   Row 1: Original | Current  (side-by-side cards)
 *   Row 2: +$1  -$1  +1¢  -1¢  (touch-friendly step buttons)
 *
 * Modes:
 *   - Read-only (default, used by the mobile control panel): each card
 *     renders the formatted amount as a plain span. Users adjust the
 *     balance via the step buttons; no on-screen keyboard appears.
 *   - Editable (`editable={true}`, used by the desktop control panel):
 *     each card renders an `<input>` so the user can type into the
 *     principal and balance fields. Commit handlers run on blur / Enter.
 *
 * Keeping a single component for both keeps the visual layout in sync —
 * the only difference between mobile and desktop is the focus ring and
 * caret in editable mode.
 */
type MortgageInputsProps = {
  originalPrincipalText: string;
  currentBalanceText: string;
  balanceValid: boolean;
  balanceExceedsPrincipal: boolean;
  stepCurrentBalance: (delta: number) => void;
  isLoadingRemote: boolean;
  // ---- Editable-mode props (only consumed when `editable` is true). ----
  editable?: boolean;
  principalValid?: boolean;
  balanceSyntaxValid?: boolean;
  setOriginalPrincipalText?: (s: string) => void;
  setCurrentBalanceText?: (s: string) => void;
  commitPrincipalText?: () => void;
  commitBalanceText?: () => void;
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

export function MortgageInputs({
  originalPrincipalText,
  currentBalanceText,
  balanceValid,
  balanceExceedsPrincipal,
  stepCurrentBalance,
  isLoadingRemote,
  editable = false,
  principalValid = true,
  balanceSyntaxValid = true,
  setOriginalPrincipalText,
  setCurrentBalanceText,
  commitPrincipalText,
  commitBalanceText,
}: MortgageInputsProps) {
  // Card border colors. In editable mode an invalid value highlights the
  // card itself (red) so the user can see which field needs attention
  // without an extra inline message above the row.
  const principalCardBorder =
    editable && !principalValid
      ? "border-red-500/70 focus-within:border-red-400"
      : "border-neutral-700 focus-within:border-neutral-500";
  const balanceCardBorder =
    editable && !balanceValid
      ? "border-red-500/70 focus-within:border-red-400"
      : "border-neutral-700 focus-within:border-neutral-500";

  return (
    <div className="shrink-0 space-y-2">
      {/* Row 1: principal + balance.
          - Read-only mode: formatted amount as a span.
          - Editable mode: transparent <input> inside the same card shell.
          - Loading mode: animated shimmer in either mode. */}
      <div className="flex items-stretch gap-2">
        <label
          className={`flex flex-1 min-w-0 flex-col rounded-lg border bg-neutral-800 px-3 py-2 ${principalCardBorder}`}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            {editable ? "Original principal" : "Original"}
          </span>
          {isLoadingRemote ? (
            <span
              className="mt-0.5 h-4 w-24 animate-pulse rounded bg-neutral-700"
              aria-label="Loading original principal"
            />
          ) : editable ? (
            <input
              className="mt-0.5 w-full bg-transparent text-sm font-semibold tabular-nums text-neutral-100 outline-none"
              type="text"
              inputMode="decimal"
              value={originalPrincipalText}
              aria-invalid={!principalValid}
              onChange={(e) => setOriginalPrincipalText?.(e.target.value)}
              onBlur={commitPrincipalText}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <span className="truncate text-sm font-semibold tabular-nums text-neutral-100">
              {formatAmount(originalPrincipalText)}
            </span>
          )}
        </label>
        <label
          className={`flex flex-1 min-w-0 flex-col rounded-lg border bg-neutral-800 px-3 py-2 ${balanceCardBorder}`}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            {editable ? "Current balance" : "Current"}
          </span>
          {isLoadingRemote ? (
            <span
              className="mt-0.5 h-4 w-24 animate-pulse rounded bg-neutral-700"
              aria-label="Loading current balance"
            />
          ) : editable ? (
            <input
              className="mt-0.5 w-full bg-transparent text-sm font-semibold tabular-nums text-emerald-300 outline-none"
              type="text"
              inputMode="decimal"
              value={currentBalanceText}
              aria-invalid={!balanceValid}
              onChange={(e) => setCurrentBalanceText?.(e.target.value)}
              onBlur={commitBalanceText}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <span className="truncate text-sm font-semibold tabular-nums text-emerald-300">
              {formatAmount(currentBalanceText)}
            </span>
          )}
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
      {/* Validation hints (editable mode only). Per-field syntax errors
          take priority; the cross-field "exceeds principal" message
          appears for both modes whenever the relation is violated. */}
      {editable && !isLoadingRemote && !principalValid && (
        <p className="text-xs text-red-400">
          Original principal must be a non-negative number, e.g. 34 or 45.56.
        </p>
      )}
      {editable && !isLoadingRemote && !balanceSyntaxValid && (
        <p className="text-xs text-red-400">
          Current balance must be a non-negative number, e.g. 34 or 45.56.
        </p>
      )}
      {(!editable || balanceSyntaxValid) && balanceExceedsPrincipal && (
        <p className="text-xs text-red-400">
          Current balance cannot exceed the original principal.
        </p>
      )}
    </div>
  );
}
