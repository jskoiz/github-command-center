# Plan 008: Throttle hosted dashboard fanout

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in "STOP conditions" occurs, stop and report. When done,
> update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3289de0..HEAD -- server/main.ts server/hosted-server.ts server/github-dashboard.ts server/*.test.ts README.md .env.example`
> and `git diff --stat -- server/main.ts server/hosted-server.ts server/github-dashboard.ts server/*.test.ts README.md .env.example`.
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/006-cover-hosted-auth-boundaries.md`
- **Category**: security, perf
- **Planned at**: commit `3289de0`, 2026-06-11

## Why this matters

A hosted dashboard request can fan out into repo pagination, GraphQL counts,
per-repo details, workflow runs, search results, and billing. Caches and
in-flight coalescing reduce normal duplicate work, but they do not prevent a
signed-in user or scripted client from repeatedly forcing expensive loads.
Hosted mode needs a small rate limiter that protects GitHub API quota and keeps
abuse from turning into noisy operator failures.

## Current state

- `GET /api/dashboard` accepts `quick`, `refresh`, and `scanLimit` query params
  after session validation.
- Full dashboard loads call multiple GitHub API paths in parallel.
- `getGithubDashboard` already has in-memory caches and in-flight coalescing,
  but `refresh=1` bypasses cache freshness.
- There is no rate limiter around `/auth/login`, `/auth/callback`, or
  `/api/dashboard`.

Relevant excerpts:

```ts
// server/main.ts:159
const payload = await getGithubDashboard({
  force: url.searchParams.get("refresh") === "1",
  quick: url.searchParams.get("quick") === "1",
  scanLimit: Number(url.searchParams.get("scanLimit") ?? 24),
  auth: { token: session.token, userKey: session.login },
})
```

```ts
// server/github-dashboard.ts:296
const [repoDetails, runs, pullRequests, issues, billing] = await Promise.all([
  getPerRepoLatestDetails(enrichedRepos, warnings, now),
  getWorkflowRuns(scanRepos, warnings),
  getSearchItems(`is:pr involves:${viewer.login} archived:false`, true, warnings),
  getSearchItems(`is:issue involves:${viewer.login} archived:false`, false, warnings),
  getBilling(viewer.login, warnings),
])
```

```ts
// server/github-dashboard.ts:225
const inFlightKey = `${currentCacheKey()}:${quick ? "quick" : "full"}:${scanLimit}:${force ? "force" : "normal"}`
const existing = inFlightDashboards.get(inFlightKey)
if (existing) return existing
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npm run test -- server/rate-limit.test.ts server/hosted-server.test.ts` | exit 0 |
| Full tests | `npm run test` | exit 0 |
| Final check | `npm run check` | exit 0 |

## Scope

**In scope**:

- New `server/rate-limit.ts`
- `server/main.ts` or `server/hosted-server.ts` if Plan 006 extracted it
- Hosted route tests
- `README.md` or `.env.example` only for concise configuration notes

**Out of scope**:

- Distributed Redis/database rate limiting.
- CAPTCHA, account allowlists, or admin UI.
- Changing dashboard cache semantics.
- Changing GitHub OAuth scopes.
- GitHub Actions workflow changes.

## Git workflow

- Branch: `c1/008-throttle-hosted-dashboard-fanout`
- Commit message: `Throttle hosted dashboard fanout`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add a small in-memory rate limiter

Create `server/rate-limit.ts` with a deterministic, testable limiter.

Target behavior:

- Fixed-window or sliding-window implementation is acceptable, but it must be
  easy to test with an injected clock.
- Return `{ allowed: true }` or `{ allowed: false, retryAfterSeconds }`.
- Key buckets by a caller-provided string.
- Prune expired buckets during reads/writes.
- Do not store tokens, cookie values, or raw request headers.

Suggested default limits:

- `auth:${remoteAddress}`: 20 requests per 10 minutes for `/auth/login` and
  `/auth/callback`.
- `quick:${session.login}`: 30 quick dashboard requests per minute.
- `full:${session.login}`: 6 full dashboard requests per minute.
- `refresh:${session.login}`: 3 forced full refreshes per minute.

These values are intentionally conservative and process-local. Make them
constants first; add env configuration only if the current deployment needs it.

**Verify**: `npm run test -- server/rate-limit.test.ts` exits 0 with tests for
allowed, blocked, retry-after, and window reset behavior.

### Step 2: Apply auth endpoint throttles

In the hosted request handler, rate-limit `/auth/login` and `/auth/callback`
before doing OAuth work. Use the remote socket address as the key; if no remote
address is present, use a stable `"unknown"` bucket rather than failing open.

On limit:

- Return status 429.
- Set `Retry-After`.
- Return JSON `{ "message": "Too many requests. Try again later." }`.
- Do not redirect to GitHub and do not include request internals.

**Verify**: `npm run test -- server/hosted-server.test.ts` covers auth throttle
allowed and blocked cases.

### Step 3: Apply dashboard throttles after session validation

For `/api/dashboard`, validate the session first, then rate-limit by
`session.login` and request kind:

- `quick=1` uses the quick bucket.
- `refresh=1` uses the refresh bucket.
- Other full loads use the full bucket.

Apply the limiter before calling `getGithubDashboard`. On limit, return 429
with `x-gcc-auth: oauth`, `Retry-After`, and the same generic JSON message.

Do not count unauthenticated dashboard 401s against a user bucket because there
is no trusted user key yet.

**Verify**: `npm run test -- server/hosted-server.test.ts` proves blocked
dashboard requests do not call the dashboard loader.

### Step 4: Add a concise hosted-mode note

Update hosted docs to say the standalone server includes process-local request
throttles for OAuth and dashboard fanout. Keep it short and do not document
every constant unless configuration is added.

**Verify**: `rg -n "rate|throttle|Too many requests|Retry-After" server README.md` shows code and docs coverage.

## Test plan

- `server/rate-limit.test.ts` covers limiter math with an injected clock.
- Hosted route tests cover 429 status, `Retry-After`, generic message, and no
  downstream dependency call when blocked.
- Existing dashboard coalescing tests should remain unchanged and passing.
- Final verification: `npm run lint`, `npm run typecheck`, `npm run test`, and
  `npm run check` all exit 0.

## Done criteria

- [ ] Auth endpoints are rate-limited by remote address.
- [ ] Dashboard requests are rate-limited by signed-in login and request kind.
- [ ] Blocked requests return 429 with `Retry-After`.
- [ ] Blocked dashboard requests do not call `getGithubDashboard`.
- [ ] The limiter stores no secrets.
- [ ] `npm run lint` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run test` exits 0.
- [ ] `npm run check` exits 0.
- [ ] `plans/README.md` status row for Plan 008 is updated.

## STOP conditions

Stop and report back if:

- The hosted server is already deployed behind a required external rate limiter
  with different semantics that must be integrated instead.
- Correct throttling requires a shared multi-process store.
- The route handler extraction from Plan 006 did not land and testing would
  require live server state.
- Any rate-limit response would expose token, cookie, or internal request data.

## Maintenance notes

This is protection for a single Node process. If deployment becomes multi-node
or serverless, move the limiter state to shared storage. Reviewers should check
that legitimate initial quick + full background loads still work without
tripping limits.
