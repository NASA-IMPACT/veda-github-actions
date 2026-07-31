import type { ChangeDoc } from "./changesData";

/** Build the filename + JSON body for a changes bundle. */
export function buildChangesFile(items: ChangeDoc[]): { filename: string; json: string } {
  const maxTs = items.reduce((m, d) => (d.ts > m ? d.ts : m), "");
  const stamp = maxTs.replace(/[^a-zA-Z0-9]/g, "-");
  const filename = `dse-hub/data/changes/${stamp}-${items.length}.json`;
  const json = JSON.stringify(items, null, 2);
  return { filename, json };
}
