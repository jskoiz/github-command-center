import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"
import { getGithubDashboard, getPublicGithubDashboard } from "./server/github-dashboard"
import { isLocalDashboardRequest, LOCAL_DASHBOARD_ONLY_MESSAGE } from "./server/local-access"

function installGithubDashboardApi(server: ViteDevServer | PreviewServer) {
  server.middlewares.use("/api/dashboard", async (req, res, next) => {
    if (req.method !== "GET") {
      next()
      return
    }

    if (!isLocalDashboardRequest(req)) {
      res.statusCode = 403
      res.setHeader("Content-Type", "application/json; charset=utf-8")
      res.end(JSON.stringify({ message: LOCAL_DASHBOARD_ONLY_MESSAGE }))
      return
    }

    try {
      const url = new URL(req.url ?? "/", "http://localhost")
      const publicUsername = publicDashboardUsernameFromMountedPath(url.pathname)
      const options = {
        force: url.searchParams.get("refresh") === "1",
        quick: url.searchParams.get("quick") === "1",
        scanLimit: Number(url.searchParams.get("scanLimit") ?? 24),
      }
      const payload = publicUsername
        ? await getPublicGithubDashboard(publicUsername, options)
        : await getGithubDashboard(options)

      res.statusCode = 200
      if (publicUsername) res.setHeader("x-gcc-auth", "public")
      res.setHeader("Content-Type", "application/json; charset=utf-8")
      res.end(JSON.stringify(payload))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dashboard request failed."
      res.statusCode = 500
      res.setHeader("Content-Type", "application/json; charset=utf-8")
      res.end(JSON.stringify({ message }))
    }
  })
}

function publicDashboardUsernameFromMountedPath(pathname: string): string | null {
  const match = pathname.match(/^\/([^/?#]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

function githubDashboardApi(): Plugin {
  return {
    name: "github-dashboard-api",
    configureServer(server: ViteDevServer) {
      installGithubDashboardApi(server)
    },
    configurePreviewServer(server: PreviewServer) {
      installGithubDashboardApi(server)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), githubDashboardApi()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
