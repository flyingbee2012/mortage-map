import { useEffect, useRef, useState } from "react";

// Local-state input used for editing a checkpoint's name. Holds the typed
// text in its own state and only calls onCommit on blur, so each keystroke
// re-renders this small component instead of the entire MortgageMap (which
// would otherwise fire on every character because `route` is the source of
// truth for the controlled input).
export function CheckpointNameInput({
  initialName,
  onCommit,
}: {
  initialName: string;
  onCommit: (name: string) => void;
}) {
  const [text, setText] = useState(initialName);
  // If the underlying route is replaced from outside (e.g., Cancel edits or
  // Reset to default), the prop will change while we are not focused; sync
  // local state to match so the input reflects the new value.
  const lastInitialRef = useRef(initialName);
  useEffect(() => {
    if (initialName !== lastInitialRef.current) {
      lastInitialRef.current = initialName;
      setText(initialName);
    }
  }, [initialName]);
  return (
    <input
      className="flex-1 min-w-0 rounded bg-neutral-900 border border-neutral-700 px-2 py-1 outline-none"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== initialName) {
          lastInitialRef.current = text;
          onCommit(text);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
