# Repository Agent Guide

## Mission

Keep GitHub Command Center small, explicit, and easy to verify. Implement the
final contract directly: delete obsolete code and data shapes instead of adding
aliases, compatibility branches, bridge routes, or dual parsers.

## Runtime boundaries

- `src/` is browser-only React code.
- `server/` is Node code. `server/worker.ts` runs that code through Cloudflare's
  Node compatibility layer; do not introduce browser imports there.
- `src/types/github.ts` is the shared browser/server data contract.
- `vite.config.ts` owns the local `gh` middleware used by `npm run dev` and
  `npm run preview`.
- `server/app-server.ts` wires the shared hosted server. `server/main.ts` owns
  standalone Node startup; `server/worker.ts` owns the public Cloudflare Worker.
- Public `/username` dashboards must remain usable without OAuth. Private
  `/dashboard` data requires local `gh` auth or hosted OAuth.
- Tokens, cookie secrets, and server environment variables must never enter the
  client bundle, browser storage, logs, fixtures, or committed files.

## Canonical commands

```sh
npm ci
npm run test -- --project web
npm run test -- --project server
npm run check
npm audit --audit-level=high
```

`npm run check` is the required local gate. It runs lint, dead-code analysis,
both test projects, typechecking, a production build, the standalone `/healthz`
smoke, and a strict Wrangler dry-run. See `docs/HARNESS.md` for targeted,
Worker-runtime, container, and live checks.

## Change rules

- Preserve the browser/Node boundary and test each side in its real runtime.
- Remove unused files, exports, dependencies, flags, and documentation in the
  same change that makes them obsolete.
- Add dependencies only when a platform API or a small local implementation is
  not sufficient.
- Keep GitHub requests bounded and make partial results visible to the caller.
- Update `README.md` for user-facing behavior and `docs/ARCHITECTURE.md` for
  changed invariants or ownership.
- Never commit `.env`, `.cache`, `dist`, `coverage`, or `node_modules`.

## Definition of done

The relevant focused tests pass, `npm run check` passes, runtime or container
changes pass their smoke test, documentation matches the final behavior, and
`git status --short` contains only the intended change. A deployment is live
only after its public HTTPS URL and Cloudflare deployment record are verified.
