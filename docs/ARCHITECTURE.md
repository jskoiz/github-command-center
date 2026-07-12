# Architecture

GitHub Command Center is one React client with two server adapters. Both produce
the `DashboardPayload` contract in `src/types/github.ts`; they do not expose
legacy aliases or parallel response shapes.

## Runtime modes

| Surface | Runtime | Identity | GitHub access |
| --- | --- | --- | --- |
| `/demo` | Browser | None | Static fixture data |
| `/username` | Cloudflare Worker, standalone Node, or local | Public username | Public REST token or anonymous REST |
| `/dashboard` in Vite | Local Node middleware | Authenticated `gh` user | `gh api` |
| `/dashboard` standalone hosted | Hosted Node server | Encrypted OAuth session | User OAuth token |
| `/dashboard` on the public Worker | Cloudflare Worker | Disabled | None |

Vite owns development and preview middleware only. `server/app-server.ts` wires
the shared Node HTTP application. `server/main.ts` adds standalone filesystem
assets and process startup. `server/worker.ts` exposes the same dynamic handler
through Cloudflare's Node compatibility layer while Cloudflare Assets serves the
Vite build.

## Ownership and dependency direction

- `src/pages/` composes route-level UI.
- `src/components/` contains reusable presentation components.
- `src/lib/` contains browser persistence, formatting, route, and status logic.
- `server/hosted-server.ts` owns HTTP routing and response policy.
- `server/app-server.ts` owns hosted dependency wiring shared by both runtimes.
- `server/worker.ts` owns Cloudflare's public-only runtime boundary.
- `server/dashboard-request.ts` owns dashboard request parsing shared by local
  and hosted adapters.
- `server/github-dashboard.ts` owns aggregation, bounded fanout, caching, and
  partial-data warnings.
- `server/github-client.ts` owns direct REST and GraphQL execution.
- `server/session.ts` and `server/rate-limit.ts` own their isolated policies.

Browser modules must not import server modules. Server modules may import the
shared GitHub types as type-only dependencies. Route adapters translate HTTP
input once, then call the dashboard service with the canonical option shape.

## Data and cache scopes

- Full dashboard results are cached in memory for five minutes; quick results
  are cached for one minute.
- Repository detail refreshes are bounded by `scanLimit` and cached for one day.
- Local repository details may persist under `.cache/`; hosted user data remains
  process-local.
- Browser dashboard payloads are source-scoped in session storage and expire
  after ten minutes.
- Partial GitHub results must include warnings. A truncated or failed upstream
  result must not look complete.

## Security boundaries

- Local dashboard APIs accept loopback requests only.
- Public profile requests use only an explicit `GITHUB_PUBLIC_TOKEN` or GitHub's
  anonymous quota; they never reuse local CLI or OAuth credentials.
- Standalone hosted OAuth tokens live inside encrypted, httpOnly session cookies. Logout
  revokes the local session and attempts upstream token revocation.
- The public Worker never accepts OAuth sessions or the local `gh` token.
- `TRUST_PROXY` is opt-in. Forwarded client addresses are ignored otherwise.
- Server secrets are read from the process environment and never exposed through
  Vite client environment variables.

## Deployment

The canonical public deployment is the Cloudflare Worker configured by
`wrangler.jsonc`. Dynamic API, auth-unavailable, and health requests run through
the shared Node HTTP handler. Static assets are uploaded from `dist/`; SPA
routing and response headers are owned by the Cloudflare Assets configuration
and `public/_headers`.

The Docker image remains the standalone OAuth-capable deployment. It copies only
`dist/`, `server/`, the shared types, and `package.json` into a dependency-free
Node runtime image. `/healthz` is the readiness contract in both deployments.

## Deliberate non-goals and migration triggers

- No distributed session/cache layer. The public Worker is stateless with
  best-effort isolate-local caches and rate limits. Add shared state before
  enabling OAuth or any correctness requirement across Worker isolates.
- No compatibility routes, duplicated payload fields, or dual parsers. Change
  the canonical contract and all consumers together.
- No background queue until request work cannot remain bounded within the
  dashboard latency budget.
- No live GitHub calls in the test harness. Integration with hosted GitHub is an
  explicit operator check, not a unit-test fallback.
