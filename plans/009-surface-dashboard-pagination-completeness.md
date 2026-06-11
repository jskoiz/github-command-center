# Plan 009: Surface dashboard pagination completeness

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in "STOP conditions" occurs, stop and report. When done,
> update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3289de0..HEAD -- server/github-client.ts server/github-dashboard.ts server/*.test.ts src/types/github.ts src/components/dashboard`
> and `git diff --stat -- server/github-client.ts server/github-dashboard.ts server/*.test.ts src/types/github.ts src/components/dashboard`.
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/006-cover-hosted-auth-boundaries.md`
- **Category**: correctness
- **Planned at**: commit `3289de0`, 2026-06-11

## Why this matters

The dashboard presents repo, PR, issue, and CI counts as operational truth. For
large GitHub accounts, hosted REST pagination stops after 10 pages and GraphQL
repo count enrichment stops after 4 pages of 50 repos. That can silently omit
repos or mix precise GraphQL counts with fallback REST counts, making the
dashboard look complete when it is not.

## Current state

- Hosted REST pagination caps at 10 pages in `server/github-client.ts`.
- Full repo loading asks for `/user/repos?per_page=100` with `--paginate
  --slurp`, so 10 pages means at most 1000 repos in hosted mode.
- GraphQL enrichment loops exactly 4 pages at 50 repos each, so only the first
  200 repos get precise open PR, open issue, and check-rollup counts.
- `toRepoSummary` falls back to REST `open_issues_count` when GraphQL data is
  missing; GitHub REST's `open_issues_count` includes pull requests.

Relevant excerpts:

```ts
// server/github-client.ts:3
const MAX_PAGINATED_PAGES = 10
```

```ts
// server/github-client.ts:81
for (let page = 0; page < (parsed.paginate ? MAX_PAGINATED_PAGES : 1); page += 1) {
  const response = await githubFetch(token, url, parsed.headers, endpoint)
  const body = await response.text()
  pages.push(body ? JSON.parse(body) : null)
```

```ts
// server/github-dashboard.ts:388
const pages = await ghJson<RawRepo[][]>(endpoint, { paginate: true, slurp: true })
return pages.flat()
```

```ts
// server/github-dashboard.ts:427
for (let page = 0; page < 4; page += 1) {
```

```ts
// server/github-dashboard.ts:798
openIssues: graph?.issues?.totalCount ?? repo.open_issues_count,
openPullRequests: graph?.pullRequests?.totalCount ?? null,
checkState: graph?.defaultBranchRef?.target?.statusCheckRollup?.state ?? null,
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npm run test -- server/github-client.test.ts server/github-dashboard.test.ts` | exit 0 |
| Full tests | `npm run test` | exit 0 |
| Final check | `npm run check` | exit 0 |

## Scope

**In scope**:

- `server/github-client.ts`
- `server/github-dashboard.ts`
- `server/github-client.test.ts`
- `server/github-dashboard.test.ts`
- `src/types/github.ts` only if a small metadata field is needed
- Warning display components only if the warning shape changes

**Out of scope**:

- Adding a user-facing scan-limit control.
- Replacing the GitHub API strategy with a database or background worker.
- Changing OAuth scopes.
- Fetching workflow runs for every repo; `scanLimit` remains the CI run scan
  boundary.

## Git workflow

- Branch: `c1/009-surface-pagination-completeness`
- Commit message: `Surface dashboard pagination completeness`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Make hosted REST truncation explicit

Change hosted REST pagination so reaching the page cap is not silent. One
acceptable implementation:

- Add a typed `PaginationLimitError` in `server/github-client.ts`.
- When `executeRest` finishes the final allowed page and the response still has
  a `rel="next"` link, throw `PaginationLimitError`.
- Include endpoint, page count, and parsed partial pages on the error object.
- Never include the token or headers in the error.

Update `getRepos` to catch this specific error, push a `repos` warning, and
return the partial repo pages rather than dropping all repos.

Expected warning message shape:

```ts
{
  area: "repos",
  message: "Repository list reached the hosted pagination limit; dashboard data is partial.",
}
```

**Verify**: `npm run test -- server/github-client.test.ts server/github-dashboard.test.ts` covers the capped-pagination warning and partial data preservation.

### Step 2: Fetch GraphQL count pages to match repo coverage, up to a visible cap

Change `getRepoGraphData` so it accepts the repo count from `loadGithubDashboard`
and attempts enough 50-repo pages to cover that count.

Suggested shape:

```ts
const requestedPages = Math.ceil(repoCount / 50)
const maxPages = Math.min(requestedPages, MAX_GRAPHQL_REPO_PAGES)
```

Use a named constant for `MAX_GRAPHQL_REPO_PAGES`. If `repositories.pageInfo`
still has `hasNextPage` after the cap, push a `repo counts` warning. This keeps
API cost bounded but makes incomplete enrichment visible.

**Verify**: Add tests proving:

- 201 repos cause at least 5 GraphQL calls when cursors keep returning.
- If the GraphQL cap is reached with `hasNextPage: true`, a warning is returned.
- Existing small-account tests still make one GraphQL call.

### Step 3: Avoid precise-looking fallback counts when GraphQL data is incomplete

When GraphQL count enrichment is unavailable for a repo because the enrichment
cap was reached or GraphQL failed, avoid presenting REST `open_issues_count` as
if it were the same precise issue count. Prefer `null` for missing
`openIssues`, `openPullRequests`, and `checkState` in the affected full payload,
plus the warning from Step 2.

Keep quick mode unchanged unless you deliberately update the UI to label quick
counts as provisional. Quick mode is already marked by `detailLevel: "quick"`.

**Verify**: `npm run test -- server/github-dashboard.test.ts` includes a case
where a repo without GraphQL data has null PR/issue/check counts in the full
payload.

### Step 4: Keep the UI readable when counts are unknown

Audit existing UI rendering for `openIssues` and `openPullRequests` nulls. It
already uses nullish coalescing in some places. If any table cell or attention
count renders `NaN`, `undefined`, or misleading zero for unknown full-mode
counts, update the component to render `n/a` or omit that repo from the summed
count.

Do not redesign the dashboard in this plan.

**Verify**: `npm run test` and, if component rendering changed, add a focused
component test for null counts.

## Test plan

- `server/github-client.test.ts` covers REST pagination cap behavior and token
  redaction.
- `server/github-dashboard.test.ts` covers partial repo preservation, GraphQL
  page expansion, cap warnings, and unknown count nulls.
- Existing quick/full cache tests must continue passing.
- Final verification: `npm run lint`, `npm run typecheck`, `npm run test`, and
  `npm run check` all exit 0.

## Done criteria

- [ ] Hosted REST pagination cannot truncate without a warning.
- [ ] GraphQL repo-count enrichment scales with repo count up to a named cap.
- [ ] GraphQL cap or failure produces a visible dashboard warning.
- [ ] Full-mode repos without GraphQL count data do not display fallback counts
  as precise counts.
- [ ] UI handles unknown PR/issue/check counts without `NaN` or misleading zero.
- [ ] `npm run lint` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run test` exits 0.
- [ ] `npm run check` exits 0.
- [ ] `plans/README.md` status row for Plan 009 is updated.

## STOP conditions

Stop and report back if:

- The GitHub API cost of covering all repos is materially higher than expected
  for normal accounts.
- Fixing count semantics requires a public response-shape migration beyond
  nullable existing fields.
- The UI cannot distinguish quick provisional counts from full precise counts
  without a larger design change.
- Any error or warning would expose token or private header values.

## Maintenance notes

If a future plan adds user-controlled scan scope, keep pagination completeness
warnings tied to what the dashboard actually fetched. Reviewers should focus on
whether partial data remains usable but unmistakably marked partial.
