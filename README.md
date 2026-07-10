# GitHub Command Center

A focused GitHub homepage: PRs, issues, commits, CI status, workflow failures,
and GitHub Actions billing in one dense activity view, with repositories kept
as a slim sidebar for scoping the activity columns.

The root page is a minimal entrypoint: enter a GitHub username to open a public
dashboard at `/username` with no login, open `/demo` for a mock-data tour, or
sign in to open the full dashboard at `/dashboard`.

Repos you don't care about can be hidden, noisy CI failures dismissed, and
everything persists in the browser.

It runs in two modes:

| Mode | Auth | Best for |
| --- | --- | --- |
| **Local** (`npm run dev`) | Your authenticated GitHub CLI (`gh`) | Personal use on your machine |
| **Hosted public** (`npm start`) | None for `/username` routes | Public profile dashboards like `/jskoiz` |
| **Hosted OAuth** (`npm start`) | GitHub OAuth sign-in | `/dashboard` with private repo metadata, Actions billing, and signed-in data |

## Local mode

Requirements: Node.js 22.18+, npm, and the GitHub CLI authenticated as the
account you want to inspect.

```sh
gh auth status                          # check auth
gh auth refresh -h github.com -s user   # billing needs the user scope
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) for the landing page,
[http://127.0.0.1:5173/demo](http://127.0.0.1:5173/demo) for the mock-data
demo, or [http://127.0.0.1:5173/dashboard](http://127.0.0.1:5173/dashboard)
for the full local dashboard. If `gh` is not on PATH, set `GH_BIN` (see
[.env.example](./.env.example)). The local API only answers requests from
localhost.

## Hosted mode

The standalone server (`server/main.ts`) serves the built app. Public profile
routes such as `/jskoiz` require no login and use public GitHub REST data.
OAuth is optional and enables the signed-in `/dashboard` view, private repo
metadata, GraphQL-only rollups, and Actions billing. Signed-in tokens live in an
encrypted httpOnly cookie, never on disk.

Public profile routes can run anonymously, but GitHub's anonymous REST bucket is
small. Set `GITHUB_PUBLIC_TOKEN` on the server to raise that limit without
requiring visitors to log in. The server intentionally does not reuse
`GITHUB_TOKEN` or `GH_TOKEN` for public pages; hosted deployments must set the
explicit public token when they need more than anonymous quota. If OAuth is
configured and the public quota is exhausted, visitors see a sign-in action so
they can retry with their own GitHub API quota.

1. Configure the public deployment URL:

   ```sh
   BASE_URL=https://gcc.example.com
   PORT=3000
   GITHUB_PUBLIC_TOKEN=...
   ```

2. Optional: create a **GitHub OAuth App** at <https://github.com/settings/developers>:
   - Homepage URL: your deployment URL (e.g. `https://gcc.example.com`)
   - Authorization callback URL: `https://gcc.example.com/auth/callback`
3. Optional: add OAuth environment variables (see [.env.example](./.env.example)):

   ```sh
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   SESSION_SECRET=$(openssl rand -hex 32)
   ```

4. Build and start:

   ```sh
   npm ci
   npm run build
   npm start
   ```

The OAuth flow requests the `repo` and `user` scopes (private repo metadata,
workflow runs, and Actions billing). Run OAuth deployments behind HTTPS;
cookies are marked `Secure` automatically when `BASE_URL` starts with `https://`.

Logout clears the local session, records the session id as revoked for the
remaining cookie lifetime, and attempts to revoke the GitHub OAuth token.
In-memory session revocations are process-local, so a server restart clears the
local revocation list but not a successful GitHub token revocation.
Hosted OAuth and dashboard requests also use process-local request throttles to
limit repeated sign-in attempts and expensive dashboard fanout.

### Docker

```sh
docker build -t github-command-center .
docker run -p 3000:3000 \
  -e BASE_URL=https://gcc.example.com \
  -e GITHUB_PUBLIC_TOKEN=... \
  github-command-center
```

Add `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `SESSION_SECRET` to the
container only when enabling OAuth sign-in.

Works as-is on any host that runs a container or a Node process (Fly.io,
Railway, Render, a VPS). Point `BASE_URL` at the public URL, and point the OAuth
callback there if OAuth is enabled.

## Verify

```sh
npm run check
```

This runs lint, an artifact-free TypeScript check, tests, then a production
build. For faster local loops:

```sh
npm run typecheck
npm run test
```

Preview the built app locally (local `gh` mode):

```sh
npm run build
npm run preview
```

The Vite middleware serves `/api/dashboard` in both `dev` and `preview`, so the
preview command can still fetch live GitHub data.

## Data and caching

- Local mode calls `gh api`; hosted OAuth mode calls the GitHub REST/GraphQL
  APIs directly with the signed-in user's OAuth token; hosted public mode calls
  public GitHub REST APIs anonymously or with `GITHUB_PUBLIC_TOKEN` when set.
- The server keeps a short in-memory cache (5 min full / 1 min quick) per user
  or public profile.
- Cold starts first request a bounded quick payload, then load full details in
  the background.
- Workflow-run scans and live latest commit/pull request refreshes default to
  the 24 most recently pushed repositories. The shared `scanLimit` API
  parameter is clamped to 8-60.
- Latest commit and latest pull request fields are refreshed at most once per
  day for in-scope repos active in the last week. Rows outside the live refresh
  scope retain valid cached details when available. Local mode persists them to
  `.cache/github-command-center/repo-details.json`; hosted mode keeps them in
  memory.
- The browser stores the latest full dashboard payload in source-scoped storage,
  considered fresh for 10 minutes.

## License

[MIT](./LICENSE)
