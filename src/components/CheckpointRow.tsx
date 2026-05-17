import { memo, useCallback, type RefObject } from "react";
import { CheckpointNameInput } from "./CheckpointNameInput";

// Per-row component, memoized so the ~8k checkpoint list doesn't fully
// re-render on every route mutation (Alt+click insert, drag, rename). Only
// rows whose props actually change get reconciled; for an insert that's
// the inserted row + the previously-selected row + the newly-selected row.
type CheckpointRowProps = {
  index: number;
  name: string;
  lat: number;
  lng: number;
  isSelected: boolean;
  editMode: boolean;
  rowRef?: RefObject<HTMLLIElement>;
  onSelect: (i: number) => void;
  onRename: (index: number, name: string) => void;
};

export const CheckpointRow = memo(function CheckpointRow({
  index,
  name,
  lat,
  lng,
  isSelected,
  editMode,
  rowRef,
  onSelect,
  onRename,
}: CheckpointRowProps) {
  const handleClick = useCallback(() => onSelect(index), [onSelect, index]);
  const handleCommit = useCallback(
    (next: string) => onRename(index, next),
    [onRename, index],
  );
  return (
    <li
      ref={rowRef}
      onClick={handleClick}
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
        <CheckpointNameInput initialName={name} onCommit={handleCommit} />
      ) : (
        <span
          className="flex-1 min-w-0 truncate text-neutral-200"
          title={`${name} (${lat.toFixed(3)}, ${lng.toFixed(3)})`}
        >
          {name}
        </span>
      )}
    </li>
  );
});
