import { randomBytes } from "node:crypto"
import { createServer } from "node:http"

import { getGithubDashboard, getPublicGithubDashboard } from "./github-dashboard.ts"
import { exchangeOAuthCode, fetchViewerLogin, revokeOAuthToken } from "./github-client.ts"
import { createHostedRequestHandler, type HostedServerDependencies } from "./hosted-server.ts"
import { createHostedRateLimiters } from "./rate-limit.ts"
import { deriveSessionKey } from "./session.ts"

type HostedStaticFiles = Pick<HostedServerDependencies, "readFile" | "stat">

type HostedAppServerOptions = HostedStaticFiles & {
  baseUrl: string
  clientId?: string
  clientSecret?: string
  distDir: string
  sessionSecret?: string
  trustProxy?: boolean
}

export function createHostedAppServer(options: HostedAppServerOptions) {
  const clientId = options.clientId ?? ""
  const clientSecret = options.clientSecret ?? ""
  const oauthConfigured = Boolean(clientId && clientSecret)

  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be configured together.")
  }
  if (oauthConfigured && !options.sessionSecret) {
    throw new Error("Missing required environment variable SESSION_SECRET for OAuth sessions. See .env.example.")
  }

  const sessionSecret = options.sessionSecret || randomBytes(32).toString("hex")
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32")
  }
  if (!process.env.GITHUB_PUBLIC_TOKEN) {
    console.warn("GITHUB_PUBLIC_TOKEN is not set; hosted public dashboards will use GitHub's anonymous REST quota.")
  }

  const baseUrl = options.baseUrl.replace(/\/$/, "")

  return createServer(createHostedRequestHandler({
    baseUrl,
    clientId,
    clientSecret,
    distDir: options.distDir,
    sessionKey: deriveSessionKey(sessionSecret),
    secureCookies: baseUrl.startsWith("https://"),
    trustProxy: options.trustProxy,
    exchangeOAuthCode,
    fetchViewerLogin,
    revokeOAuthToken,
    rateLimiters: createHostedRateLimiters(),
    loadDashboard: getGithubDashboard,
    loadPublicDashboard: getPublicGithubDashboard,
    readFile: options.readFile,
    stat: options.stat,
    logger: console,
  }))
}
