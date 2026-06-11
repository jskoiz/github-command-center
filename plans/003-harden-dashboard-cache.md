# Plan 003: Harden dashboard cache validation and storage behavior

> **Executor instructions**: Follow this plan exactly. Run every verification
> command. If a STOP condition occurs, stop and report. When complete, update
> this plan's row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 7510159..HEAD -- src/App.tsx src/components/dashboard/RepoTable.tsx src/types/github.ts README.md package.json package-lock.json src`
> If any in-scope file changed since planning, compare the excerpts below to the
> live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-establish-verification-baseline.md`
- **Category**: bug, security
- **Planned at**: commit `7510159`, 2026-06-10

## Why this matters

The app persists a full private dashboard payload in `localStorage`, then
accepts cached JSON after only shallow checks. That creates two problems:
private GitHub activity and billing data persists in the browser profile, and
malformed or old cache entries can crash render paths before the app refreshes.
Storage write failures can also turn a successful fetch into a visible
dashboard error.

## Current state

- `App` hydrates initial data directly from browser storage.
- Cache validation only checks that `payload` exists, `cachedAt` is numeric, and
  `payload.detailLevel` is `full`.
- Full dashboard payloads are written to `localStorage`.
- Repo table column preferences also write to `localStorage` without catching
  storage exceptions.
- README documents full payload storage in `localStorage`.

Relevant excerpts:

```ts
// src/App.tsx:42
const [initialDashboardCache] = useState<DashboardCacheEntry | null>(() => readDashboardCache())
const [data, setData] = useState<DashboardPayload | null>(() => initialDashboardCache?.payload ?? null)
```

```ts
// src/App.tsx:530
const parsed = JSON.parse(raw) as Partial<DashboardCacheEntry>
if (!parsed.payload || typeof parsed.cachedAt !== "number") return null
if (parsed.payload.detailLevel !== "full") return null
```

```ts
// src/App.tsx:543
function writeDashboardCache(payload: DashboardPayload) {
  if (typeof window === "undefined" || payload.detailLevel !== "full") return

  window.localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
    cachedAt: Date.now(),
    payload,
  }))
}
```

```ts
// src/components/dashboard/RepoTable.tsx:191
useEffect(() => {
  const payload = {
    order: orderedColumns,
    visible: [...visibleColumns],
  }
  window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(payload))
}, [orderedColumns, visibleColumns])
```

```md
<!-- README.md:62 -->
- The browser stores the latest full dashboard payload in `localStorage`.
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

- `src/App.tsx`
- `src/components/dashboard/RepoTable.tsx`
- A new cache helper module, for example `src/lib/dashboard-cache.ts`
- New tests for cache validation and storage failures
- README cache wording

**Out of scope**:

- Server cache behavior.
- Changing dashboard API response fields.
- Adding encryption, IndexedDB, or cross-device persistence.
- Adding compatibility readers for multiple old cache shapes. Remove or ignore
  obsolete cache entries instead.

## Git workflow

- Branch: `c1/003-dashboard-cache-hardening`
- Commit message: `Harden dashboard browser cache`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Move dashboard payload cache to session-scoped storage

Use `sessionStorage` for the dashboard payload so private repo/activity/billing
data does not persist beyond the browser session. Keep column preferences in
`localStorage`, since those are non-sensitive UI preferences.

Use a new cache key version. Do not support both old and new payload cache
shapes. If an old `localStorage` dashboard cache key exists, remove it once
best-effort during startup.

**Verify**: Add a test that writes an old localStorage dashboard cache and
confirms the reader ignores/removes it. Run `npm run test`.

### Step 2: Add a runtime shape guard for cached payloads

Create a narrow `isDashboardPayload` or `parseDashboardCacheEntry` helper.
Validate at least:

- `cachedAt` is a finite number.
- `payload.detailLevel === "full"`.
- `payload.scanLimit` is a finite number.
- `viewer.login`, `viewer.avatarUrl`, and `viewer.profileUrl` are strings.
- `repos`, `recentCommits`, `pullRequests`, `issues`, `ciRuns`, and `warnings`
  are arrays.
- `billing` is an object with `available`, `year`, `month`, and numeric amount
  fields.

On invalid cache, remove the cache entry and return `null`.

**Verify**: Tests cover valid cache, malformed JSON, missing arrays, wrong
`detailLevel`, and invalid billing shape.

### Step 3: Make storage writes best-effort

Wrap dashboard cache writes and repo column preference writes in narrow
`try/catch` blocks. A storage exception should not call `setError` for a
successful dashboard fetch and should not crash `RepoTable`.

Do not silently swallow API fetch failures; only storage persistence failures
become best-effort.

**Verify**: Add tests or component tests that simulate `setItem` throwing and
confirm the dashboard data still renders or the helper returns without throwing.

### Step 4: Update README cache semantics

Replace the `localStorage` payload statement with the new behavior:

- Full dashboard payload is session-scoped.
- UI preferences may persist in localStorage.
- A reload within the same browser session can still render cached data
  immediately.

**Verify**: `rg -n "localStorage|sessionStorage|cache" README.md src` shows no
stale claim that full dashboard payloads persist in `localStorage`.

## Test plan

- Unit tests for cache parser success and failure cases.
- Unit tests for best-effort storage writes.
- Component-level smoke test if the test baseline makes it cheap: cached full
  payload renders without fetching; invalid cache falls through to fetch.
- Final verification: `npm run lint`, `npm run typecheck`, `npm run test`, and
  `npm run build`.

## Done criteria

- [ ] Full dashboard payloads are not written to `localStorage`.
- [ ] Invalid cached payloads are rejected before render.
- [ ] Old dashboard `localStorage` cache entries are ignored or removed.
- [ ] Storage write failures do not surface as dashboard API failures.
- [ ] README accurately describes session-scoped payload caching.
- [ ] All verification commands pass.

## STOP conditions

Stop and report back if:

- Product requirements demand cross-browser-session dashboard payload caching.
- Cache validation requires a full schema library not already planned.
- Fixing storage failures requires broad rewrites of `App`.
- Tests cannot mock storage reliably after Plan 001.

## Maintenance notes

Future cached fields must be added to the runtime guard. Reviewers should check
that sensitive dashboard data remains out of persistent browser storage and that
cache invalidation removes obsolete shapes rather than supporting them forever.
