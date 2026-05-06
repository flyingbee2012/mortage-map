/**
 * Placeholder shown in place of an `<input>` while the initial gist load
 * is in flight. Matches the input's box (rounded-xl, neutral-800 bg,
 * py-1.5 vertical rhythm) so the layout doesn't shift when the real
 * input takes over, and includes an animated shimmer + small spinner so
 * the loading state is visible exactly where the value will appear.
 */
export function SkeletonInput({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex w-full items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-1.5"
    >
      <svg
        className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-300"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        />
      </svg>
      <span className="h-4 flex-1 animate-pulse rounded bg-neutral-700" />
    </div>
  );
}
