import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import App from "./App"
import type { DashboardPayload, RepoSummary } from "./types/github"

const CACHE_KEY = "github-command-center:dashboard-cache:v4:session"
const PUBLIC_CACHE_KEY = "github-command-center:dashboard-cache:v4:public:jskoiz"

beforeEach(() => {
  window.history.replaceState(null, "", "/")
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("App dashboard cache auth", () => {
  it("renders the minimal root landing without loading a dashboard", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)

    expect(screen.getByRole("heading", { name: "A better GitHub homepage." })).toBeTruthy()
    expect(screen.getByText("One view of everything: PRs, issues, commits, CI, and Actions billing across all your repos. No login needed unless you want to see the private stuff. Open source.")).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "GitHub username" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "Open public view" }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole("link", { name: "/demo" }).getAttribute("href")).toBe("/demo")
    expect(screen.getByText("live with sample data")).toBeTruthy()
    expect(screen.queryByText(/no GitHub calls/i)).toBeNull()
    expect(screen.getByRole("link", { name: "sign in with GitHub" }).getAttribute("href")).toBe("/auth/login")
    expect(screen.getByTitle("Live demo dashboard").getAttribute("src")).toBe("/demo?theme=light&preview=stripless")
    expect(screen.getByText("Public view, no login")).toBeTruthy()
    expect(screen.getByText("Self-host or run local")).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("syncs the homepage theme into the embedded demo route", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn())

    render(<App />)

    await user.click(screen.getByRole("button", { name: "Toggle theme" }))

    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true))
    expect(screen.getByTitle("Live demo dashboard").getAttribute("src")).toBe("/demo?theme=dark&preview=stripless")
  })

  it("turns a valid username into a public profile form action", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn())

    render(<App />)

    const username = screen.getByRole("textbox", { name: "GitHub username" })
    await user.type(username, "jskoiz")

    expect(username.closest("form")?.getAttribute("action")).toBe("/jskoiz")
  })

  it("renders the demo dashboard from mock data without API requests", async () => {
    window.history.replaceState(null, "", "/demo")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)

    expect(await screen.findByText("okgithub")).toBeTruthy()
    expect(screen.getByRole("region", { name: "Repositories" }).querySelector('button[title="okgithub/command-center"]')).toBeTruthy()
    expect(screen.getByText("Make public profile pages the default share target")).toBeTruthy()
    expect(screen.getByText("Add demo route and homepage link")).toBeTruthy()
    expect(screen.getByText("GitHub Actions Billing")).toBeTruthy()
    expect(screen.queryByText(/failing workflows/i)).toBeNull()
    expect(screen.queryByText(/open PRs · \d+ repos/i)).toBeNull()
    expect(screen.queryByText(/open issues · \d+ repos/i)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps demo dashboard links inert", async () => {
    window.history.replaceState(null, "", "/demo")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)

    const pullRequestLink = await screen.findByRole("link", { name: /Make public profile pages the default share target/i })
    const click = new MouseEvent("click", { bubbles: true, cancelable: true })

    expect(pullRequestLink.dispatchEvent(click)).toBe(false)
    expect(click.defaultPrevented).toBe(true)
    expect(window.location.pathname).toBe("/demo")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps demo dashboard tabs interactive without API requests", async () => {
    window.history.replaceState(null, "", "/demo")
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)

    await user.click(await screen.findByRole("button", { name: "Draft" }))

    expect(screen.getByText("Tighten feed header wrapping on medium screens")).toBeTruthy()
    expect(screen.queryByText("Make public profile pages the default share target")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not render a fresh cache when the current session is unauthorized", async () => {
    window.history.replaceState(null, "", "/dashboard")
    writeCache(createPayload({
      viewer: createViewer("old-user"),
      repos: [createRepo("old-user/private-repo")],
    }))
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Sign in" }, 401, "oauth")))

    render(<App />)

    expect(screen.queryByText("private-repo")).toBeNull()
    expect(await screen.findByText("sign in with GitHub")).toBeTruthy()
    expect(screen.queryByText("private-repo")).toBeNull()
    expect(window.sessionStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it("uses a fresh cache only after the quick auth check matches the cached viewer", async () => {
    window.history.replaceState(null, "", "/dashboard")
    writeCache(createPayload({
      viewer: createViewer("jskoiz"),
      repos: [createRepo("jskoiz/cached-repo")],
    }))
    const fetchMock = vi.fn(async () => jsonResponse(createPayload({
      detailLevel: "quick",
      viewer: createViewer("jskoiz"),
      repos: [],
    }), 200, "oauth"))
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)

    expect(await screen.findByText("cached-repo")).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard?quick=1", expect.any(Object))
  })

  it("replaces a fresh cache when the quick auth check returns another viewer", async () => {
    window.history.replaceState(null, "", "/dashboard")
    writeCache(createPayload({
      viewer: createViewer("old-user"),
      repos: [createRepo("old-user/private-repo")],
    }))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(createPayload({
        detailLevel: "quick",
        viewer: createViewer("new-user"),
        repos: [createRepo("new-user/quick-repo")],
      }), 200, "oauth"))
      .mockResolvedValueOnce(jsonResponse(createPayload({
        viewer: createViewer("new-user"),
        repos: [createRepo("new-user/full-repo")],
      }), 200, "oauth"))
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)

    expect(screen.queryByText("private-repo")).toBeNull()
    expect(await screen.findByText("full-repo")).toBeTruthy()
    expect(screen.queryByText("private-repo")).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("stops showing detail updates when the full dashboard request fails", async () => {
    window.history.replaceState(null, "", "/dashboard")
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(createPayload({ detailLevel: "quick" }), 200, "oauth"))
      .mockResolvedValueOnce(jsonResponse({ message: "Full dashboard unavailable." }, 500, "oauth"))
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)

    expect(await screen.findByText("Dashboard failed")).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByText("Updating details...")).toBeNull()
    expect(screen.queryByText("Workflow details updating")).toBeNull()
    expect(screen.getByText("No recent pull requests")).toBeTruthy()
  })

  it("loads username paths through the public dashboard API and cache", async () => {
    window.history.replaceState(null, "", "/jskoiz")
    const payload = createPayload({
      viewer: createViewer("jskoiz"),
      repos: [createRepo("jskoiz/public-repo", { visibility: "public", isPrivate: false })],
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ...payload, detailLevel: "quick", repos: [] }, 200, "public"))
      .mockResolvedValueOnce(jsonResponse(payload, 200, "public"))
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)

    expect(await findRepoButton("public-repo")).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/jskoiz?quick=1", expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/jskoiz", expect.any(Object))
    expect(window.sessionStorage.getItem(PUBLIC_CACHE_KEY)).toBeTruthy()
    expect(window.sessionStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it("shows sign-in recovery when a public dashboard hits GitHub quota without cache", async () => {
    window.history.replaceState(null, "", "/jskoiz")
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      code: "github_rate_limit",
      message: "GitHub rate limit reached for public dashboards.",
      loginUrl: "/auth/login",
      retryAfterSeconds: 60,
    }, 403, "public"))
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)

    expect(await screen.findByText("GitHub rate limit reached")).toBeTruthy()
    expect(screen.getByText("GitHub rate limit reached for public dashboards.")).toBeTruthy()
    expect(screen.getByText("Try again in about 1 minute.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Sign in with GitHub" }).getAttribute("href")).toBe("/auth/login")
    expect(screen.queryByRole("region", { name: "Repositories" })).toBeNull()
  })

  it("renders matching public cache as stale data when GitHub quota is exhausted", async () => {
    window.history.replaceState(null, "", "/jskoiz")
    writeCache(createPayload({
      viewer: createViewer("jskoiz"),
      repos: [createRepo("jskoiz/public-repo", { visibility: "public", isPrivate: false })],
    }), PUBLIC_CACHE_KEY)
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      code: "github_rate_limit",
      message: "GitHub rate limit reached for public dashboards.",
      loginUrl: "/auth/login",
    }, 403, "public"))
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)

    expect(await findRepoButton("public-repo")).toBeTruthy()
    expect(screen.getByText("GitHub rate limit reached")).toBeTruthy()
    expect(screen.getByText("Showing cached data while GitHub public data is temporarily unavailable.")).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

function writeCache(payload: DashboardPayload, key = CACHE_KEY) {
  window.sessionStorage.setItem(key, JSON.stringify({
    cachedAt: Date.now(),
    payload,
  }))
}

function jsonResponse(payload: unknown, status = 200, auth: "oauth" | "public" | false = false) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { "x-gcc-auth": auth } : {}),
    },
  })
}

function createViewer(login: string) {
  return {
    login,
    name: login,
    avatarUrl: "https://example.com/avatar.png",
    profileUrl: `https://github.com/${login}`,
  }
}

function createRepo(fullName: string, overrides: Partial<RepoSummary> = {}): RepoSummary {
  const [owner, name] = fullName.split("/")

  return {
    id: Math.abs(hashString(fullName)),
    name,
    fullName,
    owner,
    description: null,
    url: `https://github.com/${fullName}`,
    language: "TypeScript",
    visibility: "private",
    isPrivate: true,
    isFork: false,
    isArchived: false,
    stars: 0,
    forks: 0,
    sizeKb: 128,
    defaultBranch: "main",
    pushedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    openIssues: 0,
    openPullRequests: 0,
    checkState: null,
    latestCommit: null,
    latestPullRequest: null,
    latestRun: null,
    ...overrides,
  }
}

function createPayload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    generatedAt: new Date().toISOString(),
    detailLevel: "full",
    scanLimit: 24,
    viewer: createViewer("jskoiz"),
    repos: [],
    recentCommits: [],
    pullRequests: [],
    issues: [],
    ciRuns: [],
    billing: {
      available: true,
      year: 2026,
      month: 6,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
      unitTotals: [],
      skus: [],
      repositories: [],
    },
    warnings: [],
    ...overrides,
  }
}

function repoSidebar() {
  return screen.getByRole("region", { name: "Repositories" })
}

function findRepoButton(name: string) {
  return waitFor(() => {
    const button = queryRepoButton(name)
    expect(button).not.toBeNull()
    return button
  })
}

function queryRepoButton(name: string) {
  return repoSidebar().querySelector(`button[title="jskoiz/${name}"]`)
}

function hashString(value: string) {
  let hash = 0
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0
  }
  return hash
}
