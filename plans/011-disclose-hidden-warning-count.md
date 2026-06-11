# Plan 011: Disclose hidden partial-data warnings

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in "STOP conditions" occurs, stop and report. When done,
> update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3289de0..HEAD -- src/components/dashboard/OperationalRail.tsx src/components/dashboard/*.test.tsx src/types/github.ts`
> and `git diff --stat -- src/components/dashboard/OperationalRail.tsx src/components/dashboard/*.test.tsx src/types/github.ts`.
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-establish-verification-baseline.md`
- **Category**: UX, correctness
- **Planned at**: commit `3289de0`, 2026-06-11

## Why this matters

Warnings are how the dashboard tells users that data is partial. The rail
currently renders only the first three visible warnings and gives no indication
that more exist. That can hide billing, repo, CI, or auth warnings behind the
first three messages, making incomplete data look complete.

## Current state

- `WarningPanel` filters dismissed warnings.
- It renders `visible.slice(0, 3)`.
- There is no count, expander, or "more warnings" indicator.
- Dismissing one of the first three can reveal a later warning because the slice
  is recalculated, but users are not told those later warnings exist.

Relevant excerpt:

```tsx
// src/components/dashboard/OperationalRail.tsx:55
function WarningPanel({ warnings }: { warnings: DashboardWarning[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const visible = warnings.filter((warning) => !dismissed.has(warningKey(warning)))

  if (visible.length === 0) return null

  return (
    <Alert>
      <AlertTriangleIcon aria-hidden="true" />
      <AlertTitle>Partial data</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-2">
          {visible.slice(0, 3).map((warning) => (
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npm run test -- src/components/dashboard/OperationalRail.test.tsx` | exit 0 |
| Full tests | `npm run test` | exit 0 |
| Final check | `npm run check` | exit 0 |

## Scope

**In scope**:

- `src/components/dashboard/OperationalRail.tsx`
- New or existing `src/components/dashboard/OperationalRail.test.tsx`

**Out of scope**:

- Redesigning the operational rail.
- Changing the `DashboardWarning` response shape.
- Changing warning generation in server code.
- Persisting dismissed warnings across reloads.

## Git workflow

- Branch: `c1/011-disclose-warning-count`
- Commit message: `Disclose hidden partial-data warnings`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add a visible disclosure for overflow warnings

Update `WarningPanel` so `visible.length > 3` is explicit. Two acceptable
patterns:

- Render a compact line after the first three warnings, for example
  `2 more warnings not shown`.
- Or add a small button that expands the panel to show all visible warnings.

Prefer the expander if it can be done without layout churn:

```tsx
const [expanded, setExpanded] = useState(false)
const displayed = expanded ? visible : visible.slice(0, 3)
const hiddenCount = Math.max(0, visible.length - displayed.length)
```

Use existing `Button` variants and compact text styles. Keep the panel dense.

**Verify**: `npm run typecheck` exits 0.

### Step 2: Preserve dismissal behavior

Ensure dismissing a warning still:

- Removes that warning from `visible`.
- Recomputes hidden count.
- Hides the whole panel when all warnings are dismissed.
- Does not reset the expanded state in a surprising way.

Do not change the `warningKey` function unless tests expose a real collision.

**Verify**: `npm run test -- src/components/dashboard/OperationalRail.test.tsx` exits 0 after adding tests in Step 3.

### Step 3: Add focused component tests

Create `src/components/dashboard/OperationalRail.test.tsx` if it does not
exist. It can render `OperationalRail` with minimal billing and run props, or
export/test `WarningPanel` if that is cleaner and does not create an awkward
public API.

Cover:

- Three warnings render with no overflow disclosure.
- Five warnings render the first three plus an overflow disclosure.
- If using an expander, clicking it reveals all five warnings.
- Dismissing a visible warning updates the rendered warning list and overflow
  count.

Use existing component test style from
`src/components/dashboard/RepoTable.test.tsx` and
`src/components/dashboard/StatusBadge.test.tsx`.

**Verify**: `npm run test -- src/components/dashboard/OperationalRail.test.tsx`
exits 0.

## Test plan

- Component tests should use Testing Library queries by visible text or role.
- No snapshots.
- Full verification after targeted tests: `npm run lint`, `npm run typecheck`,
  `npm run test`, and `npm run check`.

## Done criteria

- [ ] Users can tell when more than three partial-data warnings exist.
- [ ] Overflow warnings can be inspected or are at least counted visibly.
- [ ] Dismissing warnings keeps counts and panel visibility correct.
- [ ] `npm run lint` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run test` exits 0.
- [ ] `npm run check` exits 0.
- [ ] `plans/README.md` status row for Plan 011 is updated.

## STOP conditions

Stop and report back if:

- Showing all warnings requires changing the server warning shape.
- Component tests require broad test setup changes outside the in-scope files.
- The rail layout becomes unstable at desktop or mobile widths.

## Maintenance notes

Future warning-producing code should assume warnings may be numerous. Reviewers
should verify the rail remains compact and that the overflow affordance is not
styled like a primary workflow action.
