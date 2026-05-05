import type { RefObject } from "react";

type MapViewProps = {
  mapRef: RefObject<HTMLDivElement>;
  mapError: string | null;
};

/**
 * Renders the Google Maps container plus a load-failure overlay.
 * Used on BOTH mobile and desktop; layout-related sizing is handled
 * by the flex parent in `MortgageMap`.
 */
export function MapView({ mapRef, mapError }: MapViewProps) {
  return (
    <section className="rounded-2xl overflow-hidden bg-neutral-900 shadow-xl flex-1 min-h-[40vh] lg:min-h-0 lg:h-full relative">
      <div ref={mapRef} className="absolute inset-0" />
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/95 p-6">
          <div className="max-w-lg rounded-2xl border border-red-400/40 bg-red-500/10 p-5 text-red-100 space-y-3">
            <h2 className="text-lg font-semibold">
              Google Maps failed to load
            </h2>
            <p className="text-sm">{mapError}</p>
            <div className="text-sm text-red-100/80 space-y-1">
              <p>Common causes:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  The API key is wrong, or the dev server was not restarted
                  after editing .env.local.
                </li>
                <li>Maps JavaScript API is not enabled in Google Cloud.</li>
                <li>Billing is not enabled for the project.</li>
                <li>
                  The API key's HTTP referrer restriction does not include the
                  current localhost or deployed domain.
                </li>
              </ul>
            </div>
            <p className="text-xs text-red-100/70">
              A map load failure does not affect the loan progress and route
              algorithm tests on the left.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
