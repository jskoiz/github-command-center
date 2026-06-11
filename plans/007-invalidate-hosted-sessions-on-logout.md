# Plan 007: Invalidate hosted sessions on logout

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in "STOP conditions" occurs, stop and report. When done,
> update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3289de0..HEAD -- server/main.ts server/hosted-server.ts server/session.ts server/github-client.ts server/*.test.ts README.md .env.example`
> and `git diff --stat -- server/main.ts server/hosted-server.ts server/session.ts server/github-client.ts server/*.test.ts README.md .env.example`.
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/006-cover-hosted-auth-boundaries.md`
- **Category**: security
- **Planned at**: commit `3289de0`, 2026-06-11

## Why this matters

Hosted sessions are stateless encrypted cookies containing the GitHub OAuth
token. Clearing the cookie logs out the normal browser, but it does not
invalidate a copied cookie and it does not revoke the GitHub token. Logout
should make the current session unusable server-side and should attempt to
revoke the OAuth token with GitHub.

## Current state

- `Session` contains only `token`, `login`, and `issuedAt`.
- `handleLogout` clears the browser cookie and redirects to `/`.
- `openSession` can only validate age and encryption authenticity; there is no
  revocation list or session identifier.
- Hosted docs state that tokens live in an encrypted httpOnly cookie.

Relevant excerpts:

```ts
// server/session.ts:7
export type Session = {
  token: string
  login: string
  issuedAt: number
}
```

```ts
// server/main.ts:142
function handleLogout(res: ServerResponse) {
  res.statusCode = 302
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: secureCookies }))
  res.setHeader("Location", "/")
  res.end()
}
```

```md
<!-- README.md:41 -->
The standalone server (`server/main.ts`) serves the built app and signs users
in with GitHub OAuth. Each user sees their own dashboard; tokens live in an
encrypted httpOnly cookie, never on disk.
```

GitHub's current OAuth app API supports deleting a single OAuth app token with
`DELETE /applications/{client_id}/token` using the app client id and client
secret as Basic auth, with the access token in the JSON body. Reference:
<https://docs.github.com/rest/apps/oauth-applications#delete-an-app-token>.
Use the official REST docs for the exact request shape if implementation
details have changed.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npm run test -- server/session.test.ts server/github-client.test.ts server/hosted-server.test.ts` | exit 0 |
| Full tests | `npm run test` | exit 0 |
| Final check | `npm run check` | exit 0 |

## Scope

**In scope**:

- `server/session.ts`
- `server/github-client.ts`
- `server/main.ts` or `server/hosted-server.ts` if Plan 006 extracted it
- Server tests added in Plan 006
- `README.md` and `.env.example` only for concise hosted-session notes

**Out of scope**:

- Persistent database-backed sessions.
- Refresh tokens or a full GitHub App migration.
- Changing OAuth scopes.
- Rate limiting; that is Plan 008.
- Browser cache behavior; that was handled separately.

## Git workflow

- Branch: `c1/007-invalidate-hosted-sessions`
- Commit message: `Invalidate hosted sessions on logout`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add a server-side session id

Extend `Session` with a random session id, for example:

```ts
export type Session = {
  id: string
  token: string
  login: string
  issuedAt: number
}
```

Generate the id when the OAuth callback creates a session. Preserve strict
validation in `openSession`: if `id`, `token`, `login`, or `issuedAt` has the
wrong type, return `null`.

Update session tests to prove old/malformed values without `id` are rejected.
This repo does not need a backwards-compatibility parser unless the operator
explicitly asks for a migration.

**Verify**: `npm run test -- server/session.test.ts` exits 0.

### Step 2: Add an in-memory revocation store

Add a small hosted-session helper that records revoked session ids until their
maximum age expires. The store can be process-local because the current hosted
server is a single Node process with encrypted cookies and no shared database.

Expected behavior:

- `revokeSessionId(id, expiresAt)` records the id.
- `isSessionIdRevoked(id)` returns true for active revocations.
- Expired revocations are pruned during reads/writes so memory does not grow
  forever.
- `handleDashboard` rejects a valid cookie whose session id is revoked, clears
  the cookie, and returns the same 401 shape as an expired GitHub session.

Add tests for revoked and expired revocation entries.

**Verify**: `npm run test -- server/hosted-server.test.ts server/session.test.ts` exits 0.

### Step 3: Revoke the GitHub OAuth token during logout

Add `revokeOAuthToken` in `server/github-client.ts`. It should:

- Send `DELETE https://api.github.com/applications/${clientId}/token`.
- Use Basic auth where username is `clientId` and password is `clientSecret`.
- Send JSON body `{ "access_token": token }`.
- Use the existing request timeout and user agent style.
- Treat 204 and 404 as non-fatal for logout. Other non-OK statuses should be
  logged as warnings but must not prevent the local cookie from being cleared.
- Never log or throw the raw token.

In the logout handler:

- Parse and open the current session cookie.
- If valid, record the session id in the revocation store immediately.
- Attempt GitHub token revocation.
- Clear the cookie and redirect to `/` even if token revocation fails.

**Verify**: `npm run test -- server/github-client.test.ts server/hosted-server.test.ts` exits 0.

### Step 4: Document the hosted logout semantics

Update hosted-mode docs with one concise note: logout clears the local session
and attempts to revoke the GitHub OAuth token; in-memory session revocations are
process-local, so a server restart clears the revocation list but not GitHub
token revocation.

Do not add a long security model document in this plan.

**Verify**: `rg -n "logout|revoke|revocation|session" README.md .env.example server` shows the new behavior in code and docs without token values.

## Test plan

- Session tests cover the new `id` field and rejection of obsolete cookie
  shapes.
- Hosted route tests cover logout with no cookie, logout with a valid cookie,
  dashboard after revoked-session logout, and token-revocation failure still
  clearing the local cookie.
- GitHub client tests cover the revoke request without making network calls.
- Final verification: `npm run lint`, `npm run typecheck`, `npm run test`, and
  `npm run check` all exit 0.

## Done criteria

- [ ] New hosted sessions include an unpredictable id.
- [ ] Cookies without the new id are rejected rather than silently supported.
- [ ] Logout revokes the local session id before doing network work.
- [ ] Logout attempts GitHub OAuth token revocation and never logs token values.
- [ ] Dashboard requests with revoked session ids return 401 and clear the cookie.
- [ ] `npm run lint` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run test` exits 0.
- [ ] `npm run check` exits 0.
- [ ] `plans/README.md` status row for Plan 007 is updated.

## STOP conditions

Stop and report back if:

- GitHub's OAuth token revocation endpoint has changed materially from the
  documented `DELETE /applications/{client_id}/token` shape.
- A correct fix requires a persistent shared session store.
- The implementation would need to preserve old cookie shapes for compatibility.
- Token values would need to be logged or exposed to test the behavior.

## Maintenance notes

This is not a full distributed-session system. If the app moves to multiple
Node processes or serverless instances, replace the process-local revocation
store with shared storage. Reviewers should verify that logout remains reliable
even when GitHub token revocation fails.
