import { randomBytes } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, normalize } from "node:path"

import { getGithubDashboard } from "./github-dashboard.ts"
import { exchangeOAuthCode, fetchViewerLogin } from "./github-client.ts"
import {
  deriveSessionKey,
  openSession,
  parseCookies,
  sealSession,
  serializeCookie,
  type Session,
} from "./session.ts"

const PORT = Number(process.env.PORT || 3000)
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "")
const CLIENT_ID = process.env.GITHUB_CLIENT_ID || ""
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || ""
const SESSION_SECRET = process.env.SESSION_SECRET || ""
const DIST_DIR = process.env.GCC_DIST_DIR || join(process.cwd(), "dist")
const OAUTH_SCOPES = "repo user"

const SESSION_COOKIE = "gcc_session"
const STATE_COOKIE = "gcc_oauth_state"
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
}

for (const [name, value] of [
  ["GITHUB_CLIENT_ID", CLIENT_ID],
  ["GITHUB_CLIENT_SECRET", CLIENT_SECRET],
  ["SESSION_SECRET", SESSION_SECRET],
]) {
  if (!value) {
    console.error(`Missing required environment variable ${name}. See .env.example.`)
    process.exit(1)
  }
}
if (SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32")
  process.exit(1)
}

const sessionKey = deriveSessionKey(SESSION_SECRET)
const secureCookies = BASE_URL.startsWith("https://")

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error("Unhandled request error:", error)
    if (!res.headersSent) {
      sendJson(res, 500, { message: "Internal server error." })
    } else {
      res.end()
    }
  })
})

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", BASE_URL)

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { message: "Method not allowed." })
    return
  }

  if (url.pathname === "/auth/login") return handleLogin(res)
  if (url.pathname === "/auth/callback") return handleCallback(req, res, url)
  if (url.pathname === "/auth/logout") return handleLogout(res)
  if (url.pathname === "/api/dashboard") return handleDashboard(req, res, url)
  if (url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true })
    return
  }

  return serveStatic(res, url.pathname)
}

function handleLogin(res: ServerResponse) {
  const state = randomBytes(16).toString("hex")
  const authorize = new URL("https://github.com/login/oauth/authorize")
  authorize.searchParams.set("client_id", CLIENT_ID)
  authorize.searchParams.set("redirect_uri", `${BASE_URL}/auth/callback`)
  authorize.searchParams.set("scope", OAUTH_SCOPES)
  authorize.searchParams.set("state", state)

  res.statusCode = 302
  res.setHeader("Set-Cookie", serializeCookie(STATE_COOKIE, state, { maxAgeSeconds: 600, secure: secureCookies }))
  res.setHeader("Location", authorize.toString())
  res.end()
}

async function handleCallback(req: IncomingMessage, res: ServerResponse, url: URL) {
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookies = parseCookies(req.headers.cookie)

  if (!code || !state || !cookies[STATE_COOKIE] || cookies[STATE_COOKIE] !== state) {
    sendJson(res, 400, { message: "OAuth state mismatch. Start again at /auth/login." })
    return
  }

  try {
    const token = await exchangeOAuthCode({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code,
      redirectUri: `${BASE_URL}/auth/callback`,
    })
    const login = await fetchViewerLogin(token)
    const session: Session = { token, login, issuedAt: Date.now() }

    res.statusCode = 302
    res.setHeader("Set-Cookie", [
      serializeCookie(SESSION_COOKIE, sealSession(session, sessionKey), {
        maxAgeSeconds: SESSION_COOKIE_MAX_AGE,
        secure: secureCookies,
      }),
      serializeCookie(STATE_COOKIE, "", { maxAgeSeconds: 0, secure: secureCookies }),
    ])
    res.setHeader("Location", "/")
    res.end()
  } catch (error) {
    console.error("OAuth callback failed:", error)
    sendJson(res, 502, { message: "GitHub sign-in failed. Try again at /auth/login." })
  }
}

function handleLogout(res: ServerResponse) {
  res.statusCode = 302
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: secureCookies }))
  res.setHeader("Location", "/")
  res.end()
}

async function handleDashboard(req: IncomingMessage, res: ServerResponse, url: URL) {
  const cookies = parseCookies(req.headers.cookie)
  const session = cookies[SESSION_COOKIE] ? openSession(cookies[SESSION_COOKIE], sessionKey) : null

  if (!session) {
    res.setHeader("x-gcc-auth", "oauth")
    sendJson(res, 401, { message: "Sign in with GitHub to load the dashboard.", loginUrl: "/auth/login" })
    return
  }

  try {
    const payload = await getGithubDashboard({
      force: url.searchParams.get("refresh") === "1",
      quick: url.searchParams.get("quick") === "1",
      scanLimit: Number(url.searchParams.get("scanLimit") ?? 24),
      auth: { token: session.token, userKey: session.login },
    })
    res.setHeader("x-gcc-auth", "oauth")
    sendJson(res, 200, payload)
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 401) {
      res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: secureCookies }))
      res.setHeader("x-gcc-auth", "oauth")
      sendJson(res, 401, { message: "GitHub session expired. Sign in again.", loginUrl: "/auth/login" })
      return
    }
    const message = error instanceof Error ? error.message : "Dashboard request failed."
    sendJson(res, 500, { message })
  }
}

async function serveStatic(res: ServerResponse, pathname: string) {
  const requested = pathname === "/" ? "/index.html" : pathname
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "")
  let filePath = join(DIST_DIR, safePath)
  if (!filePath.startsWith(DIST_DIR)) {
    sendJson(res, 403, { message: "Forbidden." })
    return
  }

  try {
    const stats = await stat(filePath)
    if (stats.isDirectory()) filePath = join(filePath, "index.html")
  } catch {
    // SPA fallback: unknown paths render the app shell.
    filePath = join(DIST_DIR, "index.html")
  }

  try {
    const body = await readFile(filePath)
    res.statusCode = 200
    res.setHeader("Content-Type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream")
    if (filePath.includes("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
    } else {
      res.setHeader("Cache-Control", "no-cache")
    }
    res.end(body)
  } catch {
    sendJson(res, 404, { message: "Not found. Run `npm run build` before starting the server." })
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}

server.listen(PORT, () => {
  console.log(`github-command-center listening on ${BASE_URL} (port ${PORT})`)
})
