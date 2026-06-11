# Plan 004: Normalize CI status classification across the dashboard

> **Executor instructions**: Follow this plan step by step. Run every
> verification command. If a STOP condition occurs, stop and report. When done,
> update `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 7510159..HEAD -- src/App.tsx src/components/dashboard/OperationalRail.tsx src/components/dashboard/StatusBadge.tsx src/lib src/types/github.ts package.json package-lock.json`
> Compare the excerpts below with live code before editing.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-establish-verification-baseline.md`
- **Category**: bug, tech-debt
- **Planned at**: commit `7510159`, 2026-06-10

## Why this matters

GitHub status/conclusion values are classified in multiple places. The current
lists omit at least `error`, so a repo with an `ERROR` default-branch status
rollup can be treated as `none`, hidden from the failing CI filter, and shown
with a neutral badge. Centralizing classification fixes the visible bug and
prevents filter, badge, and summary drift.

## Current state

- `App.tsx` maps repo state for filtering and sorting.
- `OperationalRail.tsx` repeats failure conclusion lists for failure cards and
  CI summary.
- `StatusBadge.tsx` has separate label and tone mappings.

Relevant excerpts:

```ts
// src/App.tsx:455
function getRepoState(repo: RepoSummary): string {
  const value = (repo.latestRun?.conclusion ?? repo.latestRun?.status ?? repo.checkState)?.toLowerCase()
  if (!value) return "none"
  if (value === "success") return "success"
  if (["failure", "timed_out", "cancelled", "action_required"].includes(value)) return "failure"
  if (["queued", "requested", "waiting", "pending", "in_progress"].includes(value)) return "running"
  return "none"
}
```

```ts
// src/components/dashboard/OperationalRail.tsx:30
const failingRuns = runs.filter((run) =>
  ["failure", "timed_out", "cancelled", "action_required"].includes(run.conclusion ?? "")
)
```

```ts
// src/components/dashboard/StatusBadge.tsx:71
function getTone(state: string | null | undefined): StatusTone {
  const normalized = state?.toLowerCase()
  if (!normalized) return "neutral"
  if (normalized === "success") return "success"
  if (["failure", "timed_out", "cancelled", "action_required"].includes(normalized)) return "danger"
  if (["queued", "requested", "waiting", "pending"].includes(normalized)) return "warning"
  if (normalized === "in_progress") return "running"
  return "neutral"
}
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

- New `src/lib/github-status.ts`
- Tests for `src/lib/github-status.ts`
- `src/App.tsx`
- `src/components/dashboard/OperationalRail.tsx`
- `src/components/dashboard/StatusBadge.tsx`

**Out of scope**:

- Changing dashboard API response shape.
- Adding new CI data fetching.
- Reworking table sort architecture beyond using the shared helper.

## Git workflow

- Branch: `c1/004-ci-status-normalization`
- Commit message: `Normalize CI status classification`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Add the shared status helper

Create `src/lib/github-status.ts`. It should export functions such as:

- `normalizeGithubStatus(value: string | null | undefined): string | null`
- `getCiFilterState(value: string | null | undefined): "success" | "failure" | "running" | "none"`
- `isFailingCiState(value: string | null | undefined): boolean`
- `getStatusTone(value: string | null | undefined): "success" | "danger" | "warning" | "running" | "neutral"`
- `getStatusLabel(value: string | null | undefined, fallback?: string): string`

Preserve current behavior and add at least:

- `error` as failure/danger.
- `startup_failure` as failure/danger if workflow conclusions produce it.
- Existing `failure`, `timed_out`, `cancelled`, and `action_required` as
  failure/danger.
- Existing `queued`, `requested`, `waiting`, `pending`, and `in_progress` as
  non-success active states.

Do not claim every future GitHub enum is covered; unknown values should render
their normalized label with neutral tone unless explicitly classified.

**Verify**: `npm run typecheck` exits 0.

### Step 2: Replace duplicated lists

Use the shared helper in:

- `App.tsx` for repo filtering/sorting state.
- `OperationalRail.tsx` for failure filtering and summary counts.
- `StatusBadge.tsx` for labels and tones.

Remove the duplicated arrays from those files.

**Verify**: `rg -n "failure.*timed_out|action_required|function getTone|function getRepoState" src` should show the shared helper as the only owner of classification arrays/functions, except for tests.

### Step 3: Add classification tests

Test the helper directly. Include:

- `success` and `SUCCESS`.
- `failure`, `timed_out`, `cancelled`, `action_required`.
- `error` and `ERROR`.
- `startup_failure`.
- `queued`, `requested`, `waiting`, `pending`, `in_progress`.
- Unknown non-empty state.
- `null` and `undefined`.

If `StatusBadge` tests exist from Plan 001, update them to assert `error`
renders as danger/failing.

**Verify**: `npm run test` exits 0.

## Test plan

- Pure helper tests should cover every mapping above.
- Existing or new component tests should prove `StatusBadge` uses the helper.
- Manual check if desired: create a fixture repo object with `checkState:
  "ERROR"` and confirm it would filter as failing through the helper.

## Done criteria

- [ ] CI classification logic has one source of truth.
- [ ] `ERROR`/`error` classifies as failing/danger.
- [ ] Badge labels remain human-readable.
- [ ] Failing run counts use the same helper as filtering.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`
  all pass.

## STOP conditions

Stop and report back if:

- Existing tests or UI expectations intentionally treat `ERROR` as no CI.
- A broader repo-table model refactor becomes necessary.
- The helper cannot be imported without circular dependencies.

## Maintenance notes

When new GitHub status values are observed, add them to `src/lib/github-status.ts`
and its tests. Reviewers should reject future duplicated status arrays in UI
components.
