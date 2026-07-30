// Loads the latest leave report.
//
// GitHub's raw.githubusercontent.com CDN caches a branch path for ~5 min and IGNORES `?t=` busters
// (Fastly serves x-cache: HIT), so reading `…/refs/heads/leave-tracker/report/…` can be up to 5 min
// stale — a just-merged add-person wouldn't show on Refresh. To make Refresh actually fresh, we first
// ask the GitHub API for the report branch's newest commit SHA, then read the files from the
// IMMUTABLE `…/<sha>/…` raw URL (content at a fixed SHA never changes, so it's always current).
// Fallbacks: the branch path (possibly ~5 min stale) → the bundled snapshot in public/data/.
import type { CoverageDoc, Dataset, LeavesDoc } from "./types";

const OWNER_REPO = "NASA-IMPACT/veda-github-actions";
const REPORT_BRANCH = "leave-tracker/report";
const COMMITS_API = `https://api.github.com/repos/${OWNER_REPO}/commits/${REPORT_BRANCH}`;
const BRANCH_BASE = `https://raw.githubusercontent.com/${OWNER_REPO}/refs/heads/${REPORT_BRANCH}/reports`;
const shaBase = (sha: string) => `https://raw.githubusercontent.com/${OWNER_REPO}/${sha}/reports`;
const LOCAL_BASE = "data"; // resolved against the site root -> public/data/

interface Manifest {
  slug: string;
  generated: string;
  files: { json: string; coverage: string };
}

async function fetchJson<T>(base: string, file: string): Promise<T> {
  const url = `${base}/${file}?t=${Date.now()}`; // cache-buster (works for the API + snapshot)
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function loadFrom(base: string): Promise<{ doc: LeavesDoc; coverage: CoverageDoc; generated: string }> {
  const manifest = await fetchJson<Manifest>(base, "leave_manifest.json");
  const [doc, coverage] = await Promise.all([
    fetchJson<LeavesDoc>(base, manifest.files.json),
    fetchJson<CoverageDoc>(base, manifest.files.coverage),
  ]);
  return { doc, coverage, generated: manifest.generated };
}

async function latestReportSha(): Promise<string | null> {
  try {
    const res = await fetch(`${COMMITS_API}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null; // rate-limited / offline -> fall back to the branch path
    const body = (await res.json()) as { sha?: string };
    return body.sha ?? null;
  } catch {
    return null;
  }
}

export async function loadDataset(): Promise<Dataset> {
  // 1) Freshest: immutable commit-SHA URL (bypasses the ~5 min branch CDN cache).
  const sha = await latestReportSha();
  if (sha) {
    try {
      const { doc, coverage, generated } = await loadFrom(shaBase(sha));
      return { source: "live", generated, doc, coverage };
    } catch {
      /* fall through */
    }
  }
  // 2) Branch path (may be up to ~5 min stale, but always works if the branch exists).
  try {
    const { doc, coverage, generated } = await loadFrom(BRANCH_BASE);
    return { source: "live", generated, doc, coverage };
  } catch {
    // 3) Bundled snapshot.
    const { doc, coverage, generated } = await loadFrom(LOCAL_BASE);
    return { source: "snapshot", generated, doc, coverage };
  }
}
