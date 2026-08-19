// Loads the board JSON published by .github/workflows/board-explorer.yml to the
// `board-explorer/data` branch.
//
// raw.githubusercontent.com caches a branch path for ~5 min and ignores `?t=` busters, so reading
// `…/refs/heads/board-explorer/data/…` can be up to 5 min stale. To make a refresh actually fresh
// we first ask the GitHub API for the data branch's newest commit SHA, then read from the
// IMMUTABLE `…/<sha>/…` raw URL (content at a fixed SHA never changes). Fallbacks: the branch path
// → the bundled snapshot in public/data/ (so the app works before the branch exists, and offline).
//
// NOTE the `/refs/heads/` form: the branch name contains a slash, so without it the raw URL is
// ambiguous with a path and 404s.
import type { BoardDoc, IndexDoc } from "./types";

const OWNER_REPO = "NASA-IMPACT/veda-github-actions";
const DATA_BRANCH = "board-explorer/data";
const COMMITS_API = `https://api.github.com/repos/${OWNER_REPO}/commits/${DATA_BRANCH}`;
const BRANCH_BASE = `https://raw.githubusercontent.com/${OWNER_REPO}/refs/heads/${DATA_BRANCH}/reports`;
const shaBase = (sha: string) => `https://raw.githubusercontent.com/${OWNER_REPO}/${sha}/reports`;
const LOCAL_BASE = "data"; // resolved against the site root -> public/data/

export interface LoadedBoard {
  source: "live" | "snapshot";
  /** Where any further files are fetched from — keeps live/snapshot from being mixed. */
  base: string;
  index: IndexDoc;
  doc: BoardDoc;
}

async function fetchJson<T>(base: string, file: string): Promise<T> {
  const url = `${base}/${file}?t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function loadFrom(base: string): Promise<{ index: IndexDoc; doc: BoardDoc }> {
  const index = await fetchJson<IndexDoc>(base, "index.json");
  const entry = index.boards[index.defaultBoard] ?? Object.values(index.boards)[0];
  if (!entry) throw new Error("index.json lists no boards");
  const doc = await fetchJson<BoardDoc>(base, entry.file);
  return { index, doc };
}

async function latestSha(): Promise<string | null> {
  try {
    const res = await fetch(`${COMMITS_API}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { sha?: string };
    return body.sha ?? null;
  } catch {
    return null;
  }
}

export async function loadBoard(): Promise<LoadedBoard> {
  // 1) Freshest: immutable commit-SHA URL (bypasses the ~5 min branch CDN cache).
  const sha = await latestSha();
  if (sha) {
    try {
      const { index, doc } = await loadFrom(shaBase(sha));
      return { source: "live", base: shaBase(sha), index, doc };
    } catch {
      /* fall through */
    }
  }
  // 2) Branch path (maybe ~5 min stale, but always works once the branch exists).
  try {
    const { index, doc } = await loadFrom(BRANCH_BASE);
    return { source: "live", base: BRANCH_BASE, index, doc };
  } catch {
    // 3) Bundled snapshot.
    const { index, doc } = await loadFrom(LOCAL_BASE);
    return { source: "snapshot", base: LOCAL_BASE, index, doc };
  }
}

/** Switch to another board on the same source the dataset was loaded from. */
export function loadBoardFile(base: string, file: string): Promise<BoardDoc> {
  return fetchJson<BoardDoc>(base, file);
}
