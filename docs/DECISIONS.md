# Architectural Decisions

Short ADRs for non-obvious choices. Newest first.

## PR Finder — crawl objectives' sub-issue trees → closing PRs

**Second action ships in a subfolder (`pr-finder/`), not the repo root.**
The root `action.yml` is the FTE action (`uses: …@v1`). GitHub allows multiple actions per repo via
subfolders, so PR Finder is `uses: …/pr-finder@v1`. The generator is co-located in `pr-finder/` so
`${{ github.action_path }}/generate_pr_finder.py` resolves without a `..` traversal.

**Traversal = single global BFS, alias-batched — not per-objective, not deep-nested.**
A deep-nested `subIssues` query blows up GraphQL node cost (~N^5). Per-objective BFS wastes one request
per objective at the top level. Since GitHub sub-issues form a strict tree (one parent per issue), a
*single* BFS across all objectives with a global `seen`/`node_by_ref` set is both correct and efficient
(96 objectives went from ~101 requests → ~6). Each node carries `repository.nameWithOwner`, so cross-repo/
org traversal is automatic; per-alias `FORBIDDEN`/`NOT_FOUND` degrades to empty children, never aborts.

**PR linkage = `closedByPullRequestsReferences(includeClosedPrs: true)` only.**
"PRs under an objective" means PRs that *close* its sub-issues (`closes #N` / linked branch), not loose
cross-references (deliberately excluded as noise). `includeClosedPrs: true` also surfaces closed-but-
unmerged linked PRs alongside open/merged ones.

**`subIssues` GraphQL needs no `GraphQL-Features` header** (verified live), so the crawler uses GraphQL
end-to-end rather than the REST `/sub_issues` endpoint the reMINDer reference used.

**Output = CSV + H2-per-objective Markdown + self-contained USWDS HTML.** The HTML inlines USWDS-inspired
tokens (no web-font/CDN fetch) so it opens anywhere. Markdown is per-objective `##` heading + a `<ul>` of
its PRs (per the requested shape). Verified end-to-end: offline fixture (depth 5) + a live cross-org crawl.

## Seeding — real cross-org proof

**Simulate the crawl with a real seeded tree, cross-org.** The demo boards are flat, so
`seed/seed_subissue_tree.py` builds a depth-5 sub-issue tree + closing PRs in real repos. Nodes carry
their own repo; `--hop-repo/--hop-at-depth` makes the tree cross into a second owner/org partway down,
so one crawl proves depth-5 AND cross-org. Proven live: root+L1-L2 in
`Disasters-Learning-Portal/disasters-aws-conversion`, L3-L5 in `kyle-lesinger/veda-subissue-seed`,
crawled from org project #5 → 6 issues, 5 PRs across two orgs, depth 5.

**Sub-issue links via `addSubIssue` GraphQL mutation** (repo-agnostic global node ids → works cross-org).
REST fallback (`POST /repos/{parent}/issues/{n}/sub_issues`) needs the child's **`databaseId`**, not its
node id — the seeder records both.

## Netlify — one site per dashboard ("Pattern B")

Each dashboard gets its own Netlify site, connected to the same repo with a different **base directory**;
Netlify reads the `netlify.toml` inside that base, so sites are fully isolated (chosen over one shared
site with routing). `pr-dashboard/` is static (no build) — it fetches the report from the
`pr-finder/report` branch at runtime (mirroring how `fte-dashboard` fetches CSVs from `fte-report/all-pis`),
with a bundled snapshot fallback.
