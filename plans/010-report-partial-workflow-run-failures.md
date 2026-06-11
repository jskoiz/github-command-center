# Plan 010: Report partial workflow-run failures

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in "STOP conditions" occurs, stop and report. When done,
> update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3289de0..HEAD -- server/github-dashboard.ts server/github-dashboard.test.ts src/types/github.ts src/components/dashboard`
> and `git diff --stat -- server/github-dashboard.ts server/github-dashboard.test.ts src/types/github.ts src/components/dashboard`.
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-establish-verification-baseline.md`
- **Category**: correctness
- **Planned at**: commit `3289de0`, 2026-06-11

## Why this matters

The dashboard scans workflow runs for the most recently pushed repositories and
uses those results to show CI health. If one repo fails due to permission,
missing Actions access, rate limits, or a transient GitHub error, that repo is
currently treated the same as "no workflow runs." Partial failures should keep
successful data, but they must also produce a warning so the operator knows CI
coverage is incomplete.

## Current state

- `getWorkflowRuns` fetches runs for each scanned repo with `mapLimit`.
- Per-repo errors are caught and converted to an empty array.
- A warning is added only when every scanned repo produces zero runs.
- Dashboard warnings already flow to `OperationalRail`.

Relevant excerpt:

```ts
// server/github-dashboard.ts:609
const results = await mapLimit(repos, 5, async (repo) => {
  try {
    const raw = await ghJson<{ workflow_runs?: RawWorkflowRun[] }>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/actions/runs?per_page=3`
    )
    return (raw.workflow_runs ?? []).map((run) => toWorkflowRunSummary(repo.fullName, run))
  } catch {
    return []
  }
})
```

```ts
// server/github-dashboard.ts:620
const runs = results.flat()
if (runs.length === 0 && repos.length > 0) {
  warnings.push({
    area: "ci",
    message: "No workflow runs were returned from scanned repositories.",
  })
}
```

Existing test helper pattern:

```ts
// server/github-dashboard.test.ts:74
if (endpoint.endsWith("/actions/runs?per_page=3")) {
  return JSON.stringify({ workflow_runs: [] })
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npm run test -- server/github-dashboard.test.ts` | exit 0 |
| Full tests | `npm run test` | exit 0 |
| Final check | `npm run check` | exit 0 |

## Scope

**In scope**:

- `server/github-dashboard.ts`
- `server/github-dashboard.test.ts`
- `src/types/github.ts` only if warning metadata needs a typed extension
- Existing warning UI only if the current warning string cannot be displayed

**Out of scope**:

- Fetching workflow jobs, logs, or annotations.
- Changing `scanLimit`.
- Retrying GitHub API calls.
- Treating missing workflow runs as failures.

## Git workflow

- Branch: `c1/010-report-workflow-run-failures`
- Commit message: `Report partial workflow run failures`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Preserve per-repo workflow errors

Change `getWorkflowRuns` so the mapper returns a structured result rather than
only an array. Suggested shape:

```ts
type WorkflowRunFetchResult = {
  repo: string
  runs: WorkflowRunSummary[]
  error?: unknown
}
```

On success, return the runs. On failure, keep the repo name and error. Do not
throw from a single repo failure, because other repo run data should still be
returned.

**Verify**: `npm run typecheck` exits 0.

### Step 2: Add an aggregated CI warning for partial failures

After all repo fetches complete:

- Flatten successful runs as before.
- If one or more repos failed, push one `ci` warning.
- Include the failure count and up to three repo names in the message.
- Include a generic `fix` only if it is already consistent with existing
  warning conventions. Do not include raw API error bodies or tokens.
- Preserve the existing "No workflow runs were returned..." warning when no
  repos returned runs. If there were also failures, the partial-failure warning
  should make clear that zero runs may be due to fetch errors.

Example message:

```ts
{
  area: "ci",
  message: "Workflow runs could not be loaded for 2 of 8 scanned repositories: owner/a, owner/b.",
}
```

**Verify**: `npm run test -- server/github-dashboard.test.ts` covers partial
failure with at least one successful repo.

### Step 3: Add dashboard tests for full and zero-run failures

Extend `createGithubExecutor` in `server/github-dashboard.test.ts` so individual
repo workflow endpoints can throw.

Add tests for:

- One repo succeeds with a run, one repo fails: payload keeps the successful run
  and includes the partial warning.
- All scanned repos fail: payload has no runs and includes a CI warning that is
  not indistinguishable from "all repos had no runs."
- Error text is summarized without including a fake token string from the thrown
  error.

**Verify**: `npm run test -- server/github-dashboard.test.ts` exits 0.

## Test plan

- Use the existing `configureGithubDashboardForTests` executor seam.
- Keep tests local and deterministic; no live GitHub calls.
- Run the full suite after the targeted test passes.

## Done criteria

- [ ] Per-repo workflow errors no longer disappear silently.
- [ ] Successful workflow runs are preserved when sibling repos fail.
- [ ] Partial failures produce one aggregated CI warning.
- [ ] Warning text does not include tokens, headers, or raw private API bodies.
- [ ] `npm run lint` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run test` exits 0.
- [ ] `npm run check` exits 0.
- [ ] `plans/README.md` status row for Plan 010 is updated.

## STOP conditions

Stop and report back if:

- The warning needs a richer response shape that would affect multiple UI
  surfaces.
- A single per-repo workflow failure starts failing the whole dashboard request.
- The test harness would require real GitHub Actions data.

## Maintenance notes

Future diagnostic workflow work can fetch failed jobs or annotations, but this
plan deliberately only fixes the missing partial-data warning. Reviewers should
check that warning aggregation does not spam the rail for large accounts.
