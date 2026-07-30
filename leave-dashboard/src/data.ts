// Loads the latest leave report.
//
// Primary source: the public `leave-tracker/report` branch on GitHub (raw URLs). Because the
// branch name contains a slash, the raw host needs the `/refs/heads/` form. If that branch/file
// is unavailable (not seeded yet, or offline), fall back to the snapshot bundled in public/data/.
import type { CoverageDoc, Dataset, LeavesDoc } from "./types";

const RAW_BASE =
  "https://raw.githubusercontent.com/NASA-IMPACT/veda-github-actions/refs/heads/leave-tracker/report/reports";
const LOCAL_BASE = "data"; // resolved against the site root -> public/data/

interface Manifest {
  slug: string;
  generated: string;
  files: { json: string; coverage: string };
}

async function fetchJson<T>(base: string, file: string): Promise<T> {
  const url = `${base}/${file}?t=${Date.now()}`; // cache-buster: always newest report
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

export async function loadDataset(): Promise<Dataset> {
  try {
    const { doc, coverage, generated } = await loadFrom(RAW_BASE);
    return { source: "live", generated, doc, coverage };
  } catch {
    const { doc, coverage, generated } = await loadFrom(LOCAL_BASE);
    return { source: "snapshot", generated, doc, coverage };
  }
}
