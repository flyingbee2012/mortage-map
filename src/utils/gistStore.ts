/**
 * Tiny "remote storage" backed by a single GitHub Gist file.
 *
 * Used to sync the mortgage principal/balance numbers across this user's
 * devices (e.g. desktop + iPhone). The gist holds a single JSON file:
 *
 *   mortgage.json:
 *   { "originalPrincipal": 367260.71, "currentBalance": 367253.71 }
 *
 * Configuration is supplied at build time via Vite env vars:
 *   VITE_GIST_ID     - the gist ID (the hex string in the gist URL)
 *   VITE_GIST_TOKEN  - a fine-grained PAT with "Gists: read and write"
 *
 * Security note: VITE_* vars get inlined into the client JS bundle. A
 * determined visitor can extract the token. Risk is bounded — the token is
 * gist-scoped only, so worst case is gist vandalism / rate-limit abuse,
 * not money or repo access. Acceptable for a personal app at an obscure
 * URL; revisit if more users join.
 */

import {
  Checkpoint,
  compactCheckpoints,
  expandCheckpoints,
  isValidCheckpoint,
} from "./helper";

const GIST_ID = (import.meta.env.VITE_GIST_ID as string | undefined) ?? "";
const GIST_TOKEN =
  (import.meta.env.VITE_GIST_TOKEN as string | undefined) ?? "";
const GIST_FILENAME = "mortgage.json";
const GIST_API_URL = `https://api.github.com/gists/${GIST_ID}`;

export type MortgageGistData = {
  originalPrincipal: number;
  currentBalance: number;
  /**
   * The full edited route, synced across devices. When present, clients
   * adopt this on load (overriding both localStorage and the bundled
   * defaultRoute.json). Written by the "Done editing" flow whenever the
   * route actually changed during the edit session. Absent on first-ever
   * save — clients then fall back to the bundled defaultRoute.json.
   */
  route?: Checkpoint[];
};

export function isGistConfigured(): boolean {
  return GIST_ID.length > 0 && GIST_TOKEN.length > 0;
}

function authHeaders(): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${GIST_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Fetch the mortgage values from the gist. Returns null if the gist is not
 * configured, the network call fails, or the file content is missing /
 * malformed. Callers should fall back to localStorage in those cases.
 */
export async function loadFromGist(): Promise<MortgageGistData | null> {
  if (!isGistConfigured()) return null;
  try {
    // `cache: "no-store"` bypasses the browser's HTTP cache. Without it,
    // GitHub's `Cache-Control: private, max-age=60` header lets the browser
    // return a stale gist body for up to a minute, so a save on one device
    // wouldn't show up on another until the cache expired.
    const res = await fetch(GIST_API_URL, {
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      files?: Record<string, { content?: string } | undefined>;
    };
    const content = json.files?.[GIST_FILENAME]?.content;
    if (typeof content !== "string") return null;
    const parsed = JSON.parse(content) as Partial<MortgageGistData>;
    if (
      typeof parsed.originalPrincipal !== "number" ||
      typeof parsed.currentBalance !== "number"
    ) {
      return null;
    }
    // The route field is optional; tolerate missing / malformed entries by
    // dropping just that field rather than rejecting the whole payload.
    // Stored in compact form (placeholder names omitted); expand back to
    // full Checkpoint[] before handing off to callers.
    let route: Checkpoint[] | undefined;
    if (Array.isArray(parsed.route) && parsed.route.every(isValidCheckpoint)) {
      route = expandCheckpoints(parsed.route);
    }
    return {
      originalPrincipal: parsed.originalPrincipal,
      currentBalance: parsed.currentBalance,
      route,
    };
  } catch {
    return null;
  }
}

/**
 * Write the mortgage values to the gist. Resolves true on success, false
 * if the gist is not configured or the write fails (offline, bad token,
 * rate-limited, etc.). Callers should treat false as "saved locally only".
 */
export async function saveToGist(data: MortgageGistData): Promise<boolean> {
  if (!isGistConfigured()) return false;
  try {
    // Drop undefined fields so we don't write `null` placeholders into
    // the gist for optional values the caller didn't supply. Anything
    // present is written verbatim.
    const payload: Record<string, unknown> = {
      originalPrincipal: data.originalPrincipal,
      currentBalance: data.currentBalance,
    };
    if (data.route) payload.route = compactCheckpoints(data.route);
    const body = {
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(payload) + "\n",
        },
      },
    };
    const res = await fetch(GIST_API_URL, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
