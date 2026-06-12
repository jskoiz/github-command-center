import type {
  BillingSummary,
  CommitSummary,
  DashboardPayload,
  IssueSummary,
  RepoSummary,
  Viewer,
  WorkflowRunSummary,
} from "@/types/github"

const OWNER = "octocat"
const GITHUB_BASE = "https://github.com/octocat"

type RepoInput = {
  id: number
  name: string
  description: string
  language: string | null
  visibility: RepoSummary["visibility"]
  stars: number
  forks: number
  openPullRequests: number
  openIssues: number
  pushedHoursAgo: number
  checkState: string | null
  run?: Omit<WorkflowRunSummary, "repo" | "url">
}

type IssueInput = Omit<IssueSummary, "id" | "repo" | "url" | "createdAt" | "updatedAt">

export function createDemoDashboard(now = Date.now()): DashboardPayload {
  const repos = createDemoRepos(now)
  const ciRuns = repos
    .map((repo) => repo.latestRun)
    .filter((run): run is WorkflowRunSummary => Boolean(run))

  return {
    generatedAt: new Date(now).toISOString(),
    detailLevel: "full",
    scanLimit: 24,
    viewer: createDemoViewer(),
    repos,
    recentCommits: createDemoCommits(now),
    pullRequests: createDemoPullRequests(now),
    issues: createDemoIssues(now),
    ciRuns,
    billing: createDemoBilling(),
    warnings: [],
  }
}

function createDemoViewer(): Viewer {
  return {
    login: OWNER,
    name: "Demo account",
    avatarUrl: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
    profileUrl: `${GITHUB_BASE}`,
  }
}

function createDemoRepos(now: number): RepoSummary[] {
  return [
    repo(now, {
      id: 9001,
      name: "command-center",
      description: "Activity-first GitHub homepage for teams that live in PRs.",
      language: "TypeScript",
      visibility: "public",
      stars: 128,
      forks: 12,
      openPullRequests: 4,
      openIssues: 7,
      pushedHoursAgo: 1,
      checkState: "success",
      run: workflowRun(now, 7001, "CI", "completed", "success", 1.1, 214),
    }),
    repo(now, {
      id: 9002,
      name: "api",
      description: "Hosted dashboard API, rate limits, OAuth sessions, and cache fanout.",
      language: "Go",
      visibility: "private",
      stars: 16,
      forks: 3,
      openPullRequests: 2,
      openIssues: 5,
      pushedHoursAgo: 3,
      checkState: "failure",
      run: workflowRun(now, 7002, "API Deploy", "completed", "failure", 2.4, 486),
    }),
    repo(now, {
      id: 9003,
      name: "mobile",
      description: "Native companion app for checking review queues away from the desk.",
      language: "Swift",
      visibility: "public",
      stars: 42,
      forks: 6,
      openPullRequests: 1,
      openIssues: 2,
      pushedHoursAgo: 9,
      checkState: "running",
      run: workflowRun(now, 7003, "iOS Nightly", "in_progress", null, 0.3, null),
    }),
    repo(now, {
      id: 9004,
      name: "design-system",
      description: "Shared dense dashboard components and status treatments.",
      language: "TypeScript",
      visibility: "private",
      stars: 31,
      forks: 4,
      openPullRequests: 3,
      openIssues: 3,
      pushedHoursAgo: 14,
      checkState: "failure",
      run: workflowRun(now, 7004, "Visual Diff", "completed", "failure", 13, 122),
    }),
    repo(now, {
      id: 9005,
      name: "docs",
      description: "Operator docs, launch notes, and public onboarding copy.",
      language: "MDX",
      visibility: "public",
      stars: 73,
      forks: 8,
      openPullRequests: 0,
      openIssues: 4,
      pushedHoursAgo: 22,
      checkState: "success",
      run: workflowRun(now, 7005, "Docs Publish", "completed", "success", 21, 94),
    }),
    repo(now, {
      id: 9006,
      name: "infra",
      description: "Deployment recipes, monitors, cron jobs, and production guardrails.",
      language: "HCL",
      visibility: "private",
      stars: 9,
      forks: 2,
      openPullRequests: 1,
      openIssues: 6,
      pushedHoursAgo: 34,
      checkState: "cancelled",
      run: workflowRun(now, 7006, "Terraform Plan", "completed", "cancelled", 34, 59),
    }),
    repo(now, {
      id: 9007,
      name: "billing-lab",
      description: "Synthetic GitHub Actions billing fixtures and cost scenarios.",
      language: "Python",
      visibility: "public",
      stars: 18,
      forks: 1,
      openPullRequests: 0,
      openIssues: 1,
      pushedHoursAgo: 66,
      checkState: "success",
      run: workflowRun(now, 7007, "Usage Fixture Audit", "completed", "success", 60, 181),
    }),
    repo(now, {
      id: 9008,
      name: "public-profiles",
      description: "No-login profile dashboard experiments and REST-only fixture coverage.",
      language: "TypeScript",
      visibility: "public",
      stars: 64,
      forks: 7,
      openPullRequests: 2,
      openIssues: 3,
      pushedHoursAgo: 4,
      checkState: "failure",
      run: workflowRun(now, 7008, "Public REST Sweep", "completed", "failure", 4, 311),
    }),
    repo(now, {
      id: 9009,
      name: "review-inbox",
      description: "Cross-repo review triage, owner queues, and stale request views.",
      language: "Rust",
      visibility: "private",
      stars: 22,
      forks: 3,
      openPullRequests: 3,
      openIssues: 4,
      pushedHoursAgo: 6,
      checkState: "success",
      run: workflowRun(now, 7009, "Crate Checks", "completed", "success", 5, 143),
    }),
    repo(now, {
      id: 9010,
      name: "search-index",
      description: "Repo and issue search index with compact ranking fixtures.",
      language: "Python",
      visibility: "public",
      stars: 37,
      forks: 5,
      openPullRequests: 2,
      openIssues: 5,
      pushedHoursAgo: 8,
      checkState: "failure",
      run: workflowRun(now, 7010, "Index Backfill", "completed", "failure", 8, 648),
    }),
    repo(now, {
      id: 9011,
      name: "notifier",
      description: "Webhook digest jobs for PR reviews, CI regressions, and cost spikes.",
      language: "Elixir",
      visibility: "private",
      stars: 14,
      forks: 2,
      openPullRequests: 2,
      openIssues: 3,
      pushedHoursAgo: 12,
      checkState: "success",
      run: workflowRun(now, 7011, "Digest Smoke", "completed", "success", 11, 88),
    }),
    repo(now, {
      id: 9012,
      name: "storybook",
      description: "Visual fixtures for the operational cards and dense list states.",
      language: "TypeScript",
      visibility: "public",
      stars: 51,
      forks: 9,
      openPullRequests: 1,
      openIssues: 4,
      pushedHoursAgo: 16,
      checkState: "cancelled",
      run: workflowRun(now, 7012, "Chromatic", "completed", "cancelled", 16, 74),
    }),
    repo(now, {
      id: 9013,
      name: "release-bot",
      description: "Release notes, changelog checks, and semver guardrails.",
      language: "JavaScript",
      visibility: "public",
      stars: 44,
      forks: 4,
      openPullRequests: 1,
      openIssues: 2,
      pushedHoursAgo: 28,
      checkState: "success",
      run: workflowRun(now, 7013, "Release Dry Run", "completed", "success", 24, 132),
    }),
    repo(now, {
      id: 9014,
      name: "analytics",
      description: "Product analytics warehouse models and dashboard snapshots.",
      language: "SQL",
      visibility: "private",
      stars: 12,
      forks: 1,
      openPullRequests: 2,
      openIssues: 5,
      pushedHoursAgo: 39,
      checkState: "failure",
      run: workflowRun(now, 7014, "dbt Build", "completed", "failure", 39, 533),
    }),
    repo(now, {
      id: 9015,
      name: "sdk",
      description: "Client SDKs for embedding the dashboard in internal tools.",
      language: "TypeScript",
      visibility: "public",
      stars: 88,
      forks: 11,
      openPullRequests: 2,
      openIssues: 6,
      pushedHoursAgo: 45,
      checkState: "success",
      run: workflowRun(now, 7015, "Package Matrix", "completed", "success", 42, 287),
    }),
    repo(now, {
      id: 9016,
      name: "ops-runbooks",
      description: "Incident runbooks, ownership notes, and deploy recovery guides.",
      language: "MDX",
      visibility: "private",
      stars: 7,
      forks: 1,
      openPullRequests: 0,
      openIssues: 8,
      pushedHoursAgo: 55,
      checkState: "success",
      run: workflowRun(now, 7016, "Link Check", "completed", "success", 52, 46),
    }),
    repo(now, {
      id: 9017,
      name: "rate-limit-lab",
      description: "Public API throttle simulations and cache-pressure scenarios.",
      language: "Go",
      visibility: "public",
      stars: 27,
      forks: 3,
      openPullRequests: 1,
      openIssues: 3,
      pushedHoursAgo: 72,
      checkState: "failure",
      run: workflowRun(now, 7017, "Anonymous Bucket Test", "completed", "failure", 68, 220),
    }),
    repo(now, {
      id: 9018,
      name: "qa-fixtures",
      description: "Viewport, browser, and console-health fixtures for release checks.",
      language: "TypeScript",
      visibility: "public",
      stars: 33,
      forks: 4,
      openPullRequests: 1,
      openIssues: 2,
      pushedHoursAgo: 90,
      checkState: "success",
      run: workflowRun(now, 7018, "Fixture Audit", "completed", "success", 84, 101),
    }),
  ]
}

function repo(now: number, input: RepoInput): RepoSummary {
  const fullName = `${OWNER}/${input.name}`
  const latestRun = input.run
    ? {
        ...input.run,
        repo: fullName,
        url: `${GITHUB_BASE}/${input.name}/actions/runs/${input.run.id}`,
      }
    : null

  return {
    id: input.id,
    name: input.name,
    fullName,
    owner: OWNER,
    description: input.description,
    url: `${GITHUB_BASE}/${input.name}`,
    language: input.language,
    visibility: input.visibility,
    isPrivate: input.visibility !== "public",
    isFork: false,
    isArchived: false,
    stars: input.stars,
    forks: input.forks,
    sizeKb: 2048 + input.id,
    defaultBranch: "main",
    pushedAt: hoursAgo(now, input.pushedHoursAgo),
    updatedAt: hoursAgo(now, input.pushedHoursAgo / 2),
    openIssues: input.openIssues,
    openPullRequests: input.openPullRequests,
    checkState: input.checkState,
    latestCommit: null,
    latestPullRequest: null,
    latestRun,
  }
}

function workflowRun(
  now: number,
  id: number,
  name: string,
  status: string,
  conclusion: string | null,
  hoursAgoValue: number,
  durationSeconds: number | null
): Omit<WorkflowRunSummary, "repo" | "url"> {
  return {
    id,
    name,
    event: "push",
    status,
    conclusion,
    branch: "main",
    createdAt: hoursAgo(now, hoursAgoValue),
    updatedAt: hoursAgo(now, Math.max(0.1, hoursAgoValue - 0.1)),
    runStartedAt: hoursAgo(now, hoursAgoValue),
    durationSeconds,
  }
}

function createDemoPullRequests(now: number): IssueSummary[] {
  return [
    issue(now, 1, "command-center", {
      number: 42,
      title: "Make public profile pages the default share target",
      state: "open",
      author: "maya",
      labels: ["product"],
      isPullRequest: true,
    }, 1),
    issue(now, 2, "api", {
      number: 38,
      title: "Cache public profile fanout behind optional server token",
      state: "open",
      author: "devin",
      labels: ["backend"],
      isPullRequest: true,
    }, 3),
    issue(now, 3, "design-system", {
      number: 31,
      title: "Tighten feed header wrapping on medium screens",
      state: "open",
      author: "sol",
      labels: ["ui"],
      isPullRequest: true,
      isDraft: true,
    }, 5),
    issue(now, 4, "mobile", {
      number: 27,
      title: "Add review queue handoff to mobile dashboard",
      state: "closed",
      author: "sam",
      labels: ["ios"],
      isPullRequest: true,
    }, 9),
    issue(now, 5, "infra", {
      number: 22,
      title: "Pin preview deploys to public-only env defaults",
      state: "open",
      author: "kai",
      labels: ["deploy"],
      isPullRequest: true,
    }, 18),
    issue(now, 6, "command-center", {
      number: 19,
      title: "Ship demo fixture route for the homepage",
      state: "closed",
      author: "maya",
      labels: ["demo"],
      isPullRequest: true,
    }, 26),
    issue(now, 7, "public-profiles", {
      number: 18,
      title: "Add no-login demo copy to public profile empty states",
      state: "open",
      author: "nora",
      labels: ["public"],
      isPullRequest: true,
    }, 28),
    issue(now, 8, "review-inbox", {
      number: 17,
      title: "Group review requests by owner and repo priority",
      state: "open",
      author: "devin",
      labels: ["reviews"],
      isPullRequest: true,
    }, 31),
    issue(now, 9, "search-index", {
      number: 16,
      title: "Rank exact repo-name matches above stale issue hits",
      state: "open",
      author: "iris",
      labels: ["search"],
      isPullRequest: true,
    }, 34),
    issue(now, 10, "notifier", {
      number: 15,
      title: "Send one digest per failing workflow cluster",
      state: "closed",
      author: "kai",
      labels: ["notifications"],
      isPullRequest: true,
    }, 38),
    issue(now, 11, "storybook", {
      number: 14,
      title: "Capture dense dashboard screenshots at common breakpoints",
      state: "open",
      author: "sol",
      labels: ["visual"],
      isPullRequest: true,
    }, 42),
    issue(now, 12, "analytics", {
      number: 13,
      title: "Model Actions spend by workflow family",
      state: "open",
      author: "lee",
      labels: ["analytics"],
      isPullRequest: true,
    }, 46),
    issue(now, 13, "sdk", {
      number: 12,
      title: "Expose compact activity widget for internal portals",
      state: "open",
      author: "sam",
      labels: ["sdk"],
      isPullRequest: true,
      isDraft: true,
    }, 50),
    issue(now, 14, "rate-limit-lab", {
      number: 11,
      title: "Simulate anonymous REST exhaustion in demo fixtures",
      state: "open",
      author: "maya",
      labels: ["fixtures"],
      isPullRequest: true,
    }, 54),
    issue(now, 15, "qa-fixtures", {
      number: 10,
      title: "Add narrow-viewport smoke checks to fixture matrix",
      state: "closed",
      author: "iris",
      labels: ["qa"],
      isPullRequest: true,
    }, 60),
  ]
}

function createDemoIssues(now: number): IssueSummary[] {
  return [
    issue(now, 101, "api", {
      number: 88,
      title: "Public profile request should explain rate limit fallback",
      state: "open",
      author: "nora",
      labels: ["reliability"],
      isPullRequest: false,
    }, 2),
    issue(now, 102, "docs", {
      number: 57,
      title: "Document no-login public profile limits",
      state: "open",
      author: "lee",
      labels: ["docs"],
      isPullRequest: false,
    }, 6),
    issue(now, 103, "design-system", {
      number: 49,
      title: "Repo sidebar should preserve scroll position",
      state: "open",
      author: "iris",
      labels: ["ui"],
      isPullRequest: false,
    }, 11),
    issue(now, 104, "infra", {
      number: 44,
      title: "Preview deploy health checks need public route coverage",
      state: "open",
      author: "kai",
      labels: ["deploy"],
      isPullRequest: false,
    }, 20),
    issue(now, 105, "billing-lab", {
      number: 12,
      title: "Add storage GB-hour example to billing fixture",
      state: "closed",
      author: "devin",
      labels: ["fixtures"],
      isPullRequest: false,
    }, 40),
    issue(now, 106, "command-center", {
      number: 11,
      title: "Demo route should fill the full dashboard viewport",
      state: "open",
      author: "maya",
      labels: ["demo"],
      isPullRequest: false,
    }, 43),
    issue(now, 107, "public-profiles", {
      number: 10,
      title: "Explain why public profile counts may be approximate",
      state: "open",
      author: "nora",
      labels: ["public"],
      isPullRequest: false,
    }, 47),
    issue(now, 108, "review-inbox", {
      number: 9,
      title: "Show stale requested reviews before closed PRs",
      state: "open",
      author: "devin",
      labels: ["reviews"],
      isPullRequest: false,
    }, 51),
    issue(now, 109, "search-index", {
      number: 8,
      title: "Rebuild repo index when language metadata changes",
      state: "open",
      author: "iris",
      labels: ["search"],
      isPullRequest: false,
    }, 55),
    issue(now, 110, "notifier", {
      number: 7,
      title: "Suppress duplicate notifications during force pushes",
      state: "open",
      author: "kai",
      labels: ["notifications"],
      isPullRequest: false,
    }, 59),
    issue(now, 111, "storybook", {
      number: 6,
      title: "Add dense and sparse data stories for review cards",
      state: "open",
      author: "sol",
      labels: ["visual"],
      isPullRequest: false,
    }, 65),
    issue(now, 112, "analytics", {
      number: 5,
      title: "Backfill workflow-duration fact table for June",
      state: "closed",
      author: "lee",
      labels: ["analytics"],
      isPullRequest: false,
    }, 72),
    issue(now, 113, "sdk", {
      number: 4,
      title: "Document tokenless embed constraints",
      state: "open",
      author: "sam",
      labels: ["sdk"],
      isPullRequest: false,
    }, 80),
    issue(now, 114, "ops-runbooks", {
      number: 3,
      title: "Add recovery notes for OAuth misconfiguration",
      state: "open",
      author: "kai",
      labels: ["ops"],
      isPullRequest: false,
    }, 88),
    issue(now, 115, "rate-limit-lab", {
      number: 2,
      title: "Track public token fallback coverage",
      state: "closed",
      author: "maya",
      labels: ["fixtures"],
      isPullRequest: false,
    }, 96),
    issue(now, 116, "qa-fixtures", {
      number: 1,
      title: "Add first-viewport filled-state assertion",
      state: "open",
      author: "iris",
      labels: ["qa"],
      isPullRequest: false,
    }, 110),
  ]
}

function issue(
  now: number,
  id: number,
  repoName: string,
  input: IssueInput,
  hoursAgoValue: number
): IssueSummary {
  const repoFullName = `${OWNER}/${repoName}`
  const path = input.isPullRequest ? "pull" : "issues"
  return {
    id,
    repo: repoFullName,
    url: `${GITHUB_BASE}/${repoName}/${path}/${input.number}`,
    createdAt: hoursAgo(now, hoursAgoValue + 48),
    updatedAt: hoursAgo(now, hoursAgoValue),
    ...input,
  }
}

function createDemoCommits(now: number): CommitSummary[] {
  return [
    commit(now, "command-center", "9d2a71f9a7d8c4e2b8f9123441a61f1a211edc0a", "Add demo route and homepage link", "maya", 0.5),
    commit(now, "api", "1f77dbb871b90f55fc812a0a4e3c12b7c5a193cb", "Raise public dashboard cache hit rate", "devin", 2),
    commit(now, "docs", "63a1e2299541abbb0e98291dc83291a18d3db29f", "Clarify public versus full dashboard data", "lee", 6),
    commit(now, "design-system", "ef4c062107f425665b263fa2c9377f452994ab21", "Polish compact feed headers", "sol", 10),
    commit(now, "mobile", "44f24abdb32fe77afe416b38eb1e211024a437a2", "Sync review inbox counts", "sam", 14),
    commit(now, "infra", "70aa812acb2a08d375c7b65ecf552a1cc45d00d2", "Add hosted public-only smoke test", "kai", 25),
    commit(now, "public-profiles", "7a84c43c4e2a1f1d6b9a7c2e19f1a15d88c441f0", "Add sample no-login profile warnings", "nora", 30),
    commit(now, "review-inbox", "c532a7d14471d9d2b90a1025c2cdd70fd780a271", "Sort owner queues by blocked review count", "devin", 35),
    commit(now, "search-index", "aa3d0f5b3e31f2080a92d20dd3f5f4a433f018d8", "Refresh repo language facets", "iris", 42),
    commit(now, "notifier", "0fd872aca43ae555e5cfd129218038a2df779d19", "Collapse duplicate workflow digests", "kai", 48),
    commit(now, "storybook", "b971114775056a3b8e21e38e7cf1d21c61cbb005", "Add filled dashboard viewport story", "sol", 52),
    commit(now, "analytics", "304a29df244fbbf8a560e1185050e2d187895a20", "Compute workflow cost by repo family", "lee", 59),
    commit(now, "sdk", "13fca388d7047cf4d19a7ddbfc0c3ed4bc1b579b", "Export compact activity feed helper", "sam", 66),
    commit(now, "rate-limit-lab", "5a94c4b67ddf20fd17192cd4f782df0591302f19", "Record anonymous throttle fixture", "maya", 74),
    commit(now, "qa-fixtures", "8bbba06b30c73037190a4ad47d4a70f4bf0d1849", "Assert demo panels are visually dense", "iris", 86),
  ]
}

function commit(
  now: number,
  repoName: string,
  sha: string,
  message: string,
  author: string,
  hoursAgoValue: number
): CommitSummary {
  return {
    repo: `${OWNER}/${repoName}`,
    sha,
    shortSha: sha.slice(0, 7),
    message,
    author,
    date: hoursAgo(now, hoursAgoValue),
    url: `${GITHUB_BASE}/${repoName}/commit/${sha}`,
  }
}

function createDemoBilling(): BillingSummary {
  return {
    available: true,
    year: 2026,
    month: 6,
    grossAmount: 54.18,
    discountAmount: 40.76,
    netAmount: 13.42,
    unitTotals: [
      { unitType: "Minutes", quantity: 2841 },
      { unitType: "GigabyteHours", quantity: 37.4 },
    ],
    skus: [
      { sku: "Actions Linux", quantity: 2410, unitType: "Minutes", grossAmount: 19.28, netAmount: 4.62 },
      { sku: "Actions macOS", quantity: 431, unitType: "Minutes", grossAmount: 31.45, netAmount: 8.12 },
      { sku: "Artifacts", quantity: 37.4, unitType: "GigabyteHours", grossAmount: 3.45, netAmount: 0.68 },
    ],
    repositories: [
      { repo: `${OWNER}/command-center`, quantity: 1120, grossAmount: 16.32, netAmount: 3.74 },
      { repo: `${OWNER}/mobile`, quantity: 431, grossAmount: 31.45, netAmount: 8.12 },
      { repo: `${OWNER}/api`, quantity: 1290, grossAmount: 6.41, netAmount: 1.56 },
    ],
  }
}

function hoursAgo(now: number, hours: number): string {
  return new Date(now - hours * 60 * 60 * 1000).toISOString()
}
