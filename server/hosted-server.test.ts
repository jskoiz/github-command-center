// @vitest-environment node

import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { afterEach, describe, expect, it, vi, type Mock } from "vitest"

import {
  createHostedRequestHandler,
  isSessionIdRevoked,
  OAUTH_SCOPES,
  revokeSessionId,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  STATE_COOKIE,
  type HostedServerDependencies,
} from "./hosted-server.ts"
import {
  RATE_LIMIT_MESSAGE,
  createHostedRateLimiters,
  createRateLimiter,
  type HostedRateLimiters,
  type RateLimitOptions,
} from "./rate-limit.ts"
import { deriveSessionKey, openSession, sealSession, type Session } from "./session.ts"

type OAuthExchangeOptions = Parameters<HostedServerDependencies["exchangeOAuthCode"]>[0]
type OAuthRevocationOptions = Parameters<HostedServerDependencies["revokeOAuthToken"]>[0]
type DashboardOptions = Parameters<HostedServerDependencies["loadDashboard"]>[0]
type FixtureLogger = {
  error: Mock<Console["error"]>
  warn: Mock<Console["warn"]>
}

type FixtureCalls = {
  exchanges: OAuthExchangeOptions[]
  revocations: OAuthRevocationOptions[]
  viewerTokens: string[]
  dashboards: DashboardOptions[]
  staticStats: string[]
  staticReads: string[]
}

type FixtureOptions = {
  loadDashboard?: HostedServerDependencies["loadDashboard"]
  rateLimiters?: HostedRateLimiters
  revokeOAuthToken?: HostedServerDependencies["revokeOAuthToken"]
  readFile?: HostedServerDependencies["readFile"]
  stat?: HostedServerDependencies["stat"]
}

type TestResponse = {
  status: number
  headers: IncomingHttpHeaders
  setCookies: string[]
  body: string
}

type Fixture = {
  calls: FixtureCalls
  logger: FixtureLogger
  request(path: string, options?: { method?: string; headers?: Record<string, string> }): Promise<TestResponse>
  sessionKey: Buffer
  close(): Promise<void>
}

const BASE_URL = "http://127.0.0.1"
const DIST_DIR = "/tmp/github-command-center-dist"
let sessionCounter = 0

afterEach(() => {
  vi.useRealTimers()
})

async function startFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const sessionKey = deriveSessionKey("hosted-server-secret-with-at-least-thirty-two-characters")
  const logger: FixtureLogger = { error: vi.fn<Console["error"]>(), warn: vi.fn<Console["warn"]>() }
  const calls: FixtureCalls = {
    exchanges: [],
    revocations: [],
    viewerTokens: [],
    dashboards: [],
    staticStats: [],
    staticReads: [],
  }

  const dependencies: HostedServerDependencies = {
    baseUrl: BASE_URL,
    clientId: "client-id",
    clientSecret: "client-secret",
    distDir: DIST_DIR,
    sessionKey,
    secureCookies: false,
    exchangeOAuthCode: async (exchangeOptions) => {
      calls.exchanges.push(exchangeOptions)
      return "gho_token"
    },
    fetchViewerLogin: async (token) => {
      calls.viewerTokens.push(token)
      return "jskoiz"
    },
    revokeOAuthToken: async (revokeOptions) => {
      calls.revocations.push(revokeOptions)
      await options.revokeOAuthToken?.(revokeOptions)
    },
    rateLimiters: options.rateLimiters ?? createHostedRateLimiters(),
    loadDashboard: options.loadDashboard ?? (async (dashboardOptions) => {
      calls.dashboards.push(dashboardOptions)
      return { ok: true }
    }),
    readFile: async (path) => {
      calls.staticReads.push(path)
      return options.readFile ? options.readFile(path) : Buffer.from("<!doctype html>")
    },
    stat: async (path) => {
      calls.staticStats.push(path)
      return options.stat ? options.stat(path) : { isDirectory: () => false }
    },
    logger,
  }
  const server = createServer(createHostedRequestHandler(dependencies))

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  return {
    calls,
    logger,
    sessionKey,
    request: (path, requestOptions) => request(server, path, requestOptions),
    close: () => closeServer(server),
  }
}

async function withFixture(
  run: (fixture: Fixture) => Promise<void>,
  options: FixtureOptions = {}
) {
  const fixture = await startFixture(options)
  try {
    await run(fixture)
  } finally {
    await fixture.close()
  }
}

function request(
  server: Server,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): Promise<TestResponse> {
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Test server is not listening on TCP.")

  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1",
      port: (address as AddressInfo).port,
      path,
      method: options.method ?? "GET",
      headers: options.headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk)
      })
      res.on("end", () => {
        const setCookie = res.headers["set-cookie"]
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          setCookies: Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [],
          body: Buffer.concat(chunks).toString("utf8"),
        })
      })
    })
    req.on("error", reject)
    req.end()
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function header(response: TestResponse, name: string): string | undefined {
  const value = response.headers[name.toLowerCase()]
  if (Array.isArray(value)) return value.join(", ")
  return value
}

function cookieValue(cookies: string[], name: string): string {
  const cookie = cookies.find((item) => item.startsWith(`${name}=`))
  if (!cookie) throw new Error(`Missing ${name} cookie.`)
  return cookie.slice(name.length + 1).split(";")[0] ?? ""
}

function createSession(overrides: Partial<Session> = {}): Session {
  sessionCounter += 1
  return {
    id: `session-${sessionCounter}`,
    token: "gho_token",
    login: "jskoiz",
    issuedAt: Date.now(),
    ...overrides,
  }
}

function sessionCookieHeader(sessionKey: Buffer, session = createSession()) {
  const value = sealSession(session, sessionKey)
  return `${SESSION_COOKIE}=${value}`
}

function testRateLimiters(
  overrides: Partial<Record<keyof HostedRateLimiters, RateLimitOptions>> = {}
): HostedRateLimiters {
  const defaults: RateLimitOptions = { limit: 1_000, windowMs: 60_000, now: () => 0 }
  return {
    auth: createRateLimiter(overrides.auth ?? defaults),
    quickDashboard: createRateLimiter(overrides.quickDashboard ?? defaults),
    fullDashboard: createRateLimiter(overrides.fullDashboard ?? defaults),
    refreshDashboard: createRateLimiter(overrides.refreshDashboard ?? defaults),
  }
}

describe("hosted session revocations", () => {
  it("records active revoked session ids", () => {
    const expiresAt = Date.now() + 60_000

    revokeSessionId("active-revocation", expiresAt)

    expect(isSessionIdRevoked("active-revocation")).toBe(true)
  })

  it("prunes expired revoked session ids during reads and writes", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    revokeSessionId("expires-soon", 1_500)
    expect(isSessionIdRevoked("expires-soon")).toBe(true)

    vi.setSystemTime(1_501)
    expect(isSessionIdRevoked("expires-soon")).toBe(false)

    revokeSessionId("already-expired", 1_400)
    expect(isSessionIdRevoked("already-expired")).toBe(false)
  })
})

describe("hosted request handler", () => {
  it("returns health status", async () => {
    await withFixture(async (fixture) => {
      const response = await fixture.request("/healthz")

      expect(response.status).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ ok: true })
    })
  })

  it("serves the app shell for the root path", async () => {
    await withFixture(async (fixture) => {
      const response = await fixture.request("/")

      expect(response.status).toBe(200)
      expect(response.body).toBe("<!doctype html>")
      expect(header(response, "content-type")).toBe("text/html; charset=utf-8")
      expect(header(response, "cache-control")).toBe("no-cache")
      expect(fixture.calls.staticStats).toEqual([`${DIST_DIR}/index.html`])
      expect(fixture.calls.staticReads).toEqual([`${DIST_DIR}/index.html`])
    })
  })

  it("falls back to the app shell for unknown SPA paths", async () => {
    await withFixture(async (fixture) => {
      const response = await fixture.request("/settings/profile")

      expect(response.status).toBe(200)
      expect(header(response, "content-type")).toBe("text/html; charset=utf-8")
      expect(header(response, "cache-control")).toBe("no-cache")
      expect(fixture.calls.staticStats).toEqual([`${DIST_DIR}/settings/profile`])
      expect(fixture.calls.staticReads).toEqual([`${DIST_DIR}/index.html`])
    }, {
      stat: async (path) => {
        if (path.endsWith("/settings/profile")) throw new Error("not found")
        return { isDirectory: () => false }
      },
    })
  })

  it("serves asset paths with immutable cache headers", async () => {
    await withFixture(async (fixture) => {
      const response = await fixture.request("/assets/app.js")

      expect(response.status).toBe(200)
      expect(response.body).toBe("console.log('ok')")
      expect(header(response, "content-type")).toBe("text/javascript; charset=utf-8")
      expect(header(response, "cache-control")).toBe("public, max-age=31536000, immutable")
      expect(fixture.calls.staticStats).toEqual([`${DIST_DIR}/assets/app.js`])
      expect(fixture.calls.staticReads).toEqual([`${DIST_DIR}/assets/app.js`])
    }, {
      readFile: async () => Buffer.from("console.log('ok')"),
    })
  })

  it("keeps traversal attempts inside the injected static root", async () => {
    await withFixture(async (fixture) => {
      const response = await fixture.request("/../../etc/passwd")
      const touchedPaths = [...fixture.calls.staticStats, ...fixture.calls.staticReads]

      expect(response.status).toBe(200)
      expect(touchedPaths.length).toBeGreaterThan(0)
      expect(touchedPaths.every((path) => path.startsWith(DIST_DIR))).toBe(true)
    }, {
      stat: async () => {
        throw new Error("not found")
      },
    })
  })

  it("redirects login requests to GitHub and sets the OAuth state cookie", async () => {
    await withFixture(async (fixture) => {
      const response = await fixture.request("/auth/login")
      const location = header(response, "location")
      if (!location) throw new Error("Missing login redirect location.")
      const authorize = new URL(location)
      const stateCookie = cookieValue(response.setCookies, STATE_COOKIE)

      expect(response.status).toBe(302)
      expect(authorize.toString()).toContain("https://github.com/login/oauth/authorize")
      expect(authorize.searchParams.get("client_id")).toBe("client-id")
      expect(authorize.searchParams.get("redirect_uri")).toBe(`${BASE_URL}/auth/callback`)
      expect(authorize.searchParams.get("scope")).toBe(OAUTH_SCOPES)
      expect(authorize.searchParams.get("state")).toBe(stateCookie)
      expect(response.setCookies[0]).toContain("Max-Age=600")
    })
  })

  it("rate-limits repeated login requests by remote address", async () => {
    const rateLimiters = testRateLimiters({ auth: { limit: 1, windowMs: 60_000, now: () => 0 } })

    await withFixture(async (fixture) => {
      const allowed = await fixture.request("/auth/login")
      const blocked = await fixture.request("/auth/login")

      expect(allowed.status).toBe(302)
      expect(blocked.status).toBe(429)
      expect(header(blocked, "retry-after")).toBe("60")
      expect(header(blocked, "location")).toBeUndefined()
      expect(JSON.parse(blocked.body)).toEqual({ message: RATE_LIMIT_MESSAGE })
    }, { rateLimiters })
  })

  it("rejects missing or mismatched OAuth state", async () => {
    await withFixture(async (fixture) => {
      const missing = await fixture.request("/auth/callback?code=abc")
      const mismatched = await fixture.request("/auth/callback?code=abc&state=sent", {
        headers: { Cookie: `${STATE_COOKIE}=stored` },
      })

      expect(missing.status).toBe(400)
      expect(mismatched.status).toBe(400)
      expect(fixture.calls.exchanges).toHaveLength(0)
    })
  })

  it("exchanges a valid callback, sets the session, clears state, and redirects home", async () => {
    await withFixture(async (fixture) => {
      const response = await fixture.request("/auth/callback?code=code-123&state=known", {
        headers: { Cookie: `${STATE_COOKIE}=known` },
      })
      const sessionValue = cookieValue(response.setCookies, SESSION_COOKIE)
      const stateClearCookie = response.setCookies.find((cookie) => cookie.startsWith(`${STATE_COOKIE}=`))

      expect(response.status).toBe(302)
      expect(header(response, "location")).toBe("/")
      expect(fixture.calls.exchanges).toEqual([{
        clientId: "client-id",
        clientSecret: "client-secret",
        code: "code-123",
        redirectUri: `${BASE_URL}/auth/callback`,
      }])
      expect(fixture.calls.viewerTokens).toEqual(["gho_token"])
      expect(openSession(sessionValue, fixture.sessionKey)).toMatchObject({
        id: expect.any(String),
        token: "gho_token",
        login: "jskoiz",
      })
      expect(stateClearCookie).toContain("Max-Age=0")
    })
  })

  it("rate-limits OAuth callbacks before exchanging codes", async () => {
    const rateLimiters = testRateLimiters({ auth: { limit: 1, windowMs: 60_000, now: () => 0 } })

    await withFixture(async (fixture) => {
      const allowed = await fixture.request("/auth/callback?code=first&state=known", {
        headers: { Cookie: `${STATE_COOKIE}=known` },
      })
      const blocked = await fixture.request("/auth/callback?code=second&state=known", {
        headers: { Cookie: `${STATE_COOKIE}=known` },
      })

      expect(allowed.status).toBe(302)
      expect(blocked.status).toBe(429)
      expect(header(blocked, "retry-after")).toBe("60")
      expect(JSON.parse(blocked.body)).toEqual({ message: RATE_LIMIT_MESSAGE })
      expect(fixture.calls.exchanges).toHaveLength(1)
      expect(fixture.calls.exchanges[0]?.code).toBe("first")
    }, { rateLimiters })
  })

  it("clears the session cookie on logout and redirects home", async () => {
    await withFixture(async (fixture) => {
      const response = await fixture.request("/auth/logout")

      expect(response.status).toBe(302)
      expect(header(response, "location")).toBe("/")
      expect(cookieValue(response.setCookies, SESSION_COOKIE)).toBe("")
      expect(response.setCookies[0]).toContain("Max-Age=0")
      expect(fixture.calls.revocations).toHaveLength(0)
    })
  })

  it("revokes valid session ids and OAuth tokens on logout", async () => {
    await withFixture(async (fixture) => {
      const session = createSession({ id: "logout-session" })
      const response = await fixture.request("/auth/logout", {
        headers: { Cookie: sessionCookieHeader(fixture.sessionKey, session) },
      })

      expect(response.status).toBe(302)
      expect(header(response, "location")).toBe("/")
      expect(cookieValue(response.setCookies, SESSION_COOKIE)).toBe("")
      expect(isSessionIdRevoked(session.id)).toBe(true)
      expect(fixture.calls.revocations).toEqual([{
        clientId: "client-id",
        clientSecret: "client-secret",
        token: "gho_token",
      }])
    })
  })

  it("still clears the local cookie when OAuth token revocation fails", async () => {
    const token = "gho_logout_failure_token"
    const revokeOAuthToken: HostedServerDependencies["revokeOAuthToken"] = async () => {
      throw new Error("GitHub OAuth token revocation returned 500.")
    }

    await withFixture(async (fixture) => {
      const session = createSession({ id: "logout-revoke-failure", token })
      const response = await fixture.request("/auth/logout", {
        headers: { Cookie: sessionCookieHeader(fixture.sessionKey, session) },
      })
      const warningText = fixture.logger.warn.mock.calls.flat().map(String).join(" ")

      expect(response.status).toBe(302)
      expect(header(response, "location")).toBe("/")
      expect(cookieValue(response.setCookies, SESSION_COOKIE)).toBe("")
      expect(isSessionIdRevoked(session.id)).toBe(true)
      expect(fixture.calls.revocations).toEqual([{
        clientId: "client-id",
        clientSecret: "client-secret",
        token,
      }])
      expect(fixture.logger.warn).toHaveBeenCalledTimes(1)
      expect(warningText).not.toContain(token)
    }, { revokeOAuthToken })
  })

  it("requires an OAuth session for dashboard requests", async () => {
    await withFixture(async (fixture) => {
      const response = await fixture.request("/api/dashboard")

      expect(response.status).toBe(401)
      expect(header(response, "x-gcc-auth")).toBe("oauth")
      expect(JSON.parse(response.body)).toEqual({
        message: "Sign in with GitHub to load the dashboard.",
        loginUrl: "/auth/login",
      })
    })
  })

  it("does not count unauthenticated dashboard requests against user buckets", async () => {
    const rateLimiters = testRateLimiters({
      fullDashboard: { limit: 1, windowMs: 60_000, now: () => 0 },
    })

    await withFixture(async (fixture) => {
      const firstUnauthenticated = await fixture.request("/api/dashboard")
      const secondUnauthenticated = await fixture.request("/api/dashboard")
      const authenticated = await fixture.request("/api/dashboard", {
        headers: { Cookie: sessionCookieHeader(fixture.sessionKey) },
      })

      expect(firstUnauthenticated.status).toBe(401)
      expect(secondUnauthenticated.status).toBe(401)
      expect(authenticated.status).toBe(200)
      expect(fixture.calls.dashboards).toHaveLength(1)
    }, { rateLimiters })
  })

  it("loads quick dashboards with the token auth context", async () => {
    await withFixture(async (fixture) => {
      const response = await fixture.request("/api/dashboard?quick=1", {
        headers: { Cookie: sessionCookieHeader(fixture.sessionKey) },
      })

      expect(response.status).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ ok: true })
      expect(fixture.calls.dashboards).toEqual([{
        force: false,
        quick: true,
        scanLimit: 24,
        auth: { token: "gho_token", userKey: "jskoiz" },
      }])
    })
  })

  it("rate-limits dashboard requests by signed-in login and request kind", async () => {
    const rateLimiters = testRateLimiters({
      quickDashboard: { limit: 1, windowMs: 60_000, now: () => 0 },
      fullDashboard: { limit: 1, windowMs: 60_000, now: () => 0 },
      refreshDashboard: { limit: 1, windowMs: 60_000, now: () => 0 },
    })

    await withFixture(async (fixture) => {
      const cookie = sessionCookieHeader(fixture.sessionKey)
      const quick = await fixture.request("/api/dashboard?quick=1", {
        headers: { Cookie: cookie },
      })
      const full = await fixture.request("/api/dashboard", {
        headers: { Cookie: cookie },
      })
      const refresh = await fixture.request("/api/dashboard?refresh=1", {
        headers: { Cookie: cookie },
      })
      const blockedQuick = await fixture.request("/api/dashboard?quick=1", {
        headers: { Cookie: cookie },
      })

      expect(quick.status).toBe(200)
      expect(full.status).toBe(200)
      expect(refresh.status).toBe(200)
      expect(blockedQuick.status).toBe(429)
      expect(header(blockedQuick, "x-gcc-auth")).toBe("oauth")
      expect(header(blockedQuick, "retry-after")).toBe("60")
      expect(JSON.parse(blockedQuick.body)).toEqual({ message: RATE_LIMIT_MESSAGE })
      expect(fixture.calls.dashboards).toHaveLength(3)
      expect(fixture.calls.dashboards.map((call) => [call.quick, call.force])).toEqual([
        [true, false],
        [false, false],
        [false, true],
      ])
    }, { rateLimiters })
  })

  it("does not call the dashboard loader for blocked dashboard requests", async () => {
    const rateLimiters = testRateLimiters({
      fullDashboard: { limit: 1, windowMs: 60_000, now: () => 0 },
    })

    await withFixture(async (fixture) => {
      const cookie = sessionCookieHeader(fixture.sessionKey)
      const allowed = await fixture.request("/api/dashboard", {
        headers: { Cookie: cookie },
      })
      const blocked = await fixture.request("/api/dashboard", {
        headers: { Cookie: cookie },
      })

      expect(allowed.status).toBe(200)
      expect(blocked.status).toBe(429)
      expect(header(blocked, "x-gcc-auth")).toBe("oauth")
      expect(header(blocked, "retry-after")).toBe("60")
      expect(JSON.parse(blocked.body)).toEqual({ message: RATE_LIMIT_MESSAGE })
      expect(fixture.calls.dashboards).toHaveLength(1)
    }, { rateLimiters })
  })

  it("rejects dashboard requests with revoked session ids", async () => {
    await withFixture(async (fixture) => {
      const session = createSession({ id: "revoked-dashboard-session" })
      revokeSessionId(session.id, session.issuedAt + SESSION_COOKIE_MAX_AGE * 1000)
      const response = await fixture.request("/api/dashboard", {
        headers: { Cookie: sessionCookieHeader(fixture.sessionKey, session) },
      })

      expect(response.status).toBe(401)
      expect(header(response, "x-gcc-auth")).toBe("oauth")
      expect(cookieValue(response.setCookies, SESSION_COOKIE)).toBe("")
      expect(response.setCookies[0]).toContain("Max-Age=0")
      expect(JSON.parse(response.body)).toEqual({
        message: "GitHub session expired. Sign in again.",
        loginUrl: "/auth/login",
      })
      expect(fixture.calls.dashboards).toHaveLength(0)
    })
  })

  it("clears the session cookie when the dashboard loader returns 401", async () => {
    const loadDashboard: HostedServerDependencies["loadDashboard"] = async () => {
      const error = new Error("Bad credentials") as Error & { status: number }
      error.status = 401
      throw error
    }

    await withFixture(async (fixture) => {
      const response = await fixture.request("/api/dashboard", {
        headers: { Cookie: sessionCookieHeader(fixture.sessionKey) },
      })

      expect(response.status).toBe(401)
      expect(header(response, "x-gcc-auth")).toBe("oauth")
      expect(cookieValue(response.setCookies, SESSION_COOKIE)).toBe("")
      expect(response.setCookies[0]).toContain("Max-Age=0")
      expect(JSON.parse(response.body)).toEqual({
        message: "GitHub session expired. Sign in again.",
        loginUrl: "/auth/login",
      })
    }, { loadDashboard })
  })

  it("rejects non-GET methods", async () => {
    await withFixture(async (fixture) => {
      const response = await fixture.request("/healthz", { method: "POST" })

      expect(response.status).toBe(405)
      expect(JSON.parse(response.body)).toEqual({ message: "Method not allowed." })
    })
  })
})
