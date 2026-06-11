// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest"

import { configureGithubDashboardForTests, getGithubDashboard } from "./github-dashboard"

type GhCall = {
  args: string[]
  endpoint: string
}

type GithubExecutorOptions = {
  repos?: unknown[]
  latestCommit?: unknown
  latestPullRequest?: unknown
}

function createGithubExecutor({
  repos = [],
  latestCommit = createRawCommit("Latest commit"),
  latestPullRequest = createRawPullRequest(),
}: GithubExecutorOptions = {}) {
  const calls: GhCall[] = []
  const executor = vi.fn(async (args: string[], endpoint: string) => {
    calls.push({ args, endpoint })
    await Promise.resolve()

    if (endpoint === "user") {
      return JSON.stringify({
        login: "jskoiz",
        name: "saburo",
        avatar_url: "https://example.com/avatar.png",
        html_url: "https://github.com/jskoiz",
      })
    }

    if (endpoint.startsWith("/user/repos?")) {
      return args.includes("--slurp") ? JSON.stringify([repos]) : JSON.stringify(repos)
    }

    if (endpoint === "graphql") {
      return JSON.stringify({
        data: {
          user: {
            repositories: {
              nodes: repos.map((repo) => ({
                nameWithOwner: repoNameWithOwner(repo),
                pullRequests: { totalCount: 0 },
                issues: { totalCount: 0 },
                defaultBranchRef: {
                  target: {
                    statusCheckRollup: { state: "SUCCESS" },
                  },
                },
              })),
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
            },
          },
        },
      })
    }

    if (endpoint.endsWith("/commits?per_page=1")) {
      return JSON.stringify(latestCommit ? [latestCommit] : [])
    }

    if (endpoint.endsWith("/pulls?state=all&sort=updated&direction=desc&per_page=1")) {
      return JSON.stringify(latestPullRequest ? [latestPullRequest] : [])
    }

    if (endpoint.endsWith("/actions/runs?per_page=3")) {
      return JSON.stringify({ workflow_runs: [] })
    }

    if (endpoint.startsWith("/search/issues?")) {
      return JSON.stringify({ items: [] })
    }

    if (endpoint.includes("/settings/billing/usage")) {
      return JSON.stringify({ usageItems: [] })
    }

    throw new Error(`Unhandled endpoint ${endpoint}`)
  })

  return { calls, executor }
}

function createRawRepo(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "active-repo",
    full_name: "jskoiz/active-repo",
    owner: { login: "jskoiz" },
    description: null,
    html_url: "https://github.com/jskoiz/active-repo",
    language: "TypeScript",
    visibility: "private",
    private: true,
    fork: false,
    archived: false,
    stargazers_count: 1,
    forks_count: 0,
    size: 128,
    default_branch: "main",
    pushed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    open_issues_count: 0,
    ...overrides,
  }
}

function createRawCommit(message: string) {
  return {
    sha: "abcdef1234567890",
    html_url: "https://github.com/jskoiz/active-repo/commit/abcdef1",
    commit: {
      message,
      author: {
        name: "saburo",
        date: "2026-06-10T12:00:00Z",
      },
    },
  }
}

function createRawPullRequest() {
  return {
    id: 100,
    number: 42,
    title: "Update repo dashboard",
    state: "open",
    html_url: "https://github.com/jskoiz/active-repo/pull/42",
    updated_at: "2026-06-10T13:00:00Z",
    created_at: "2026-06-10T11:00:00Z",
    user: { login: "jskoiz" },
  }
}

function repoNameWithOwner(repo: unknown) {
  return typeof repo === "object" && repo !== null && "full_name" in repo
    ? String(repo.full_name)
    : "jskoiz/active-repo"
}

afterEach(() => {
  configureGithubDashboardForTests(null)
})

describe("getGithubDashboard request coalescing", () => {
  it("shares simultaneous identical full loads", async () => {
    const { calls, executor } = createGithubExecutor()
    configureGithubDashboardForTests(executor)

    const first = getGithubDashboard({ force: true, scanLimit: 8 })
    const second = getGithubDashboard({ force: true, scanLimit: 8 })
    const [firstPayload, secondPayload] = await Promise.all([first, second])

    expect(firstPayload).toBe(secondPayload)
    expect(calls.filter((call) => call.endpoint === "user")).toHaveLength(1)
    expect(calls.filter((call) => call.endpoint.startsWith("/user/repos?"))).toHaveLength(1)
    expect(calls.filter((call) => call.endpoint === "graphql")).toHaveLength(1)
  })

  it("keeps quick mode bounded and skips billing when no full cache is available", async () => {
    const { calls, executor } = createGithubExecutor()
    configureGithubDashboardForTests(executor)

    const payload = await getGithubDashboard({ force: true, quick: true, scanLimit: 8 })
    const repoCall = calls.find((call) => call.endpoint.startsWith("/user/repos?"))

    expect(payload.detailLevel).toBe("quick")
    expect(payload.billing.available).toBe(false)
    expect(payload.billing.message).toBe("Billing loads with full dashboard details.")
    expect(calls.some((call) => call.endpoint.includes("/settings/billing/usage"))).toBe(false)
    expect(repoCall?.endpoint).toContain("per_page=8")
    expect(repoCall?.args).not.toContain("--paginate")
    expect(repoCall?.args).not.toContain("--slurp")
  })

  it("adds latest commit and pull request details directly to each repo", async () => {
    const { calls, executor } = createGithubExecutor({
      repos: [createRawRepo()],
      latestCommit: createRawCommit("Latest canonical commit"),
      latestPullRequest: createRawPullRequest(),
    })
    configureGithubDashboardForTests(executor)

    const payload = await getGithubDashboard({ force: true, scanLimit: 8 })
    const repo = payload.repos[0]

    expect(repo.latestCommit?.message).toBe("Latest canonical commit")
    expect(repo.latestPullRequest?.number).toBe(42)
    expect(payload.recentCommits.map((commit) => commit.repo)).toEqual(["jskoiz/active-repo"])
    expect(calls.some((call) => call.endpoint === "/repos/jskoiz/active-repo/commits?per_page=1")).toBe(true)
    expect(calls.some((call) => call.endpoint === "/repos/jskoiz/active-repo/pulls?state=all&sort=updated&direction=desc&per_page=1")).toBe(true)
  })

  it("reuses same-day per-repo detail cache across forced full refreshes", async () => {
    const { calls, executor } = createGithubExecutor({
      repos: [createRawRepo()],
      latestCommit: createRawCommit("Cached commit"),
      latestPullRequest: createRawPullRequest(),
    })
    configureGithubDashboardForTests(executor)

    await getGithubDashboard({ force: true, scanLimit: 8 })
    await getGithubDashboard({ force: true, scanLimit: 8 })

    expect(calls.filter((call) => call.endpoint === "/repos/jskoiz/active-repo/commits?per_page=1")).toHaveLength(1)
    expect(calls.filter((call) => call.endpoint === "/repos/jskoiz/active-repo/pulls?state=all&sort=updated&direction=desc&per_page=1")).toHaveLength(1)
  })

  it("skips uncached per-repo detail pulls for inactive repos", async () => {
    const { calls, executor } = createGithubExecutor({
      repos: [createRawRepo({
        pushed_at: "2000-01-01T00:00:00Z",
        updated_at: "2000-01-01T00:00:00Z",
      })],
    })
    configureGithubDashboardForTests(executor)

    const payload = await getGithubDashboard({ force: true, scanLimit: 8 })

    expect(payload.repos[0].latestCommit).toBeNull()
    expect(payload.repos[0].latestPullRequest).toBeNull()
    expect(calls.some((call) => call.endpoint.includes("/commits?per_page=1"))).toBe(false)
    expect(calls.some((call) => call.endpoint.includes("/pulls?state=all"))).toBe(false)
  })
})
