# Plan 012: Align attention-strip actions with their counts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in "STOP conditions" occurs, stop and report. When done,
> update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3289de0..HEAD -- src/App.tsx src/App.test.tsx src/components/dashboard/AttentionStrip.tsx src/components/dashboard/*.test.tsx`
> and `git diff --stat -- src/App.tsx src/App.test.tsx src/components/dashboard/AttentionStrip.tsx src/components/dashboard/*.test.tsx`.
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-establish-verification-baseline.md`
- **Category**: UX
- **Planned at**: commit `3289de0`, 2026-06-11

## Why this matters

The attention strip shows global counts for non-hidden repos. Clicking a count
should put the repo table into a state where the counted repos are visible or
at least not hidden by an unrelated current scope/filter. Today the failing-CI
action resets repo scope to `all`, but PR and issue actions only sort. From the
default active scope, a user can click an open PR count that includes inactive
repos and still not see the repos responsible for the count.

## Current state

- `AttentionStrip` receives `repos={visibleRepos}` from `App`, where
  `visibleRepos` excludes hidden repos but does not apply repo scope, search,
  visibility, language, or CI filters.
- PR and issue counts are summed over those visible repos.
- `handleShowFailing` sets `repoScope` to `"all"` and `ciState` to `"failure"`.
- `handleShowPullRequests` and `handleShowIssues` only change sort and page.

Relevant excerpts:

```tsx
// src/components/dashboard/AttentionStrip.tsx:40
const openPrs = repos.reduce((sum, repo) => sum + (repo.openPullRequests ?? 0), 0)
const prRepoCount = repos.filter((repo) => (repo.openPullRequests ?? 0) > 0).length
const openIssues = repos.reduce((sum, repo) => sum + (repo.openIssues ?? 0), 0)
const issueRepoCount = repos.filter((repo) => (repo.openIssues ?? 0) > 0).length
```

```tsx
// src/App.tsx:274
const visibleRepos = useMemo(() => {
  if (!data) return []
  return data.repos.filter((repo) => !hiddenRepoIds.has(repo.id))
}, [data, hiddenRepoIds])
```

```tsx
// src/App.tsx:394
const handleShowFailing = useCallback(() => {
  setCiState("failure")
  setRepoScope("all")
  setPageIndex(0)
}, [])

const handleShowPullRequests = useCallback(() => {
  setSort({ key: "openPullRequests", direction: "desc" })
  setPageIndex(0)
}, [])
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npm run test -- src/App.test.tsx` | exit 0 |
| Full tests | `npm run test` | exit 0 |
| Final check | `npm run check` | exit 0 |

## Scope

**In scope**:

- `src/App.tsx`
- `src/App.test.tsx`
- `src/components/dashboard/AttentionStrip.tsx` only if action semantics are
  easier to test or express there

**Out of scope**:

- Redesigning the attention strip.
- Adding new filters or changing repo visibility persistence.
- Changing hidden-repo behavior. Hidden repos should stay hidden because the
  attention counts already exclude them.
- Reworking table sorting or pagination beyond the action handlers.

## Git workflow

- Branch: `c1/012-align-attention-actions`
- Commit message: `Align attention strip actions with counts`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Choose one count/action contract and apply it consistently

Use this contract unless product direction has changed:

- Attention counts represent all non-hidden repos.
- Clicking an attention card should show all non-hidden repos relevant to that
  card, regardless of the previous repo scope.
- Existing search/language/visibility filters should not hide the counted repos
  after the click, because those filters were not part of the count.

Implement a small helper in `App` for attention-card actions, for example:

```tsx
const showAttentionScope = useCallback(() => {
  setQuery("")
  setVisibility("all")
  setLanguage("all")
  setCiState("all")
  setRepoScope("all")
  setPageIndex(0)
}, [])
```

Then:

- Failing workflows: call the helper, then set `ciState("failure")`.
- Open PRs: call the helper, then sort by `openPullRequests` descending.
- Open issues: call the helper, then sort by `openIssues` descending.

If preserving search filters is a deliberate product choice, stop and ask
before implementing a different contract.

**Verify**: `npm run typecheck` exits 0.

### Step 2: Add regression tests through the App

Extend `src/App.test.tsx` with a dashboard payload containing:

- One active repo with zero PRs/issues.
- One inactive non-hidden repo with open PRs/issues.
- Optional hidden repo with PRs/issues to prove hidden repos stay out of the
  count/action target if existing test helpers make that cheap.

Test:

- Initial table default scope does not show the inactive repo.
- The attention strip shows an open PR or issue count that includes the inactive
  repo.
- Clicking the PR card resets scope/filters and reveals the inactive repo sorted
  near the top.
- Repeat for issues, or structure the test helper so both handlers are covered.

Use Testing Library user events. Avoid asserting on brittle class names.

**Verify**: `npm run test -- src/App.test.tsx` exits 0.

### Step 3: Check existing UI actions still work

Confirm the failing workflow action still sets the CI filter to failure and
resets to all non-hidden repos. If there is no existing test for that behavior,
add one only if it is straightforward with the same App test payload.

**Verify**: `npm run test -- src/App.test.tsx` exits 0.

## Test plan

- App-level regression tests should drive real click handlers rather than unit
  testing implementation details.
- Keep fetch mocked; no live GitHub calls.
- Full verification after targeted tests: `npm run lint`, `npm run typecheck`,
  `npm run test`, and `npm run check`.

## Done criteria

- [ ] PR and issue attention-card clicks reset repo scope to all non-hidden repos.
- [ ] PR and issue actions clear unrelated filters that were not part of their
  displayed counts.
- [ ] Failing workflow action still filters to failures.
- [ ] Hidden repos stay hidden.
- [ ] App regression tests cover the mismatch.
- [ ] `npm run lint` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run test` exits 0.
- [ ] `npm run check` exits 0.
- [ ] `plans/README.md` status row for Plan 012 is updated.

## STOP conditions

Stop and report back if:

- Product direction is that attention counts should instead respect current
  repo scope and filters.
- The App test cannot exercise the interaction without a broad component
  extraction.
- Fixing the action semantics requires changing hidden-repo persistence.

## Maintenance notes

If future cards are added to `AttentionStrip`, define whether their counts are
global or filter-aware before wiring click actions. Reviewers should compare the
count source and click target in the same PR.
