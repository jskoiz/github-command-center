# Plan 006: Cover hosted auth and API boundary behavior

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in "STOP conditions" occurs, stop and report. When done,
> update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3289de0..HEAD -- server/main.ts server/session.ts server/github-client.ts server/github-dashboard.ts package.json package-lock.json vitest.config.ts src/test`
> and `git diff --stat -- server/main.ts server/session.ts server/github-client.ts server/github-dashboard.ts package.json package-lock.json vitest.config.ts src/test`.
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-establish-verification-baseline.md`
- **Category**: tests, security
- **Planned at**: commit `3289de0`, 2026-06-11

## Why this matters

Hosted mode is now the highest-risk boundary in this app: it accepts OAuth
callbacks, stores encrypted GitHub tokens in cookies, serves the built app, and
returns private dashboard JSON. The current test suite covers the dashboard
pipeline and the local-access helper, but not the hosted route or token-executor
boundaries. This plan creates characterization tests first so later security
plans can change logout, rate limits, and pagination without guessing.

## Current state

- `server/main.ts` owns all hosted routes and starts listening at module load.
- `server/session.ts` seals and opens the encrypted cookie value.
- `server/github-client.ts` adapts the old `gh api` argument vectors to HTTPS
  requests with an OAuth token.
- Existing tests include `server/github-dashboard.test.ts` and
  `server/local-access.test.ts`, but there are no tests for `server/main.ts`,
  `server/session.ts`, or `server/github-client.ts`.
- Existing server tests use the node Vitest environment and direct dependency
  injection through helpers such as `configureGithubDashboardForTests`.

Relevant excerpts:

```ts
// server/main.ts:80
if (url.pathname === "/auth/login") return handleLogin(res)
if (url.pathname === "/auth/callback") return handleCallback(req, res, url)
if (url.pathname === "/auth/logout") return handleLogout(res)
if (url.pathname === "/api/dashboard") return handleDashboard(req, res, url)
```

```ts
// server/main.ts:126
res.statusCode = 302
res.setHeader("Set-Cookie", [
  serializeCookie(SESSION_COOKIE, sealSession(session, sessionKey), {
    maxAgeSeconds: SESSION_COOKIE_MAX_AGE,
    secure: secureCookies,
  }),
  serializeCookie(STATE_COOKIE, "", { maxAgeSeconds: 0, secure: secureCookies }),
])
```

```ts
// server/session.ts:17
export function sealSession(session: Session, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const plaintext = Buffer.from(JSON.stringify(session), "utf8")
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString("base64url")
}
```

```ts
// server/github-client.ts:18
export function createTokenExecutor(token: string): GhExecutor {
  return async (args, endpoint) => {
    const parsed = parseGhArgs(args)
    if (parsed.target === "graphql") {
      return executeGraphql(token, parsed, endpoint)
    }
    return executeRest(token, parsed, endpoint)
  }
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0, no lockfile rewrite |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npm run test -- server/session.test.ts server/github-client.test.ts server/hosted-server.test.ts` | exit 0 |
| Full tests | `npm run test` | exit 0 |
| Final check | `npm run check` | exit 0 |

## Scope

**In scope**:

- `server/main.ts`
- New `server/hosted-server.ts` or equivalent extracted hosted request module
- `server/session.ts`
- `server/github-client.ts`
- New tests: `server/session.test.ts`, `server/github-client.test.ts`,
  `server/hosted-server.test.ts`
- Test setup only if required for node-only server tests

**Out of scope**:

- Changing OAuth scopes.
- Changing the dashboard payload shape.
- Adding token revocation, rate limiting, or pagination behavior. Those are
  separate follow-up plans.
- Adding hosted CI or GitHub Actions workflows.

## Git workflow

- Branch: `c1/006-cover-hosted-auth-boundaries`
- Commit message: `Cover hosted auth boundary behavior`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Extract the hosted request handler without changing behavior

Move the route logic out of `server/main.ts` into a testable module, for
example `server/hosted-server.ts`.

Target shape:

- `server/main.ts` should read environment variables, validate config, build the
  handler, create the HTTP server, and call `listen`.
- The new module should export a factory such as `createHostedRequestHandler`.
- The factory should accept explicit dependencies for OAuth exchange, viewer
  lookup, dashboard loading, static file reading, and logging. Defaults can be
  wired in `server/main.ts`; tests should pass fakes.
- Preserve the existing route behavior and response bodies.

Do not add compatibility route aliases or dual config shapes.

**Verify**: `npm run typecheck` exits 0.

### Step 2: Add session crypto tests

Create `server/session.test.ts` with node environment coverage for:

- `sealSession` and `openSession` round-trip a valid `{ token, login, issuedAt }`.
- Tampering with the cookie value returns `null`.
- Malformed base64url or malformed JSON returns `null`.
- A session older than `SESSION_MAX_AGE_MS` returns `null`. Use Vitest fake
  timers rather than sleeping.
- `serializeCookie` includes `Path=/`, `HttpOnly`, `SameSite=Lax`,
  `Max-Age` when provided, and `Secure` only when requested.

**Verify**: `npm run test -- server/session.test.ts` exits 0.

### Step 3: Add token executor tests

Create `server/github-client.test.ts` and mock `globalThis.fetch`. Cover:

- REST requests include `Authorization: Bearer <token>`, the GitHub API accept
  header, user agent, and the explicit API version header passed through from
  `ghJson`.
- `--paginate --slurp` follows `Link: rel="next"` and returns a JSON array of
  page bodies.
- A non-OK response throws an error with `status` and `endpoint`, but the thrown
  message does not include the token.
- GraphQL POST sends `query` and typed fields in the JSON body.
- GraphQL responses with `errors` and no `data` throw.

Keep these as pure unit tests; do not call the live GitHub API.

**Verify**: `npm run test -- server/github-client.test.ts` exits 0.

### Step 4: Add hosted route tests

Create `server/hosted-server.test.ts`. Instantiate the extracted handler with
fake dependencies and drive it through a temporary `node:http` server or through
mock `IncomingMessage`/`ServerResponse` objects.

Cover at least:

- `GET /healthz` returns `{ ok: true }`.
- `GET /auth/login` redirects to GitHub and sets the OAuth state cookie.
- `GET /auth/callback` rejects a missing or mismatched state with 400.
- A successful callback exchanges the code, fetches the login, sets the session
  cookie, clears the state cookie, and redirects to `/`.
- `GET /auth/logout` clears the session cookie and redirects to `/`.
- `GET /api/dashboard` without a valid session returns 401 and `x-gcc-auth:
  oauth`.
- `GET /api/dashboard?quick=1` with a valid session calls the injected dashboard
  loader with `{ quick: true, auth: { token, userKey } }`.
- A dashboard loader 401 clears the session cookie and returns 401.
- Non-GET methods return 405.

**Verify**: `npm run test -- server/hosted-server.test.ts` exits 0.

## Test plan

- New server tests should be deterministic and should not require GitHub
  credentials, `gh`, a built `dist`, or network access.
- Use existing server test style from `server/github-dashboard.test.ts`: Vitest,
  node environment, explicit fakes, and no snapshots.
- Final verification: `npm run lint`, `npm run typecheck`, `npm run test`, and
  `npm run check` all exit 0.

## Done criteria

- [ ] `server/main.ts` no longer starts the only testable implementation at
  module import time.
- [ ] Hosted route behavior is covered by deterministic tests.
- [ ] Session sealing/opening/cookie serialization are covered by tests.
- [ ] OAuth token executor behavior is covered without live GitHub calls.
- [ ] `npm run lint` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run test` exits 0.
- [ ] `npm run check` exits 0.
- [ ] `plans/README.md` status row for Plan 006 is updated.

## STOP conditions

Stop and report back if:

- Extracting `server/main.ts` would require changing route URLs, cookie names, or
  dashboard response shapes.
- The tests need real GitHub credentials or live network.
- `server/main.ts` cannot be made import-safe without a broader server rewrite.
- Any new test requires adding a second test framework.

## Maintenance notes

Plans 007 and 008 should build on the handler seam created here. Reviewers
should scrutinize that route behavior stayed identical while testability
improved, especially cookie flags, redirect targets, and 401 handling.
