// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest"

import { configureGithubDashboardForTests, getGithubDashboard, getPublicGithubDashboard } from "./github-dashboard"
import { PaginationLimitError } from "./github-client"

type GhCall = {
  args: string[]
  endpoint: string
}

type GithubExecutorOptions = {
  repos?: unknown[]
  reposError?: unknown
  graphqlError?: unknown
  graphqlPageSize?: number
  latestCommit?: unknown
  latestPullRequest?: unknown
  latestCommitFailures?: unknown[]
  latestPullRequestFailures?: unknown[]
  workflowRunsByRepo?: Record<string, unknown[]>
  workflowRunFailuresByRepo?: Record<string, unknown>
}

function createGithubExecutor({
  repos = [],
  reposError,
  graphqlError,
  graphqlPageSize,
  latestCommit = createRawCommit("Latest commit"),
  latestPullRequest = createRawPullRequest(),
  latestCommitFailures = [],
  latestPullRequestFailures = [],
  workflowRunsByRepo = {},
  workflowRunFailuresByRepo = {},
}: GithubExecutorOptions = {}) {
  const calls: GhCall[] = []
  let graphqlPage = 0
  let latestCommitAttempt = 0
  let latestPullRequestAttempt = 0
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
      if (reposError) throw reposError
      return args.includes("--slurp") ? JSON.stringify([repos]) : JSON.stringify(repos)
    }

    if (endpoint === "graphql") {
      if (graphqlError) throw graphqlError
      const pageIndex = graphqlPage
      graphqlPage += 1
      const pageRepos = typeof graphqlPageSize === "number"
        ? repos.slice(pageIndex * graphqlPageSize, (pageIndex + 1) * graphqlPageSize)
        : repos
      const hasNextPage = typeof graphqlPageSize === "number"
        ? (pageIndex + 1) * graphqlPageSize < repos.length
        : false

      return JSON.stringify({
        data: {
          user: {
            repositories: {
              nodes: pageRepos.map((repo) => ({
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
                hasNextPage,
                endCursor: hasNextPage ? `cursor-${pageIndex + 1}` : null,
              },
            },
          },
        },
      })
    }

    if (endpoint.endsWith("/commits?per_page=1")) {
      const failure = latestCommitFailures[latestCommitAttempt]
      latestCommitAttempt += 1
      if (failure !== undefined) throw failure
      return JSON.stringify(latestCommit ? [latestCommit] : [])
    }

    if (endpoint.endsWith("/pulls?state=all&sort=updated&direction=desc&per_page=1")) {
      const failure = latestPullRequestFailures[latestPullRequestAttempt]
      latestPullRequestAttempt += 1
      if (failure !== undefined) throw failure
      return JSON.stringify(latestPullRequest ? [latestPullRequest] : [])
    }

    const workflowRunsEndpoint = endpoint.match(/^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\?per_page=3$/)
    if (workflowRunsEndpoint) {
      const fullName = `${decodeURIComponent(workflowRunsEndpoint[1])}/${decodeURIComponent(workflowRunsEndpoint[2])}`
      if (fullName in workflowRunFailuresByRepo) {
        throw workflowRunFailuresByRepo[fullName]
      }
      return JSON.stringify({ workflow_runs: workflowRunsByRepo[fullName] ?? [] })
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

function createRawRepos(count: number, overrides: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, index) => {
    const repoNumber = index + 1
    return createRawRepo({
      id: repoNumber,
      name: `repo-${repoNumber}`,
      full_name: `jskoiz/repo-${repoNumber}`,
      html_url: `https://github.com/jskoiz/repo-${repoNumber}`,
      pushed_at: "2000-01-01T00:00:00Z",
      updated_at: "2000-01-01T00:00:00Z",
      ...overrides,
    })
  })
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

function createRawWorkflowRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    name: "CI",
    event: "push",
    status: "completed",
    conclusion: "success",
    head_branch: "main",
    created_at: "2026-06-10T14:00:00Z",
    updated_at: "2026-06-10T14:05:00Z",
    run_started_at: "2026-06-10T14:01:00Z",
    html_url: "https://github.com/jskoiz/active-repo/actions/runs/900",
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  })
}

function repoNameWithOwner(repo: unknown) {
  return typeof repo === "object" && repo !== null && "full_name" in repo
    ? String(repo.full_name)
    : "jskoiz/active-repo"
}

const ORIGINAL_GITHUB_ENV = {
  GITHUB_PUBLIC_TOKEN: process.env.GITHUB_PUBLIC_TOKEN,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
}

afterEach(() => {
  configureGithubDashboardForTests(null)
  vi.unstubAllGlobals()
  restoreEnv("GITHUB_PUBLIC_TOKEN", ORIGINAL_GITHUB_ENV.GITHUB_PUBLIC_TOKEN)
  restoreEnv("GITHUB_TOKEN", ORIGINAL_GITHUB_ENV.GITHUB_TOKEN)
  restoreEnv("GH_TOKEN", ORIGINAL_GITHUB_ENV.GH_TOKEN)
})

function restoreEnv(name: keyof typeof ORIGINAL_GITHUB_ENV, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

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

  it("retries a one-sided repo-detail failure while preserving the successful field", async () => {
    const secretError = "Commit request failed with token ghp_repo_detail_secret"
    const { calls, executor } = createGithubExecutor({
      repos: [createRawRepo()],
      latestCommit: createRawCommit("Recovered commit"),
      latestPullRequest: createRawPullRequest(),
      latestCommitFailures: [new Error(secretError)],
    })
    configureGithubDashboardForTests(executor)

    const partial = await getGithubDashboard({ force: true, scanLimit: 8 })
    const recovered = await getGithubDashboard({ force: true, scanLimit: 8 })
    const warningText = partial.warnings.map((warning) => warning.message).join("\n")

    expect(partial.repos[0].latestCommit).toBeNull()
    expect(partial.repos[0].latestPullRequest?.number).toBe(42)
    expect(partial.warnings).toContainEqual({
      area: "repo details",
      message: "Latest commit or pull request refresh failed for 1 repositories.",
    })
    expect(warningText).not.toContain(secretError)
    expect(warningText).not.toContain("ghp_repo_detail_secret")
    expect(recovered.repos[0].latestCommit?.message).toBe("Recovered commit")
    expect(recovered.repos[0].latestPullRequest?.number).toBe(42)
    expect(calls.filter((call) => call.endpoint.endsWith("/commits?per_page=1"))).toHaveLength(2)
    expect(calls.filter((call) => call.endpoint.endsWith("/pulls?state=all&sort=updated&direction=desc&per_page=1"))).toHaveLength(2)
  })

  it("retries two-sided repo-detail failures and recovers both fields", async () => {
    const commitSecretError = "Commit request failed with token ghp_commit_secret"
    const pullRequestSecretError = "Pull request failed with token ghp_pull_secret"
    const { calls, executor } = createGithubExecutor({
      repos: [createRawRepo()],
      latestCommit: createRawCommit("Recovered commit"),
      latestPullRequest: createRawPullRequest(),
      latestCommitFailures: [new Error(commitSecretError)],
      latestPullRequestFailures: [new Error(pullRequestSecretError)],
    })
    configureGithubDashboardForTests(executor)

    const failed = await getGithubDashboard({ force: true, scanLimit: 8 })
    const recovered = await getGithubDashboard({ force: true, scanLimit: 8 })
    const warningText = failed.warnings.map((warning) => warning.message).join("\n")

    expect(failed.repos[0].latestCommit).toBeNull()
    expect(failed.repos[0].latestPullRequest).toBeNull()
    expect(failed.warnings).toContainEqual({
      area: "repo details",
      message: "Latest commit or pull request refresh failed for 1 repositories.",
    })
    expect(warningText).not.toContain(commitSecretError)
    expect(warningText).not.toContain(pullRequestSecretError)
    expect(warningText).not.toContain("ghp_commit_secret")
    expect(warningText).not.toContain("ghp_pull_secret")
    expect(recovered.repos[0].latestCommit?.message).toBe("Recovered commit")
    expect(recovered.repos[0].latestPullRequest?.number).toBe(42)
    expect(calls.filter((call) => call.endpoint.endsWith("/commits?per_page=1"))).toHaveLength(2)
    expect(calls.filter((call) => call.endpoint.endsWith("/pulls?state=all&sort=updated&direction=desc&per_page=1"))).toHaveLength(2)
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

describe("getPublicGithubDashboard", () => {
  it("loads public profile quick data without an OAuth Authorization header", async () => {
    delete process.env.GITHUB_PUBLIC_TOKEN
    process.env.GITHUB_TOKEN = "ghp_not_for_public_profiles"
    process.env.GH_TOKEN = "ghp_not_for_public_profiles"
    const fetchMock = vi.fn(async (...[input]: [string | URL | Request, RequestInit?]) => {
      const url = input.toString()
      if (url.endsWith("/users/jskoiz")) {
        return jsonResponse({
          login: "jskoiz",
          name: "saburo",
          avatar_url: "https://example.com/avatar.png",
          html_url: "https://github.com/jskoiz",
        })
      }
      if (url.endsWith("/users/jskoiz/repos?per_page=8&sort=pushed&type=owner")) {
        return jsonResponse([createRawRepo({
          visibility: "public",
          private: false,
        })])
      }
      throw new Error(`Unhandled fetch ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const payload = await getPublicGithubDashboard("jskoiz", { force: true, quick: true, scanLimit: 8 })

    expect(payload.viewer.login).toBe("jskoiz")
    expect(payload.repos).toHaveLength(1)
    expect(payload.repos[0]).toMatchObject({
      fullName: "jskoiz/active-repo",
      visibility: "public",
      isPrivate: false,
    })
    expect(payload.billing.available).toBe(false)
    expect(fetchMock.mock.calls.every(([, init]) => {
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined
      return headers?.Authorization === undefined
    })).toBe(true)
  })

  it("uses only GITHUB_PUBLIC_TOKEN for hosted public profile requests", async () => {
    process.env.GITHUB_PUBLIC_TOKEN = "ghp_public_rate_token"
    process.env.GITHUB_TOKEN = "ghp_not_for_public_profiles"
    process.env.GH_TOKEN = "ghp_not_for_public_profiles"
    const fetchMock = vi.fn(async (...[input]: [string | URL | Request, RequestInit?]) => {
      const url = input.toString()
      if (url.endsWith("/users/jskoiz")) {
        return jsonResponse({
          login: "jskoiz",
          name: "saburo",
          avatar_url: "https://example.com/avatar.png",
          html_url: "https://github.com/jskoiz",
        })
      }
      if (url.endsWith("/users/jskoiz/repos?per_page=8&sort=pushed&type=owner")) {
        return jsonResponse([createRawRepo({
          visibility: "public",
          private: false,
        })])
      }
      throw new Error(`Unhandled fetch ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await getPublicGithubDashboard("jskoiz", { force: true, quick: true, scanLimit: 8 })

    expect(fetchMock.mock.calls.every(([, init]) => {
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined
      return headers?.Authorization === "Bearer ghp_public_rate_token"
    })).toBe(true)
  })
})

describe("getGithubDashboard pagination completeness", () => {
  it("keeps partial repo pages when hosted REST pagination reaches the cap", async () => {
    const repos = [
      createRawRepo(),
      createRawRepo({
        id: 2,
        name: "partial-repo",
        full_name: "jskoiz/partial-repo",
        html_url: "https://github.com/jskoiz/partial-repo",
      }),
    ]
    const { executor } = createGithubExecutor({
      repos,
      reposError: new PaginationLimitError("/user/repos", 2, [[repos[0]], [repos[1]]]),
    })
    configureGithubDashboardForTests(executor)

    const payload = await getGithubDashboard({ force: true, scanLimit: 8 })

    expect(payload.repos.map((repo) => repo.fullName)).toEqual(["jskoiz/active-repo", "jskoiz/partial-repo"])
    expect(payload.warnings).toContainEqual({
      area: "repos",
      message: "Repository list reached the hosted pagination limit; dashboard data is partial.",
    })
  })

  it("fetches enough GraphQL count pages to cover the repo list", async () => {
    const repos = createRawRepos(201)
    const { calls, executor } = createGithubExecutor({
      repos,
      graphqlPageSize: 50,
    })
    configureGithubDashboardForTests(executor)

    await getGithubDashboard({ force: true, scanLimit: 8 })

    expect(calls.filter((call) => call.endpoint === "graphql")).toHaveLength(5)
  })

  it("keeps small account GraphQL count enrichment to one page", async () => {
    const repos = createRawRepos(2)
    const { calls, executor } = createGithubExecutor({
      repos,
      graphqlPageSize: 50,
    })
    configureGithubDashboardForTests(executor)

    await getGithubDashboard({ force: true, scanLimit: 8 })

    expect(calls.filter((call) => call.endpoint === "graphql")).toHaveLength(1)
  })

  it("warns and leaves counts unknown when the GraphQL repo-count cap is reached", async () => {
    const repos = createRawRepos(1001)
    const { calls, executor } = createGithubExecutor({
      repos,
      graphqlPageSize: 50,
    })
    configureGithubDashboardForTests(executor)

    const payload = await getGithubDashboard({ force: true, scanLimit: 8 })
    const lastRepo = payload.repos.find((repo) => repo.fullName === "jskoiz/repo-1001")

    expect(calls.filter((call) => call.endpoint === "graphql")).toHaveLength(20)
    expect(payload.warnings).toContainEqual({
      area: "repo counts",
      message: "Repository count enrichment reached the GraphQL pagination limit; some repository counts are unknown.",
    })
    expect(lastRepo).toMatchObject({
      openIssues: null,
      openPullRequests: null,
      checkState: null,
    })
  })

  it("does not use REST open issue fallback counts when full GraphQL enrichment fails", async () => {
    const repos = [createRawRepo({ open_issues_count: 7 })]
    const { executor } = createGithubExecutor({
      repos,
      graphqlError: new Error("GraphQL request failed."),
    })
    configureGithubDashboardForTests(executor)

    const payload = await getGithubDashboard({ force: true, scanLimit: 8 })

    expect(payload.repos[0]).toMatchObject({
      openIssues: null,
      openPullRequests: null,
      checkState: null,
    })
    expect(payload.warnings.some((warning) => warning.area === "repo counts")).toBe(true)
  })
})

describe("getGithubDashboard workflow run warnings", () => {
  it("keeps successful workflow runs when another repo fails", async () => {
    const repos = [
      createRawRepo(),
      createRawRepo({
        id: 2,
        name: "failing-repo",
        full_name: "jskoiz/failing-repo",
        html_url: "https://github.com/jskoiz/failing-repo",
      }),
    ]
    const { executor } = createGithubExecutor({
      repos,
      workflowRunsByRepo: {
        "jskoiz/active-repo": [createRawWorkflowRun()],
      },
      workflowRunFailuresByRepo: {
        "jskoiz/failing-repo": new Error("Resource not accessible by integration token ghp_fake_secret"),
      },
    })
    configureGithubDashboardForTests(executor)

    const payload = await getGithubDashboard({ force: true, scanLimit: 8 })
    const ciWarnings = payload.warnings.filter((warning) => warning.area === "ci")

    expect(payload.ciRuns.map((run) => run.repo)).toEqual(["jskoiz/active-repo"])
    expect(payload.repos.find((repo) => repo.fullName === "jskoiz/active-repo")?.latestRun?.name).toBe("CI")
    expect(ciWarnings.map((warning) => warning.message)).toContain(
      "Workflow runs could not be loaded for 1 of 2 scanned repositories: jskoiz/failing-repo."
    )
    expect(ciWarnings.map((warning) => warning.message).join("\n")).not.toContain("ghp_fake_secret")
  })

  it("reports all workflow run fetch failures separately from empty runs", async () => {
    const repos = [
      createRawRepo(),
      createRawRepo({
        id: 2,
        name: "failing-repo",
        full_name: "jskoiz/failing-repo",
        html_url: "https://github.com/jskoiz/failing-repo",
      }),
    ]
    const { executor } = createGithubExecutor({
      repos,
      workflowRunFailuresByRepo: {
        "jskoiz/active-repo": new Error("HTTP 403 ghp_fake_secret"),
        "jskoiz/failing-repo": new Error("HTTP 500 ghp_fake_secret"),
      },
    })
    configureGithubDashboardForTests(executor)

    const payload = await getGithubDashboard({ force: true, scanLimit: 8 })
    const ciMessages = payload.warnings
      .filter((warning) => warning.area === "ci")
      .map((warning) => warning.message)

    expect(payload.ciRuns).toEqual([])
    expect(ciMessages).toContain(
      "Workflow runs could not be loaded for 2 of 2 scanned repositories: jskoiz/active-repo, jskoiz/failing-repo."
    )
    expect(ciMessages).toContain("No workflow runs were returned from scanned repositories.")
    expect(ciMessages[0]).not.toBe("No workflow runs were returned from scanned repositories.")
    expect(ciMessages.join("\n")).not.toContain("ghp_fake_secret")
  })

  it("limits workflow run failure warnings to three repo names", async () => {
    const repos = [
      createRawRepo(),
      createRawRepo({
        id: 2,
        name: "repo-two",
        full_name: "jskoiz/repo-two",
        html_url: "https://github.com/jskoiz/repo-two",
      }),
      createRawRepo({
        id: 3,
        name: "repo-three",
        full_name: "jskoiz/repo-three",
        html_url: "https://github.com/jskoiz/repo-three",
      }),
      createRawRepo({
        id: 4,
        name: "repo-four",
        full_name: "jskoiz/repo-four",
        html_url: "https://github.com/jskoiz/repo-four",
      }),
    ]
    const { executor } = createGithubExecutor({
      repos,
      workflowRunFailuresByRepo: {
        "jskoiz/active-repo": new Error("HTTP 403 ghp_fake_secret"),
        "jskoiz/repo-two": new Error("HTTP 403 ghp_fake_secret"),
        "jskoiz/repo-three": new Error("HTTP 403 ghp_fake_secret"),
        "jskoiz/repo-four": new Error("HTTP 403 ghp_fake_secret"),
      },
    })
    configureGithubDashboardForTests(executor)

    const payload = await getGithubDashboard({ force: true, scanLimit: 8 })
    const ciMessages = payload.warnings
      .filter((warning) => warning.area === "ci")
      .map((warning) => warning.message)

    expect(ciMessages).toContain(
      "Workflow runs could not be loaded for 4 of 4 scanned repositories: jskoiz/active-repo, jskoiz/repo-two, jskoiz/repo-three, and 1 more."
    )
    expect(ciMessages.join("\n")).not.toContain("jskoiz/repo-four")
    expect(ciMessages.join("\n")).not.toContain("ghp_fake_secret")
  })
})
