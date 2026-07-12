import { httpServerHandler } from "cloudflare:node"

import { createHostedAppServer } from "./app-server.ts"

const PORT = 3000
const BASE_URL = process.env.BASE_URL || "https://github-command-center.invalid"
const PUBLIC_MODE_SESSION_SECRET = "public-mode-has-no-oauth-sessions"

const staticFilesUnavailable = async (): Promise<never> => {
  throw new Error("Cloudflare serves static assets before the Worker runtime.")
}

const server = createHostedAppServer({
  baseUrl: BASE_URL,
  sessionSecret: PUBLIC_MODE_SESSION_SECRET,
  trustProxy: true,
  distDir: "/worker-assets",
  readFile: staticFilesUnavailable,
  stat: staticFilesUnavailable,
})

server.listen(PORT)

export default httpServerHandler({ port: PORT })
