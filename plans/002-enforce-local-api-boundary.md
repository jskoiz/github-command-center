# Plan 002: Enforce local-only access for the dashboard API

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If any
> STOP condition occurs, stop and report instead of improvising. When done,
> update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 7510159..HEAD -- vite.config.ts server src README.md package.json package-lock.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-establish-verification-baseline.md`
- **Category**: security
- **Planned at**: commit `7510159`, 2026-06-10

## Why this matters

`/api/dashboard` returns private GitHub metadata and billing data from the
operator's authenticated local GitHub CLI. The npm scripts bind Vite to
`127.0.0.1`, but the middleware itself does not enforce that assumption. If the
server is started with a broader host, tunneled, or reused in another config,
reachable clients can pull the dashboard payload.

## Current state

- `vite.config.ts` installs a GET middleware for `/api/dashboard`.
- The middleware calls `getGithubDashboard` and returns JSON without checking
  the request host or remote address.
- The README explicitly says this is local-first and not public-deploy safe.

Relevant excerpts:

```ts
// vite.config.ts:7
function installGithubDashboardApi(server: ViteDevServer | PreviewServer) {
  server.middlewares.use("/api/dashboard", async (req, res, next) => {
    if (req.method !== "GET") {
      next()
      return
    }

    try {
      const url = new URL(req.url ?? "/", "http://localhost")
      const payload = await getGithubDashboard({
        force: url.searchParams.get("refresh") === "1",
        quick: url.searchParams.get("quick") === "1",
        scanLimit: Number(url.searchParams.get("scanLimit") ?? 24),
      })
```

```md
<!-- README.md:68 -->
## Current Scope

The app is optimized for personal local use. It is not yet a static deploy target:
the dashboard API depends on a local GitHub CLI session.
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

- `vite.config.ts`
- A new small helper module if useful, for example `server/local-access.ts`
- New tests for the local-access helper
- `README.md` if the local-only enforcement needs a short note

**Out of scope**:

- GitHub OAuth or hosted authentication.
- Changing dashboard response shape.
- Changing Vite host scripts.
- Adding or running hosted CI.

## Git workflow

- Branch: `c1/002-local-api-boundary`
- Commit message: `Enforce local dashboard API access`
- Do not push or open a PR unless the operator asks.

## Steps

### Step 1: Add a loopback request guard

Create a small helper that decides whether a request is local. It should allow:

- `Host` values `localhost`, `127.0.0.1`, `[::1]`, and `::1`, with optional
  ports.
- `req.socket.remoteAddress` values `127.0.0.1`, `::1`, and IPv4-mapped
  loopback such as `::ffff:127.0.0.1`.

It should reject non-loopback remote addresses even if the `Host` header is
spoofed.

**Verify**: Add unit tests for allowed loopback hosts/remotes and rejected LAN
examples like `192.168.1.20`, `10.0.0.5`, and `203.0.113.10`. Run
`npm run test` and confirm the new tests pass.

### Step 2: Apply the guard before dashboard work starts

In `installGithubDashboardApi`, run the guard immediately after the method
check and before parsing query parameters or calling `getGithubDashboard`.

Return a small JSON 403 body such as:

```json
{ "message": "Dashboard API is only available from loopback clients." }
```

Do not include GitHub usernames, paths, or request internals in the rejection
body.

**Verify**: `npm run typecheck` exits 0.

### Step 3: Keep local development unchanged

Start the app locally only if you need a manual check:

```sh
npm run dev
```

Then request `http://127.0.0.1:5173/api/dashboard?quick=1` from the same
machine. It should still return dashboard JSON when GitHub CLI auth is valid.

Do not expose the server on a LAN or tunnel for this verification.

**Verify**: `npm run lint && npm run test && npm run build` exits 0.

## Test plan

- Unit tests for the helper should cover host parsing with ports.
- Unit tests should cover both IPv4 and IPv6 loopback.
- Unit tests should reject non-loopback remote addresses.
- If testing the middleware directly is cheap, add one test proving the guard
  runs before `getGithubDashboard`; otherwise helper coverage is sufficient.

## Done criteria

- [ ] Non-loopback requests are rejected before `getGithubDashboard` runs.
- [ ] Loopback requests continue to work.
- [ ] The rejection body is generic and contains no private GitHub data.
- [ ] `npm run lint` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run test` exits 0.
- [ ] `npm run build` exits 0.

## STOP conditions

Stop and report back if:

- Vite's request object does not expose a reliable remote address.
- The local app stops working from `127.0.0.1` or `localhost`.
- Supporting a proxy/tunnel becomes a requirement; that needs explicit auth,
  not a broadened allowlist.

## Maintenance notes

This does not make the app hosted-safe. It only enforces the current local-only
contract. Any future hosted route needs authentication and data minimization as
a separate design.
