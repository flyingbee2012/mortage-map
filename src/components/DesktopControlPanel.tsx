import type { RefObject } from "react";
import { CheckpointNameInput } from "./CheckpointNameInput";
import { MortgageInputs } from "./MortgageInputs";
import {
  Checkpoint,
  formatCurrencyCents,
  isApiKeyConfigured,
} from "../utils/helper";

type DesktopControlPanelProps = {
  apiKey: string;
  destinationName: string;

  // Mortgage inputs.
  originalPrincipalText: string;
  currentBalanceText: string;
  principalValid: boolean;
  balanceValid: boolean;
  balanceSyntaxValid: boolean;
  balanceExceedsPrincipal: boolean;
  inputsValid: boolean;
  setOriginalPrincipalText: (s: string) => void;
  setCurrentBalanceText: (s: string) => void;
  commitPrincipalText: () => void;
  commitBalanceText: () => void;
  stepCurrentBalance: (delta: number) => void;
  saveMortgageInputs: () => void;
  resetMortgageInputs: () => void;
  focusCurrentPosition: () => void;

  // Stats.
  progress: number;
  totalKm: number;
  traveledKm: number;
  remainingKm: number;
  paidPrincipal: number;
  safeOriginalPrincipal: number;
  currentSegment: string;

  // Route + edit mode.
  route: Checkpoint[];
  editMode: boolean;
  startEditingRoute: () => void;
  finishEditingRoute: () => void;
  cancelEditingRoute: () => void;
  selectedCheckpointIndex: number | null;
  setSelectedCheckpointIndex: (i: number | null) => void;
  selectedListItemRef: RefObject<HTMLLIElement>;
  renameCheckpoint: (index: number, name: string) => void;
  fitMapToRoute: () => void;
  exportRouteJson: () => void;
  resetRoute: () => void;
  isLoadingRemote: boolean;
};

/**
 * Desktop control panel: full-featured left column shown side-by-side with
 * the map on viewports ≥ 1024px. Includes editable inputs, Save/Reset, the
 * full route list, and the edit-route flow.
 */
export function DesktopControlPanel({
  apiKey,
  destinationName,
  originalPrincipalText,
  currentBalanceText,
  principalValid,
  balanceValid,
  balanceSyntaxValid,
  balanceExceedsPrincipal,
  inputsValid,
  setOriginalPrincipalText,
  setCurrentBalanceText,
  commitPrincipalText,
  commitBalanceText,
  stepCurrentBalance,
  saveMortgageInputs,
  resetMortgageInputs,
  focusCurrentPosition,
  progress,
  totalKm,
  traveledKm,
  remainingKm,
  paidPrincipal,
  safeOriginalPrincipal,
  currentSegment,
  route,
  editMode,
  startEditingRoute,
  finishEditingRoute,
  cancelEditingRoute,
  selectedCheckpointIndex,
  setSelectedCheckpointIndex,
  selectedListItemRef,
  renameCheckpoint,
  fitMapToRoute,
  exportRouteJson,
  resetRoute,
  isLoadingRemote,
}: DesktopControlPanelProps) {
  return (
    <section className="rounded-2xl bg-neutral-900 shadow-xl p-4 flex-none w-[380px] h-full flex flex-col gap-3">
      {!editMode && (
        <div>
          <h1 className="text-xl font-semibold">
            Walking to {destinationName.split("·")[0].trim()}
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Turn your mortgage balance into a journey. Every bit of principal
            you pay off brings you closer to the destination. Edit the route
            below to make it your own.
          </p>
        </div>
      )}

      {!editMode && !isApiKeyConfigured(apiKey) && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100 space-y-2">
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

      {/* Progress bar (placed above the mortgage inputs to match the
          mobile layout). */}
      {!editMode && (
        <div className="relative h-5 rounded-full bg-neutral-800 overflow-hidden">
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
      )}

      {/* Mortgage inputs: shared component with the mobile panel. The only
          difference is `editable={true}`, which swaps the read-only display
          spans for actual <input>s so the user can type into the principal
          and balance fields. The +/- step buttons and card layout are
          identical across both modes. */}
      {!editMode && (
        <MortgageInputs
          editable
          originalPrincipalText={originalPrincipalText}
          currentBalanceText={currentBalanceText}
          principalValid={principalValid}
          balanceValid={balanceValid}
          balanceSyntaxValid={balanceSyntaxValid}
          balanceExceedsPrincipal={balanceExceedsPrincipal}
          setOriginalPrincipalText={setOriginalPrincipalText}
          setCurrentBalanceText={setCurrentBalanceText}
          commitPrincipalText={commitPrincipalText}
          commitBalanceText={commitBalanceText}
          stepCurrentBalance={stepCurrentBalance}
          isLoadingRemote={isLoadingRemote}
        />
      )}

      {/* Save / Reset row (matches the mobile button styling). "Fit route"
          stays inside the Route panel below, so this row only carries the
          two persistence actions. */}
      {!editMode && (
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-2 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-500/20"
            onClick={saveMortgageInputs}
            disabled={!inputsValid}
            title={
              inputsValid
                ? "Persist the current principal and balance to localStorage so they reload next time."
                : "Fix the invalid input(s) above before saving."
            }
          >
            Save
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 transition"
            onClick={resetMortgageInputs}
            title="Restore the values to whatever was loaded when the app started. Does not modify localStorage."
          >
            Reset
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
      )}

      {/* Stats card */}
      {!editMode && (
        <div className="rounded-2xl bg-neutral-800 p-3 space-y-3 text-sm">
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
      )}

      {/* Route panel + edit-route flow */}
      <div className="flex rounded-2xl bg-neutral-800 p-3 space-y-2 flex-1 min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-200">
            Route ({route.length} checkpoints)
          </h2>
          <div className="flex items-center gap-2">
            {!editMode && (
              <button
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 transition disabled:opacity-40"
                type="button"
                onClick={fitMapToRoute}
                disabled={route.length === 0}
                title="Zoom out to show the entire route"
              >
                Fit route
              </button>
            )}
            {editMode && (
              <button
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 transition"
                type="button"
                onClick={cancelEditingRoute}
                title="Discard all edits and revert to the route from when you started editing"
              >
                Cancel
              </button>
            )}
            <button
              className={`rounded-lg border px-2 py-1 text-xs transition ${
                editMode
                  ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                  : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-700"
              }`}
              type="button"
              onClick={editMode ? finishEditingRoute : startEditingRoute}
            >
              {editMode ? "Done editing" : "Edit route"}
            </button>
          </div>
        </div>

        {editMode && (
          <p className="text-xs text-neutral-300">
            Total: <strong>{totalKm.toFixed(4)} km</strong>
            <span className="mx-2 text-neutral-500">·</span>
            $1 ={" "}
            <strong>
              {safeOriginalPrincipal > 0
                ? ((totalKm * 1000) / safeOriginalPrincipal).toFixed(4)
                : "0.0000"}{" "}
              m
            </strong>
          </p>
        )}

        {editMode && (
          <p className="text-xs text-neutral-400 leading-relaxed">
            Drag a marker to move it. Select a checkpoint, then right-click
            anywhere to insert a new one after it (Shift+right-click inserts
            before). Ctrl+click anywhere to auto-route (walking) from the
            selected checkpoint to the click and drop in checkpoints along the
            way (Shift+Ctrl+click = fewer, coarser points). Alt+click anywhere
            to drop a single checkpoint at the click location (useful where
            auto-routing is unreliable). Middle-click deletes the selected
            checkpoint. Tab / Shift+Tab steps the selection along the route.
          </p>
        )}

        {route.length === 0 ? (
          <p className="text-xs text-neutral-500 italic">
            No checkpoints yet. Turn on edit mode and click the map to add some.
          </p>
        ) : (
          <ol className="space-y-1 overflow-y-auto pr-1 flex-1 min-h-0">
            {route.map((checkpoint, index) => {
              const isSelected = selectedCheckpointIndex === index;
              return (
                <li
                  key={index}
                  ref={isSelected ? selectedListItemRef : undefined}
                  onClick={() => setSelectedCheckpointIndex(index)}
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
                    <CheckpointNameInput
                      initialName={checkpoint.name}
                      onCommit={(name) => renameCheckpoint(index, name)}
                    />
                  ) : (
                    <span
                      className="flex-1 min-w-0 truncate text-neutral-200"
                      title={`${checkpoint.name} (${checkpoint.lat.toFixed(3)}, ${checkpoint.lng.toFixed(3)})`}
                    >
                      {checkpoint.name}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {editMode && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
              type="button"
              onClick={fitMapToRoute}
              disabled={route.length === 0}
            >
              Fit map to route
            </button>
            <button
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
              type="button"
              onClick={exportRouteJson}
              disabled={route.length === 0}
              title="Download as defaultRoute.json — replace src/data/defaultRoute.json and commit to save."
            >
              Export JSON
            </button>
            <button
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
              type="button"
              onClick={resetRoute}
            >
              Reset to default
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
