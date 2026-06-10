# GitHub Command Center

A focused personal GitHub homepage for `jskoiz`: repositories, recent commits, PRs,
issues, CI status, workflow failures, and GitHub Actions billing in one dense view.

This is intentionally local-first. It reads from the authenticated GitHub CLI on
your machine and keeps a 10 minute browser cache so normal reloads do not block
on GitHub API calls.

## Requirements

- Node.js 20+
- npm
- GitHub CLI authenticated as the account you want to inspect

Check auth:

```sh
gh auth status
```

Billing usage requires the `user` scope:

```sh
gh auth refresh -h github.com -s user
```

If `gh` is not on PATH, set `GH_BIN` before running the app. See
[.env.example](./.env.example).

## Run

```sh
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Verify

```sh
npm run check
```

This runs lint first, then a production build.

Preview the built app locally:

```sh
npm run build
npm run preview
```

The Vite middleware serves `/api/dashboard` in both `dev` and `preview`, so the
preview command can still fetch live GitHub data.

## Data And Caching

- The local API uses `gh api` through `server/github-dashboard.ts`.
- The server keeps a short in-memory cache while the dev/preview process runs.
- The browser stores the latest full dashboard payload in `localStorage`.
- Cached browser data is considered fresh for 10 minutes.
- A normal reload renders fresh cached data immediately and skips the API.
- A stale reload renders cached data immediately, then refreshes in the background.
- The Refresh button forces a new API pull and updates the browser cache.

## Current Scope

The app is optimized for personal local use. It is not yet a static deploy target:
the dashboard API depends on a local GitHub CLI session. To deploy it publicly,
move `server/github-dashboard.ts` behind an authenticated server route and avoid
shipping personal GitHub credentials to the browser.
