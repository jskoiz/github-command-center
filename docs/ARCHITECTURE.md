# Architecture

GitHub Command Center is one React client with two server adapters. Both produce
the `DashboardPayload` contract in `src/types/github.ts`; they do not expose
legacy aliases or parallel response shapes.

## Runtime modes

| Surface | Runtime | Identity | GitHub access |
| --- | --- | --- | --- |
| `/demo` | Browser | None | Static fixture data |
| `/username` | Hosted or local | Public username | Public REST token or anonymous REST |
| `/dashboard` in Vite | Local Node middleware | Authenticated `gh` user | `gh api` |
| `/dashboard` hosted | Hosted Node server | Encrypted OAuth session | User OAuth token |

Vite owns development and preview middleware only. `server/main.ts` serves the
production build, OAuth routes, hosted dashboard APIs, static assets, and
`/healthz`.

## Ownership and dependency direction

- `src/pages/` composes route-level UI.
- `src/components/` contains reusable presentation components.
- `src/lib/` contains browser persistence, formatting, route, and status logic.
- `server/hosted-server.ts` owns HTTP routing and response policy.
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
- Hosted OAuth tokens live inside encrypted, httpOnly session cookies. Logout
  revokes the local session and attempts upstream token revocation.
- `TRUST_PROXY` is opt-in. Forwarded client addresses are ignored otherwise.
- Server secrets are read from the process environment and never exposed through
  Vite client environment variables.

## Deployment

The production image builds the client, then copies only `dist/`, `server/`, the
shared types, and `package.json` into a dependency-free Node runtime image. Node
executes the TypeScript server using its built-in type stripping. `/healthz` is
the readiness and container-health contract.

## Deliberate non-goals and migration triggers

- No database or distributed session/cache layer while deployment remains a
  single process. Add one only when multiple replicas require shared state.
- No compatibility routes, duplicated payload fields, or dual parsers. Change
  the canonical contract and all consumers together.
- No background queue until request work cannot remain bounded within the
  dashboard latency budget.
- No live GitHub calls in the test harness. Integration with hosted GitHub is an
  explicit operator check, not a unit-test fallback.
