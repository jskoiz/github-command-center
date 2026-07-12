import { randomBytes } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { extname, join, normalize, parse, sep } from "node:path"

import { isGithubRateLimitError, type GithubApiError } from "./github-client.ts"
import {
  DashboardRequestError,
  parseDashboardRequest,
  type DashboardLoader,
  type DashboardRequestOptions,
  type PublicDashboardLoader,
} from "./dashboard-request.ts"
import {
  openSession,
  parseCookies,
  sealSession,
  serializeCookie,
  type Session,
} from "./session.ts"
import {
  RATE_LIMIT_MESSAGE,
  type HostedRateLimiters,
  type RateLimitResult,
} from "./rate-limit.ts"

export const OAUTH_SCOPES = "repo user"
export const SESSION_COOKIE = "gcc_session"
export const STATE_COOKIE = "gcc_oauth_state"
export const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

const revokedSessionIds = new Map<string, number>()
const MAX_REVOKED_SESSION_IDS = 10_000

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ")

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

type StaticFileStat = {
  isDirectory(): boolean
}

type HostedLogger = Pick<Console, "error" | "warn">
type AuthHeader = "oauth" | "public"

type PublicGithubRateLimitPayload = {
  code: "github_rate_limit"
  message: string
  loginUrl?: string
  retryAfterSeconds?: number
  retryAt?: string
}

export type HostedServerDependencies = {
  baseUrl: string
  clientId: string
  clientSecret: string
  distDir: string
  sessionKey: Buffer
  secureCookies: boolean
  trustProxy?: boolean
  exchangeOAuthCode(options: {
    clientId: string
    clientSecret: string
    code: string
    redirectUri: string
  }): Promise<string>
  fetchViewerLogin(token: string): Promise<string>
  revokeOAuthToken(options: {
    clientId: string
    clientSecret: string
    token: string
  }): Promise<void>
  rateLimiters: HostedRateLimiters
  loadDashboard: DashboardLoader
  loadPublicDashboard: PublicDashboardLoader
  readFile(path: string): Promise<Buffer>
  stat(path: string): Promise<StaticFileStat>
  logger: HostedLogger
}

export function revokeSessionId(id: string, expiresAt: number) {
  pruneExpiredRevocations()
  if (expiresAt <= Date.now()) return
  if (!revokedSessionIds.has(id) && revokedSessionIds.size >= MAX_REVOKED_SESSION_IDS) {
    const oldest = revokedSessionIds.keys().next().value
    if (oldest !== undefined) revokedSessionIds.delete(oldest)
  }
  revokedSessionIds.set(id, expiresAt)
}

export function isSessionIdRevoked(id: string): boolean {
  pruneExpiredRevocations()
  return revokedSessionIds.has(id)
}

export function createHostedRequestHandler(dependencies: HostedServerDependencies) {
  const baseUrl = dependencies.baseUrl.replace(/\/$/, "")

  return (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(dependencies, baseUrl, req, res).catch((error) => {
      dependencies.logger.error("Unhandled request error:", error)
      if (!res.headersSent) {
        sendJson(res, 500, { message: "Internal server error." })
      } else {
        res.end()
      }
    })
  }
}

async function handleRequest(
  dependencies: HostedServerDependencies,
  baseUrl: string,
  req: IncomingMessage,
  res: ServerResponse
) {
  const url = new URL(req.url ?? "/", baseUrl)
  applySecurityHeaders(res, dependencies.secureCookies)

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD")
    sendJson(res, 405, { message: "Method not allowed." })
    return
  }

  if (req.method === "HEAD" && isDashboardOrAuthPath(url.pathname)) {
    res.setHeader("Allow", "GET")
    sendJson(res, 405, { message: "Method not allowed." })
    return
  }

  if (url.pathname === "/auth/login") return handleLogin(dependencies, baseUrl, req, res)
  if (url.pathname === "/auth/callback") return handleCallback(dependencies, baseUrl, req, res, url)
  if (url.pathname === "/auth/logout") return handleLogout(dependencies, req, res)
  if (isDashboardPath(url.pathname)) {
    try {
      const dashboardRequest = parseDashboardRequest(url, "/api/dashboard")
      if (dashboardRequest.username) {
        return handlePublicDashboard(dependencies, req, res, dashboardRequest.options, dashboardRequest.username)
      }
      return handleDashboard(dependencies, req, res, dashboardRequest.options)
    } catch (error) {
      if (error instanceof DashboardRequestError) {
        sendJson(res, error.status, { message: error.message })
        return
      }
      throw error
    }
  }
  if (url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true })
    return
  }

  return serveStatic(dependencies, res, url.pathname, req.method === "HEAD")
}

function isDashboardOrAuthPath(pathname: string) {
  return pathname === "/auth/login"
    || pathname === "/auth/callback"
    || pathname === "/auth/logout"
    || isDashboardPath(pathname)
}

function isDashboardPath(pathname: string) {
  return pathname === "/api/dashboard" || pathname.startsWith("/api/dashboard/")
}

function handleLogin(
  dependencies: HostedServerDependencies,
  baseUrl: string,
  req: IncomingMessage,
  res: ServerResponse
) {
  if (!isOAuthConfigured(dependencies)) {
    sendJson(res, 503, oauthUnavailablePayload())
    return
  }

  const limit = dependencies.rateLimiters.auth.check(`auth:${remoteAddressBucket(req, dependencies.trustProxy ?? false)}`)
  if (!limit.allowed) {
    sendRateLimit(res, limit)
    return
  }

  const state = randomBytes(16).toString("hex")
  const authorize = new URL("https://github.com/login/oauth/authorize")
  authorize.searchParams.set("client_id", dependencies.clientId)
  authorize.searchParams.set("redirect_uri", `${baseUrl}/auth/callback`)
  authorize.searchParams.set("scope", OAUTH_SCOPES)
  authorize.searchParams.set("state", state)

  res.statusCode = 302
  res.setHeader(
    "Set-Cookie",
    serializeCookie(STATE_COOKIE, state, { maxAgeSeconds: 600, secure: dependencies.secureCookies })
  )
  res.setHeader("Location", authorize.toString())
  res.end()
}

async function handleCallback(
  dependencies: HostedServerDependencies,
  baseUrl: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) {
  if (!isOAuthConfigured(dependencies)) {
    sendJson(res, 503, oauthUnavailablePayload())
    return
  }

  const limit = dependencies.rateLimiters.auth.check(`auth:${remoteAddressBucket(req, dependencies.trustProxy ?? false)}`)
  if (!limit.allowed) {
    sendRateLimit(res, limit)
    return
  }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookies = parseCookies(req.headers.cookie)

  if (!code || !state || !cookies[STATE_COOKIE] || cookies[STATE_COOKIE] !== state) {
    sendJson(res, 400, { message: "OAuth state mismatch. Start again at /auth/login." })
    return
  }

  try {
    const token = await dependencies.exchangeOAuthCode({
      clientId: dependencies.clientId,
      clientSecret: dependencies.clientSecret,
      code,
      redirectUri: `${baseUrl}/auth/callback`,
    })
    const login = await dependencies.fetchViewerLogin(token)
    const session: Session = { id: randomBytes(16).toString("hex"), token, login, issuedAt: Date.now() }

    res.statusCode = 302
    res.setHeader("Set-Cookie", [
      serializeCookie(SESSION_COOKIE, sealSession(session, dependencies.sessionKey), {
        maxAgeSeconds: SESSION_COOKIE_MAX_AGE,
        secure: dependencies.secureCookies,
      }),
      serializeCookie(STATE_COOKIE, "", { maxAgeSeconds: 0, secure: dependencies.secureCookies }),
    ])
    res.setHeader("Location", "/dashboard")
    res.end()
  } catch (error) {
    dependencies.logger.error("OAuth callback failed:", error)
    sendJson(res, 502, { message: "GitHub sign-in failed. Try again at /auth/login." })
  }
}

async function handleLogout(
  dependencies: HostedServerDependencies,
  req: IncomingMessage,
  res: ServerResponse
) {
  // Logout revokes the GitHub OAuth token, so block cross-site GET navigations
  // (cookies are SameSite=Lax and still sent on top-level links).
  const fetchSite = req.headers["sec-fetch-site"]
  if (typeof fetchSite === "string" && fetchSite !== "same-origin" && fetchSite !== "none") {
    sendJson(res, 403, { message: "Logout must be initiated from the dashboard." })
    return
  }

  const cookies = parseCookies(req.headers.cookie)
  const session = cookies[SESSION_COOKIE] ? openSession(cookies[SESSION_COOKIE], dependencies.sessionKey) : null

  if (session) {
    revokeSessionId(session.id, session.issuedAt + SESSION_COOKIE_MAX_AGE * 1000)
    if (isOAuthConfigured(dependencies)) {
      try {
        await dependencies.revokeOAuthToken({
          clientId: dependencies.clientId,
          clientSecret: dependencies.clientSecret,
          token: session.token,
        })
      } catch (error) {
        dependencies.logger.warn("GitHub OAuth token revocation failed:", error)
      }
    }
  }

  res.statusCode = 302
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: dependencies.secureCookies })
  )
  res.setHeader("Location", "/")
  res.end()
}

async function handleDashboard(
  dependencies: HostedServerDependencies,
  req: IncomingMessage,
  res: ServerResponse,
  request: DashboardRequestOptions
) {
  const cookies = parseCookies(req.headers.cookie)
  const session = cookies[SESSION_COOKIE] ? openSession(cookies[SESSION_COOKIE], dependencies.sessionKey) : null

  if (!session) {
    res.setHeader("x-gcc-auth", "oauth")
    sendJson(
      res,
      401,
      isOAuthConfigured(dependencies)
        ? { message: "Sign in with GitHub to load the dashboard.", loginUrl: "/auth/login" }
        : oauthUnavailablePayload()
    )
    return
  }

  if (isSessionIdRevoked(session.id)) {
    sendExpiredSession(dependencies, res)
    return
  }

  try {
    const limit = dashboardRateLimiter(dependencies.rateLimiters, request).check(
      `${dashboardRateLimitPrefix(request)}:${session.login}`
    )
    if (!limit.allowed) {
      sendRateLimit(res, limit, { authHeader: "oauth" })
      return
    }

    const payload = await dependencies.loadDashboard({
      ...request,
      auth: { token: session.token, sessionId: session.id },
    })
    res.setHeader("x-gcc-auth", "oauth")
    sendJson(res, 200, payload)
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 401) {
      sendExpiredSession(dependencies, res)
      return
    }
    dependencies.logger.error("Dashboard request failed:", error)
    sendJson(res, 500, { message: "Dashboard request failed. Try again shortly." })
  }
}

async function handlePublicDashboard(
  dependencies: HostedServerDependencies,
  req: IncomingMessage,
  res: ServerResponse,
  request: DashboardRequestOptions,
  username: string
) {
  try {
    const remoteAddress = remoteAddressBucket(req, dependencies.trustProxy ?? false)
    const clientLimit = publicClientDashboardRateLimiter(dependencies.rateLimiters, request).check(
      `${dashboardRateLimitPrefix(request)}:public-client:${remoteAddress}`
    )
    if (!clientLimit.allowed) {
      sendRateLimit(res, clientLimit, { authHeader: "public" })
      return
    }

    const limit = dashboardRateLimiter(dependencies.rateLimiters, request).check(
      `${dashboardRateLimitPrefix(request)}:public:${username.toLowerCase()}:${remoteAddress}`
    )
    if (!limit.allowed) {
      sendRateLimit(res, limit, { authHeader: "public" })
      return
    }

    const payload = await dependencies.loadPublicDashboard(username, request)
    res.setHeader("x-gcc-auth", "public")
    sendJson(res, 200, payload)
  } catch (error) {
    res.setHeader("x-gcc-auth", "public")
    if (isPublicGithubRateLimitError(error)) {
      sendJson(res, 403, publicGithubRateLimitPayload(dependencies, error))
      return
    }

    const status = (error as { status?: number }).status
    if (status && status >= 400 && status < 500) {
      const message = error instanceof Error ? error.message : "Public dashboard request failed."
      sendJson(res, status, { message })
      return
    }

    dependencies.logger.error("Public dashboard request failed:", error)
    sendJson(res, 500, { message: "Public dashboard request failed. Try again shortly." })
  }
}

function remoteAddressBucket(req: IncomingMessage, trustProxy: boolean) {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"]
    const header = Array.isArray(forwarded) ? forwarded[0] : forwarded
    if (header) {
      // The last entry is the address the trusted proxy saw; earlier entries
      // are client-supplied and spoofable.
      const hops = header.split(",").map((part) => part.trim()).filter(Boolean)
      const clientAddress = hops[hops.length - 1]
      if (clientAddress) return clientAddress
    }
  }
  return req.socket.remoteAddress?.trim() || "unknown"
}

function dashboardRateLimiter(
  rateLimiters: HostedRateLimiters,
  request: { force: boolean; quick: boolean }
) {
  if (request.force) return rateLimiters.refreshDashboard
  if (request.quick) return rateLimiters.quickDashboard
  return rateLimiters.fullDashboard
}

function publicClientDashboardRateLimiter(
  rateLimiters: HostedRateLimiters,
  request: { force: boolean; quick: boolean }
) {
  if (request.force) return rateLimiters.publicClientRefreshDashboard
  if (request.quick) return rateLimiters.publicClientQuickDashboard
  return rateLimiters.publicClientFullDashboard
}

function dashboardRateLimitPrefix(request: { force: boolean; quick: boolean }) {
  if (request.force) return "refresh"
  if (request.quick) return "quick"
  return "full"
}

function isOAuthConfigured(dependencies: HostedServerDependencies) {
  return Boolean(dependencies.clientId && dependencies.clientSecret)
}

function oauthUnavailablePayload() {
  return {
    message: "GitHub OAuth is not configured. Open /:username to view a public profile dashboard.",
  }
}

function isPublicGithubRateLimitError(error: unknown): error is GithubApiError {
  if (isGithubRateLimitError(error)) return true

  const status = (error as { status?: unknown }).status
  return status === 403 && error instanceof Error && /rate limit/i.test(error.message)
}

function publicGithubRateLimitPayload(
  dependencies: HostedServerDependencies,
  error: GithubApiError
): PublicGithubRateLimitPayload {
  const oauthConfigured = isOAuthConfigured(dependencies)
  const payload: PublicGithubRateLimitPayload = {
    code: "github_rate_limit",
    message: oauthConfigured
      ? "GitHub rate limit reached for public dashboards. Sign in with GitHub to use your own API quota, or try again later."
      : "GitHub rate limit reached for public dashboards. GitHub sign-in is not configured on this deployment; try again later.",
  }

  if (oauthConfigured) payload.loginUrl = "/auth/login"
  if (typeof error.retryAfterSeconds === "number") payload.retryAfterSeconds = Math.max(1, Math.ceil(error.retryAfterSeconds))
  if (typeof error.retryAt === "string") payload.retryAt = error.retryAt

  return payload
}

function pruneExpiredRevocations() {
  const now = Date.now()
  for (const [id, expiresAt] of revokedSessionIds) {
    if (expiresAt <= now) revokedSessionIds.delete(id)
  }
}

function sendExpiredSession(dependencies: HostedServerDependencies, res: ServerResponse) {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: dependencies.secureCookies })
  )
  res.setHeader("x-gcc-auth", "oauth")
  sendJson(
    res,
    401,
    isOAuthConfigured(dependencies)
      ? { message: "GitHub session expired. Sign in again.", loginUrl: "/auth/login" }
      : oauthUnavailablePayload()
  )
}

async function serveStatic(
  dependencies: HostedServerDependencies,
  res: ServerResponse,
  pathname: string,
  headOnly: boolean
) {
  const staticRoot = normalizeStaticRoot(dependencies.distDir)
  const requested = pathname === "/" ? "/index.html" : pathname
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "")
  let filePath = join(staticRoot, safePath)
  let finalPathVerified = false
  if (filePath !== staticRoot && !filePath.startsWith(staticRoot + sep)) {
    sendJson(res, 403, { message: "Forbidden." })
    return
  }

  try {
    const stats = await dependencies.stat(filePath)
    if (stats.isDirectory()) filePath = join(filePath, "index.html")
    else finalPathVerified = true
  } catch {
    // SPA fallback: unknown paths render the app shell.
    filePath = join(staticRoot, "index.html")
  }

  if (headOnly) {
    if (!finalPathVerified) {
      try {
        await dependencies.stat(filePath)
      } catch {
        sendJson(res, 404, { message: "Not found. Run `npm run build` before starting the server." })
        return
      }
    }
    res.statusCode = 200
    applyStaticRepresentationHeaders(res, filePath)
    res.end()
    return
  }

  try {
    const body = await dependencies.readFile(filePath)
    res.statusCode = 200
    applyStaticRepresentationHeaders(res, filePath)
    res.end(body)
  } catch {
    sendJson(res, 404, { message: "Not found. Run `npm run build` before starting the server." })
  }
}

function applyStaticRepresentationHeaders(res: ServerResponse, filePath: string) {
  res.setHeader("Content-Type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream")
  if (filePath.includes("/assets/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
  } else {
    res.setHeader("Cache-Control", "no-cache")
  }
}

function normalizeStaticRoot(distDir: string) {
  const normalized = normalize(distDir)
  const root = parse(normalized).root
  let end = normalized.length
  while (end > root.length && normalized.endsWith(sep, end)) end -= sep.length
  return normalized.slice(0, end)
}

function applySecurityHeaders(res: ServerResponse, secureCookies: boolean) {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "SAMEORIGIN")
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY)
  if (secureCookies) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}

function sendRateLimit(
  res: ServerResponse,
  limit: Extract<RateLimitResult, { allowed: false }>,
  options: { authHeader?: AuthHeader } = {}
) {
  if (options.authHeader) res.setHeader("x-gcc-auth", options.authHeader)
  res.setHeader("Retry-After", String(limit.retryAfterSeconds))
  sendJson(res, 429, {
    code: "app_rate_limit",
    message: RATE_LIMIT_MESSAGE,
    retryAfterSeconds: limit.retryAfterSeconds,
  })
}
