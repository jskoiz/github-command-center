import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import App from "./App"
import type { DashboardPayload, RepoSummary, WorkflowRunSummary } from "./types/github"

const CACHE_KEY = "github-command-center:dashboard-cache:v4:session"
const PUBLIC_CACHE_KEY = "github-command-center:dashboard-cache:v4:public:jskoiz"
const HIDDEN_REPOS_KEY = "github-command-center:hidden-repos:v2:session"

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

    expect(screen.getByRole("heading", { name: "An actual usable GitHub homepage." })).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "GitHub username" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "Open public view" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole("link", { name: "View demo" }).getAttribute("href")).toBe("/demo")
    expect(screen.getByRole("link", { name: /Sign in for full view/i }).getAttribute("href")).toBe("/auth/login")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("turns a valid username into a public profile form action", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn())

    render(<App />)

    const username = screen.getByRole("textbox", { name: "GitHub username" })
    await user.type(username, "jskoiz")

    expect((screen.getByRole("button", { name: "Open public view" }) as HTMLButtonElement).disabled).toBe(false)
    expect(username.closest("form")?.getAttribute("action")).toBe("/jskoiz")
  })

  it("renders the demo dashboard from mock data without API requests", async () => {
    window.history.replaceState(null, "", "/demo")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)

    expect(await screen.findByText("octocat")).toBeTruthy()
    expect(screen.getByRole("region", { name: "Repositories" }).querySelector('button[title="octocat/command-center"]')).toBeTruthy()
    expect(screen.getByText("Make public profile pages the default share target")).toBeTruthy()
    expect(screen.getByText("Add demo route and homepage link")).toBeTruthy()
    expect(screen.getByText("GitHub Actions Billing")).toBeTruthy()
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
    expect(await screen.findByText("Sign in for full view")).toBeTruthy()
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
})

describe("App attention strip actions", () => {
  it("reveals non-hidden inactive repos with open PRs and clears unrelated filters", async () => {
    const user = userEvent.setup()
    const activeRepo = createRepo("jskoiz/active-repo", { pushedAt: daysAgo(1) })
    const inactiveRepo = createRepo("jskoiz/inactive-pr-repo", {
      openPullRequests: 3,
      pushedAt: daysAgo(90),
    })
    const hiddenRepo = createRepo("jskoiz/hidden-pr-repo", {
      openPullRequests: 11,
      pushedAt: daysAgo(90),
    })
    hideRepos(hiddenRepo)
    mockDashboard(createPayload({ repos: [activeRepo, inactiveRepo, hiddenRepo] }))

    render(<App />)

    expect(await findRepoButton("active-repo")).toBeTruthy()
    expect(queryRepoButton("inactive-pr-repo")).toBeNull()
    const search = screen.getByRole("textbox", { name: "Search repositories" }) as HTMLInputElement
    await user.type(search, "active-repo")

    await user.click(screen.getByRole("button", { name: /3\s*open PRs.*1 repo/i }))

    expect(search.value).toBe("")
    expect(await findRepoButton("inactive-pr-repo")).toBeTruthy()
    expect(queryRepoButton("hidden-pr-repo")).toBeNull()
    expect(repoNames()).toEqual(["inactive-pr-repo", "active-repo"])
  })

  it("reveals non-hidden inactive repos with open issues and clears unrelated filters", async () => {
    const user = userEvent.setup()
    const activeRepo = createRepo("jskoiz/active-repo", { pushedAt: daysAgo(1) })
    const inactiveRepo = createRepo("jskoiz/inactive-issue-repo", {
      openIssues: 4,
      pushedAt: daysAgo(90),
    })
    const hiddenRepo = createRepo("jskoiz/hidden-issue-repo", {
      openIssues: 9,
      pushedAt: daysAgo(90),
    })
    hideRepos(hiddenRepo)
    mockDashboard(createPayload({ repos: [activeRepo, inactiveRepo, hiddenRepo] }))

    render(<App />)

    expect(await findRepoButton("active-repo")).toBeTruthy()
    expect(queryRepoButton("inactive-issue-repo")).toBeNull()
    const search = screen.getByRole("textbox", { name: "Search repositories" }) as HTMLInputElement
    await user.type(search, "active-repo")

    await user.click(screen.getByRole("button", { name: /4\s*open issues.*1 repo/i }))

    expect(search.value).toBe("")
    expect(await findRepoButton("inactive-issue-repo")).toBeTruthy()
    expect(queryRepoButton("hidden-issue-repo")).toBeNull()
    expect(repoNames()).toEqual(["inactive-issue-repo", "active-repo"])
  })

  it("keeps the failing workflow action scoped to failures after resetting hidden and active filters", async () => {
    const user = userEvent.setup()
    const activeRepo = createRepo("jskoiz/active-repo", { pushedAt: daysAgo(1) })
    const failingRun = createWorkflowRun("jskoiz/inactive-failing-repo")
    const inactiveFailingRepo = createRepo("jskoiz/inactive-failing-repo", {
      checkState: "failure",
      latestRun: failingRun,
      pushedAt: daysAgo(90),
    })
    const hiddenRun = createWorkflowRun("jskoiz/hidden-failing-repo", { id: 42 })
    const hiddenRepo = createRepo("jskoiz/hidden-failing-repo", {
      checkState: "failure",
      latestRun: hiddenRun,
      pushedAt: daysAgo(90),
    })
    hideRepos(hiddenRepo)
    mockDashboard(createPayload({
      repos: [activeRepo, inactiveFailingRepo, hiddenRepo],
      ciRuns: [failingRun, hiddenRun],
    }))

    render(<App />)

    expect(await findRepoButton("active-repo")).toBeTruthy()
    expect(queryRepoButton("inactive-failing-repo")).toBeNull()
    const search = screen.getByRole("textbox", { name: "Search repositories" }) as HTMLInputElement
    await user.type(search, "active-repo")

    await user.click(screen.getByRole("button", { name: /1\s*repo with failing CI/i }))

    expect(search.value).toBe("")
    expect(await findRepoButton("inactive-failing-repo")).toBeTruthy()
    expect(queryRepoButton("active-repo")).toBeNull()
    expect(queryRepoButton("hidden-failing-repo")).toBeNull()
  })

  it("renders unknown PR and issue totals as unavailable instead of zero", async () => {
    const repo = createRepo("jskoiz/unknown-count-repo", {
      openPullRequests: null,
      openIssues: null,
      pushedAt: daysAgo(1),
    })
    mockDashboard(createPayload({ repos: [repo] }))

    render(<App />)

    expect(await findRepoButton("unknown-count-repo")).toBeTruthy()
    expect(screen.getAllByText("n/a")).toHaveLength(2)
    expect(screen.getByText("open PRs · 1 unknown")).toBeTruthy()
    expect(screen.getByText("open issues · 1 unknown")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /open PRs/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /open issues/i })).toBeNull()
  })
})

function writeCache(payload: DashboardPayload) {
  window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({
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

function mockDashboard(payload: DashboardPayload) {
  window.history.replaceState(null, "", "/dashboard")
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(payload, 200, "oauth")))
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

function createWorkflowRun(repo: string, overrides: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  const id = Math.abs(hashString(`${repo}:ci`))

  return {
    id,
    repo,
    name: "CI",
    event: "push",
    status: "completed",
    conclusion: "failure",
    branch: "main",
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    runStartedAt: daysAgo(1),
    durationSeconds: 60,
    url: `https://github.com/${repo}/actions/runs/${id}`,
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

function hideRepos(...repos: RepoSummary[]) {
  window.localStorage.setItem(HIDDEN_REPOS_KEY, JSON.stringify(repos.map((repo) => repo.id)))
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

function repoNames() {
  return within(repoSidebar())
    .getAllByRole("button")
    .filter((button) => button.getAttribute("title")?.startsWith("jskoiz/"))
    .map((button) => button.getAttribute("title")?.split("/")[1])
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function hashString(value: string) {
  let hash = 0
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0
  }
  return hash
}
