// Loads AWS pricing JSON published by .github/workflows/aws-pricing.yml to the aws-pricing/data branch.
//
// raw.githubusercontent.com caches a branch path for ~5 min and ignores `?t=` busters, so reading
// `…/refs/heads/aws-pricing/data/…` can be up to 5 min stale. To make a refresh actually fresh we first
// ask the GitHub API for the data branch's newest commit SHA, then read from the IMMUTABLE `…/<sha>/…`
// raw URL (content at a fixed SHA never changes). Fallbacks: the branch path → the bundled snapshot
// in public/data/ (so the app works even before the branch exists).
import type { IndexDoc, PricingDoc } from "./types";

const OWNER_REPO = "NASA-IMPACT/veda-github-actions";
const DATA_BRANCH = "aws-pricing/data";
const COMMITS_API = `https://api.github.com/repos/${OWNER_REPO}/commits/${DATA_BRANCH}`;
const BRANCH_BASE = `https://raw.githubusercontent.com/${OWNER_REPO}/refs/heads/${DATA_BRANCH}/reports`;
const shaBase = (sha: string) => `https://raw.githubusercontent.com/${OWNER_REPO}/${sha}/reports`;
const LOCAL_BASE = "data"; // resolved against the site root -> public/data/

export interface LoadedDataset {
  source: "live" | "snapshot";
  base: string; // where subsequent region files are fetched from (keeps live/snapshot consistent)
  index: IndexDoc;
  pricing: PricingDoc;
}

async function fetchJson<T>(base: string, file: string): Promise<T> {
  const url = `${base}/${file}?t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function loadFrom(base: string): Promise<{ index: IndexDoc; pricing: PricingDoc }> {
  const index = await fetchJson<IndexDoc>(base, "index.json");
  const entry = index.regions[index.defaultRegion] ?? Object.values(index.regions)[0];
  const pricing = await fetchJson<PricingDoc>(base, entry.file);
  return { index, pricing };
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

export async function loadDataset(): Promise<LoadedDataset> {
  // 1) Freshest: immutable commit-SHA URL (bypasses the ~5 min branch CDN cache).
  const sha = await latestSha();
  if (sha) {
    try {
      const { index, pricing } = await loadFrom(shaBase(sha));
      return { source: "live", base: shaBase(sha), index, pricing };
    } catch {
      /* fall through */
    }
  }
  // 2) Branch path (maybe ~5 min stale, but always works if the branch exists).
  try {
    const { index, pricing } = await loadFrom(BRANCH_BASE);
    return { source: "live", base: BRANCH_BASE, index, pricing };
  } catch {
    // 3) Bundled snapshot.
    const { index, pricing } = await loadFrom(LOCAL_BASE);
    return { source: "snapshot", base: LOCAL_BASE, index, pricing };
  }
}

// Fetch one region's pricing file from the same base the dataset was loaded from (region switching).
export function loadRegion(base: string, file: string): Promise<PricingDoc> {
  return fetchJson<PricingDoc>(base, file);
}
