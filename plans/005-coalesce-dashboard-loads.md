# Plan 005: Coalesce dashboard loads and make quick mode cheaper

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and stop on any STOP condition. When done, update
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 7510159..HEAD -- server/github-dashboard.ts src/App.tsx src/types/github.ts README.md package.json package-lock.json`
> If in-scope files changed, compare the excerpts below against live code before
> editing.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-establish-verification-baseline.md`
- **Category**: perf
- **Planned at**: commit `7510159`, 2026-06-10

## Why this matters

Cold loads and refreshes can trigger expensive GitHub CLI fanout. Caches are
only populated after a request finishes, so simultaneous requests can duplicate
all work. The "quick" path also still paginates all repos and fetches billing,
so first paint can wait on broad GitHub API work that the UI already knows how
to defer.

## Current state

- `getGithubDashboard` has separate full and quick caches, but no in-flight
  request coalescing.
- The client mount effect uses a `cancelled` boolean but does not abort fetches.
- Quick mode still calls `getRepos` and `getBilling`.
- Full mode scans commits and workflow runs for `enrichedRepos.slice(0,
  scanLimit)`.

Relevant excerpts:

```ts
// server/github-dashboard.ts:128
if (options.quick) {
  if (!options.force && fullCache && now - fullCache.timestamp < FULL_CACHE_MS && fullCache.payload.scanLimit === scanLimit) {
    return fullCache.payload
  }
  if (!options.force && quickCache && now - quickCache.timestamp < QUICK_CACHE_MS && quickCache.payload.scanLimit === scanLimit) {
    return quickCache.payload
  }
  const payload = await getQuickDashboard(scanLimit)
  quickCache = { timestamp: now, payload }
  return payload
}
```

```ts
// server/github-dashboard.ts:187
async function getQuickDashboard(scanLimit: number): Promise<DashboardPayload> {
  const warnings: DashboardWarning[] = []
  const viewer = await getViewer()
  const [repos, billing] = await Promise.all([
    getRepos(warnings),
    getBilling(viewer.login, warnings),
  ])
```

```ts
// src/App.tsx:78
useEffect(() => {
  let cancelled = false
  ...
  void loadInitialDashboard()

  return () => {
    cancelled = true
  }
}, [initialDashboardCache])
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Tests | `npm run test` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:

- `server/github-dashboard.ts`
- `src/App.tsx`
- `README.md` if quick-mode semantics or scan scope wording changes
- Tests for server coalescing and quick-mode behavior

**Out of scope**:

- Replacing GitHub CLI with OAuth or a hosted service.
- Full GraphQL batching of commit/workflow details.
- Adding a user-facing scan-depth control.
- Changing the public dashboard payload type.

## Git workflow

- Branch: `c1/005-coalesce-dashboard-loads`
- Commit message: `Coalesce dashboard API loads`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Add in-flight request coalescing

In `server/github-dashboard.ts`, add an in-flight map keyed by:

- detail level (`quick` or `full`)
- normalized `scanLimit`
- force flag

When a matching request is already running, return the existing promise instead
of starting another GitHub CLI fanout. Remove the entry in `finally`.

Preserve current cache semantics:

- Non-forced quick requests may reuse fresh full cache.
- Non-forced full requests may reuse fresh full cache.
- Forced requests bypass completed caches, but simultaneous forced requests can
  still coalesce with each other.

**Verify**: Unit tests with a mocked GitHub transport prove two simultaneous
full calls share one underlying load and both receive the same payload.

### Step 2: Make quick mode skip slow billing work

Change quick mode so it does not call `getBilling`. Return a valid
`BillingSummary` placeholder with `available: false`, current year/month,
zeroed totals, empty arrays, and a message such as "Billing loads with full
details." Keep the payload shape unchanged.

If a fresh full cache exists, quick mode can continue returning the full payload
as it does today.

**Verify**: A quick-mode test confirms billing fetch is not called when no full
cache is available, and the payload still has a valid `billing` object.

### Step 3: Bound quick repo work to first-paint needs

Do not fetch more repo data than the quick UI needs. Acceptable approaches:

- Add a non-paginated repo fetch for quick mode with `per_page` based on
  `scanLimit`, or
- Add an option to `getRepos` that skips `--paginate` for quick mode.

Keep full mode's all-repo behavior unchanged.

**Verify**: Tests or transport assertions confirm quick mode does not pass
`--paginate`/`--slurp`, while full mode still does.

### Step 4: Abort cancelled client fetches

Replace the mount-effect `cancelled`-only pattern with `AbortController`.
Pass the signal to quick and full `fetch` calls. Cleanup should abort in-flight
fetches and still avoid setting state after unmount.

Do not convert user-visible API failures into silent aborts; ignore only
`AbortError` caused by cleanup.

**Verify**: Component or hook tests confirm abort cleanup does not set error.

### Step 5: Update docs for scoped quick/full data

If quick mode no longer includes billing and only fetches the first repo page,
document that quick data is a first-paint placeholder and full data follows.

**Verify**: `rg -n "quick|billing|scanLimit|cache" README.md server src/App.tsx`
shows no stale quick-mode claims.

## Test plan

- Server tests for in-flight coalescing.
- Server tests for force behavior.
- Server tests for quick billing placeholder and bounded repo fetch.
- Client test for abort cleanup if practical after Plan 001.
- Final verification: lint, typecheck, tests, build.

## Done criteria

- [ ] Simultaneous identical dashboard loads share one in-flight promise.
- [ ] Forced refresh bypasses completed cache but coalesces simultaneous forced
  requests.
- [ ] Quick mode does not call billing when no full cache is available.
- [ ] Quick mode avoids full repo pagination.
- [ ] Aborted mount-effect fetches do not set dashboard errors.
- [ ] All verification commands pass.

## STOP conditions

Stop and report back if:

- Tests cannot mock the GitHub transport without a larger service split.
- Quick mode cannot be bounded without changing `DashboardPayload`.
- Coalescing causes forced refresh to return stale completed cache.
- Abort handling hides real non-abort dashboard failures.

## Maintenance notes

This plan intentionally does not solve the larger per-repo GitHub fanout. Once
this lands, a later plan can evaluate GraphQL batching or per-repo TTL caching
with a safer test harness.
