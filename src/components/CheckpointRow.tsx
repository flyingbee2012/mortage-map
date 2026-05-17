import { useCallback } from "react";
import type { RowComponentProps } from "react-window";
import { CheckpointNameInput } from "./CheckpointNameInput";
import type { Checkpoint } from "../utils/helper";

// Row props passed to react-window's List. The `route` / `selectedIndex` /
// `editMode` / handlers come from the parent via `rowProps`; react-window
// adds `index` / `style` / `ariaAttributes` per row. Only the rows actually
// in the viewport (~20–30 of 8k) are rendered, so memoization isn't needed
// here anymore — the wins now come from not rendering 8k rows at all.
export type CheckpointRowExtraProps = {
  route: Checkpoint[];
  selectedIndex: number | null;
  editMode: boolean;
  onSelect: (i: number) => void;
  onRename: (index: number, name: string) => void;
};

export function CheckpointRow({
  index,
  style,
  ariaAttributes,
  route,
  selectedIndex,
  editMode,
  onSelect,
  onRename,
}: RowComponentProps<CheckpointRowExtraProps>) {
  const checkpoint = route[index];
  const isSelected = selectedIndex === index;
  const handleClick = useCallback(() => onSelect(index), [onSelect, index]);
  const handleCommit = useCallback(
    (next: string) => onRename(index, next),
    [onRename, index],
  );
  if (!checkpoint) return null;
  return (
    <div
      {...ariaAttributes}
      style={style}
      onClick={handleClick}
      className={`flex items-center gap-1 text-xs rounded px-1 cursor-pointer transition ${
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
          onCommit={handleCommit}
        />
      ) : (
        <span
          className="flex-1 min-w-0 truncate text-neutral-200"
          title={`${checkpoint.name} (${checkpoint.lat.toFixed(3)}, ${checkpoint.lng.toFixed(3)})`}
        >
          {checkpoint.name}
        </span>
      )}
    </div>
  );
}
