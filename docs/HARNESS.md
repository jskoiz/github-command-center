# Verification Harness

The repository supports Node.js 24 LTS only. Use the exact version in `.nvmrc`;
the Docker image uses the same version.

## Bootstrap

```sh
nvm use
npm ci
```

`npm ci` is the deterministic install path. Use `npm install` only when
intentionally changing dependency metadata and commit both package files.

## Fast feedback

```sh
npm run lint
npm run dead-code
npm run typecheck
npm run test -- --project web
npm run test -- --project server
npm run test -- src/App.test.tsx
```

The web project runs in jsdom and loads `src/test/setup.ts`. The server project
runs in Node and must not rely on DOM globals. Tests must not call live GitHub,
OAuth, billing, or deployment surfaces.

## Required local gate

```sh
npm run check
```

The gate runs lint, Knip, both test projects, typechecking, the production Vite
build, and `scripts/smoke-hosted.mjs`. The smoke script starts the built hosted
server on a temporary loopback port, requires `{ "ok": true }` from `/healthz`,
and terminates the child process. A passing gate should not leave a server
running or modify tracked files.

## Dependency changes

```sh
npm install
npm audit --audit-level=high
npm run check
git diff -- package.json package-lock.json
```

Knip is mandatory. Prefer removing dead code over adding ignore entries. The
only allowed dependency ignores are stylesheet packages that Knip cannot see;
remove an ignore when its stylesheet import disappears.

## Hosted smoke

The automated smoke requires an existing `dist/`:

```sh
npm run build
npm run smoke:hosted
```

For manual inspection, `npm start` loads `.env` through Node. Vite does not load
unprefixed `.env` values into its Node process, so local overrides must be
exported in the command shell:

```sh
GH_BIN=/absolute/path/to/gh npm run dev
```

## Container gate

```sh
docker build -t github-command-center:verify .
docker run --rm -d --name gcc-verify -p 3300:3000 \
  -e BASE_URL=http://127.0.0.1:3300 \
  github-command-center:verify
curl --fail --retry 10 --retry-connrefused http://127.0.0.1:3300/healthz
docker inspect --format '{{.State.Health.Status}}' gcc-verify
docker stop gcc-verify
```

The curl and Docker health status must both succeed.

## Generated artifacts

`dist/`, `.cache/`, `coverage/`, and `node_modules/` are generated. Remove the
build output with `npm run clean`; do not delete the runtime cache unless the
task explicitly requires resetting local GitHub data.
