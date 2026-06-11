# GitHub Command Center

A focused GitHub homepage: repositories, recent commits, PRs, issues, CI
status, workflow failures, and GitHub Actions billing in one dense view.

Two views, toggled from the header:

- **Table view** — a customizable repo table (sortable, reorderable, resizable
  columns) with an attention strip and activity feeds.
- **Focus view** — a slim repo sidebar that scopes full-height PR / issue /
  commit columns to the selected repo, with per-column state filters.

Repos you don't care about can be hidden, noisy CI failures dismissed, and
everything persists in the browser.

It runs in two modes:

| Mode | Auth | Best for |
| --- | --- | --- |
| **Local** (`npm run dev`) | Your authenticated GitHub CLI (`gh`) | Personal use on your machine |
| **Hosted** (`npm start`) | GitHub OAuth sign-in | Sharing a deployment with others |

## Local mode

Requirements: Node.js 22.18+, npm, and the GitHub CLI authenticated as the
account you want to inspect.

```sh
gh auth status                          # check auth
gh auth refresh -h github.com -s user   # billing needs the user scope
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). If `gh` is not on PATH,
set `GH_BIN` (see [.env.example](./.env.example)). The local API only answers
requests from localhost.

## Hosted mode

The standalone server (`server/main.ts`) serves the built app and signs users
in with GitHub OAuth. Each user sees their own dashboard; tokens live in an
encrypted httpOnly cookie, never on disk.

1. Create a **GitHub OAuth App** at <https://github.com/settings/developers>:
   - Homepage URL: your deployment URL (e.g. `https://gcc.example.com`)
   - Authorization callback URL: `https://gcc.example.com/auth/callback`
2. Configure the environment (see [.env.example](./.env.example)):

   ```sh
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   SESSION_SECRET=$(openssl rand -hex 32)
   BASE_URL=https://gcc.example.com
   PORT=3000
   ```

3. Build and start:

   ```sh
   npm ci
   npm run build
   npm start
   ```

The OAuth flow requests the `repo` and `user` scopes (private repo metadata,
workflow runs, and Actions billing). Run it behind HTTPS — cookies are marked
`Secure` automatically when `BASE_URL` starts with `https://`.

### Docker

```sh
docker build -t github-command-center .
docker run -p 3000:3000 \
  -e GITHUB_CLIENT_ID=... \
  -e GITHUB_CLIENT_SECRET=... \
  -e SESSION_SECRET=... \
  -e BASE_URL=https://gcc.example.com \
  github-command-center
```

Works as-is on any host that runs a container or a Node process (Fly.io,
Railway, Render, a VPS). Point `BASE_URL` and the OAuth callback at the public
URL.

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

- Local mode calls `gh api`; hosted mode calls the GitHub REST/GraphQL APIs
  directly with the signed-in user's OAuth token. Both share the same
  dashboard pipeline (`server/github-dashboard.ts`), with caches keyed per
  user in hosted mode.
- The server keeps a short in-memory cache (5 min full / 1 min quick) per user.
- Cold starts first request a bounded quick payload, then load full details in
  the background.
- Workflow-run scans default to the 24 most recently pushed repositories. The
  `scanLimit` API parameter is clamped to 8-60.
- Latest commit and latest pull request fields are fetched per repo and
  refreshed at most once per day for repos active in the last week. Local mode
  persists them to `.cache/github-command-center/repo-details.json`; hosted
  mode keeps them in memory.
- The browser stores the latest full dashboard payload in session-scoped
  storage, considered fresh for 10 minutes.

## License

[MIT](./LICENSE)
