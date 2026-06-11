# Plan 001: Establish an artifact-free verification and test baseline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in "STOP conditions" occurs, stop and report. When done,
> update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 7510159..HEAD -- package.json package-lock.json README.md tsconfig.json tsconfig.app.json tsconfig.node.json src server`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests, dx
- **Planned at**: commit `7510159`, 2026-06-10

## Why this matters

The repo has lint and production build checks, but no `test` script and no
artifact-free package script for TypeScript. That makes future security,
cache, and performance changes harder to delegate safely: an executor can prove
syntax, but not behavior, without writing `dist`. This plan establishes a
repeatable baseline that later plans can depend on.

## Current state

- `package.json` owns scripts and dependencies. It has `lint`, `build`, and
  `check`, but no `test` or `typecheck`.
- `README.md` documents `npm run check` as the only verification command.
- `tsconfig.app.json` and `tsconfig.node.json` already use `noEmit`, so a
  package-level typecheck script can be artifact-free.
- The repo uses npm and has `package-lock.json`; keep that package manager.

Relevant excerpts:

```json
// package.json:6
"scripts": {
  "dev": "vite --host 127.0.0.1",
  "build": "tsc -b && vite build",
  "check": "npm run lint && npm run build",
  "clean": "rm -rf dist",
  "lint": "eslint .",
  "preview": "vite preview --host 127.0.0.1"
}
```

````md
<!-- README.md:40 -->
## Verify

```sh
npm run check
```

This runs lint first, then a production build.
````

Repo conventions to match:

- TypeScript modules use double quotes and no semicolons.
- Source imports use the `@/` alias inside `src`.
- Existing scripts use plain npm script names, not task runners.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install from lockfile | `npm ci` | exit 0, no lockfile rewrite |
| Existing lint | `npm run lint` | exit 0 |
| Existing app typecheck | `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit --pretty false` | exit 0 |
| Existing node typecheck | `./node_modules/.bin/tsc -p tsconfig.node.json --noEmit --pretty false` | exit 0 |
| Final check | `npm run check` | exit 0 |

## Scope

**In scope**:

- `package.json`
- `package-lock.json`
- `README.md`
- `tsconfig*.json` only if needed for the new test config
- New test setup/config files, for example `vitest.config.ts` or
  `src/test/setup.ts`
- Initial low-risk tests under `src` or `server`

**Out of scope**:

- Behavior changes to the dashboard.
- Refactors of `App.tsx`, `server/github-dashboard.ts`, or UI components beyond
  testability that is strictly required for the initial tests.
- Hosted CI or GitHub Actions workflow changes.

## Git workflow

- Branch: `c1/001-verification-baseline`
- Commit message style: imperative, matching the existing history. Example:
  `Add dashboard verification baseline`
- Do not push or open a PR unless the operator explicitly requests it.

## Steps

### Step 1: Add artifact-free scripts

Add these scripts to `package.json`:

- `typecheck`: app and node TypeScript checks without emitting artifacts.
- `test`: Vitest in non-watch mode.
- Update `check` so it runs lint, typecheck, tests, then build.

One acceptable script shape:

```json
"typecheck": "tsc -p tsconfig.app.json --noEmit --pretty false && tsc -p tsconfig.node.json --noEmit --pretty false",
"test": "vitest run",
"check": "npm run lint && npm run typecheck && npm run test && npm run build"
```

**Verify**: `npm run typecheck` should exit 0 after dependencies are available.

### Step 2: Install the test runner and DOM test tools

Use npm so `package-lock.json` stays authoritative. Add a compact Vitest stack:

```sh
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Add `vitest.config.ts` only if needed. Prefer sharing Vite's React transform and
the existing `@` path alias rather than duplicating config by hand.

**Verify**: after Step 3, `npm run test` should run in non-watch mode and
report the committed tests.

### Step 3: Add initial behavior tests that do not require live GitHub

Start with tests that prove the runner works without touching private GitHub
data:

- `src/lib/format.test.ts`: cover `formatDuration`, `formatBillingQuantity`,
  `shortRepoName`, and one stable formatting edge where output is deterministic.
- `src/components/dashboard/StatusBadge.test.tsx`: render success, failure,
  running, warning, and unknown states. Keep this lightweight; do not solve the
  missing `error` classification in this plan unless it is necessary for the
  test harness.
- Optional: a minimal `App` fetch smoke test with a mocked `/api/dashboard`
  response if it can be done without extracting hooks.

Do not add tests that need `gh auth`, live network, or Vite dev server.

**Verify**: `npm run test` exits 0 and reports the new test files.

### Step 4: Document the new verification path

Update `README.md` so contributors know:

- `npm run typecheck` is the artifact-free TypeScript gate.
- `npm run test` runs the automated tests.
- `npm run check` still includes the production build and writes `dist`.

**Verify**: `rg -n "typecheck|test|check" README.md package.json` shows the new
commands consistently.

## Test plan

- New Vitest tests must run without GitHub credentials.
- At least one React component test should exercise the jsdom setup.
- At least one pure helper test should exercise non-React TypeScript.
- Final verification: `npm run lint`, `npm run typecheck`, `npm run test`, and
  `npm run build` all exit 0.

## Done criteria

- [ ] `package.json` has `typecheck` and `test` scripts.
- [ ] `package-lock.json` records the new test dependencies.
- [ ] `npm run lint` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run test` exits 0 and runs at least two committed test files.
- [ ] `npm run build` exits 0.
- [ ] README explains artifact-free verification versus production build.
- [ ] `git status --short` shows only in-scope files plus `plans/README.md`.

## STOP conditions

Stop and report back if:

- The package manager is no longer npm or `package-lock.json` is absent.
- The required test dependencies cannot be installed from the registry.
- Adding the test runner requires changing production source behavior.
- `npm run build` fails for reasons unrelated to the new test setup.

## Maintenance notes

Future executor plans should depend on this one when they need regression
coverage. Reviewers should confirm that tests are meaningful behavior tests,
not snapshots or render-only assertions that would pass through broken logic.
