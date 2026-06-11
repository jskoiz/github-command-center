import { randomBytes } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { createServer } from "node:http"
import { join } from "node:path"

import { getGithubDashboard, getPublicGithubDashboard } from "./github-dashboard.ts"
import { exchangeOAuthCode, fetchViewerLogin, revokeOAuthToken } from "./github-client.ts"
import { createHostedRequestHandler } from "./hosted-server.ts"
import { createHostedRateLimiters } from "./rate-limit.ts"
import { deriveSessionKey } from "./session.ts"

const PORT = Number(process.env.PORT || 3000)
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "")
const CLIENT_ID = process.env.GITHUB_CLIENT_ID || ""
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || ""
const OAUTH_CONFIGURED = Boolean(CLIENT_ID && CLIENT_SECRET)
const SESSION_SECRET = process.env.SESSION_SECRET || (OAUTH_CONFIGURED ? "" : randomBytes(32).toString("hex"))
const DIST_DIR = process.env.GCC_DIST_DIR || join(process.cwd(), "dist")
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true"

if (Boolean(CLIENT_ID) !== Boolean(CLIENT_SECRET)) {
  console.error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be configured together.")
  process.exit(1)
}
if (OAUTH_CONFIGURED && !process.env.SESSION_SECRET) {
  console.error("Missing required environment variable SESSION_SECRET for OAuth sessions. See .env.example.")
  process.exit(1)
}
if (SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32")
  process.exit(1)
}

const sessionKey = deriveSessionKey(SESSION_SECRET)
const secureCookies = BASE_URL.startsWith("https://")

const server = createServer(createHostedRequestHandler({
  baseUrl: BASE_URL,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  distDir: DIST_DIR,
  sessionKey,
  secureCookies,
  trustProxy: TRUST_PROXY,
  exchangeOAuthCode,
  fetchViewerLogin,
  revokeOAuthToken,
  rateLimiters: createHostedRateLimiters(),
  loadDashboard: getGithubDashboard,
  loadPublicDashboard: getPublicGithubDashboard,
  readFile,
  stat,
  logger: console,
}))

server.listen(PORT, () => {
  console.log(`github-command-center listening on ${BASE_URL} (port ${PORT})`)
})
