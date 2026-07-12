import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"

import { createHostedAppServer } from "./app-server.ts"

const PORT = Number(process.env.PORT || 3000)
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "")
const CLIENT_ID = process.env.GITHUB_CLIENT_ID || ""
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || ""
const DIST_DIR = process.env.GCC_DIST_DIR || join(process.cwd(), "dist")
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true"

const server = createHostedAppServer({
  baseUrl: BASE_URL,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  distDir: DIST_DIR,
  sessionSecret: process.env.SESSION_SECRET,
  trustProxy: TRUST_PROXY,
  readFile,
  stat,
})

server.listen(PORT, () => {
  console.log(`github-command-center listening on ${BASE_URL} (port ${PORT})`)
})
