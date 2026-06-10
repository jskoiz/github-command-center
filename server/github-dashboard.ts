import { execFile } from "node:child_process"
import type {
  BillingRepoSummary,
  BillingSkuSummary,
  BillingSummary,
  BillingUnitSummary,
  CommitSummary,
  DashboardPayload,
  DashboardWarning,
  IssueSummary,
  RepoSummary,
  Viewer,
  WorkflowRunSummary,
} from "../src/types/github"

const GH_BIN = process.env.GH_BIN || "/Users/jk/.local/bin/gh"
const API_VERSION = "2026-03-10"
const FULL_CACHE_MS = 5 * 60_000
const QUICK_CACHE_MS = 60_000
const MAX_BUFFER = 32 * 1024 * 1024

type CacheEntry = {
  timestamp: number
  payload: DashboardPayload
}

let fullCache: CacheEntry | null = null
let quickCache: CacheEntry | null = null

type GhError = Error & {
  stderr?: string
  stdout?: string
  endpoint?: string
}

type RawRepo = {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  description: string | null
  html_url: string
  language: string | null
  visibility?: "public" | "private" | "internal"
  private: boolean
  fork: boolean
  archived: boolean
  stargazers_count: number
  forks_count: number
  size: number
  default_branch?: string
  pushed_at: string | null
  updated_at: string | null
  open_issues_count: number
}

type RawSearchIssue = {
  id: number
  number: number
  title: string
  state: string
  html_url: string
  repository_url: string
  updated_at: string
  created_at: string
  user?: { login: string }
  labels?: Array<{ name: string }>
  pull_request?: unknown
}

type RawCommit = {
  sha: string
  html_url: string
  commit: {
    message: string
    author?: {
      name?: string
      date?: string
    }
  }
}

type RawWorkflowRun = {
  id: number
  name: string | null
  event: string
  status: string
  conclusion: string | null
  head_branch: string | null
  created_at: string
  updated_at: string
  run_started_at: string | null
  html_url: string
}

type GraphRepoNode = {
  nameWithOwner: string
  pullRequests?: { totalCount: number }
  issues?: { totalCount: number }
  defaultBranchRef?: {
    target?: {
      statusCheckRollup?: {
        state: string
      } | null
    } | null
  } | null
}

type BillingUsageItem = {
  product?: string
  sku?: string
  quantity?: number
  unitType?: string
  grossAmount?: number
  discountAmount?: number
  netAmount?: number
  repositoryName?: string
}

export async function getGithubDashboard(options: {
  force?: boolean
  quick?: boolean
  scanLimit?: number
} = {}): Promise<DashboardPayload> {
  const now = Date.now()
  const scanLimit = clamp(options.scanLimit ?? 24, 8, 60)

  if (options.quick) {
    if (!options.force && fullCache && now - fullCache.timestamp < FULL_CACHE_MS && fullCache.payload.scanLimit === scanLimit) {
      return fullCache.payload
    }
    if (!options.force && quickCache && now - quickCache.timestamp < QUICK_CACHE_MS && quickCache.payload.scanLimit === scanLimit) {
      return quickCache.payload
    }
    const payload = await getQuickDashboard(scanLimit)
    quickCache = { timestamp: now, payload }
    return payload
  }

  if (!options.force && fullCache && now - fullCache.timestamp < FULL_CACHE_MS && fullCache.payload.scanLimit === scanLimit) {
    return fullCache.payload
  }

  const warnings: DashboardWarning[] = []
  const viewer = await getViewer()
  const repos = await getRepos(warnings)
  const graphRepoData = await getRepoGraphData(viewer.login, warnings)
  const enrichedRepos = repos.map((repo) => toRepoSummary(repo, graphRepoData.get(repo.full_name)))
  const scanRepos = enrichedRepos.slice(0, scanLimit)

  const [commits, runs, pullRequests, issues, billing] = await Promise.all([
    getRecentCommits(viewer.login, scanRepos, warnings),
    getWorkflowRuns(scanRepos, warnings),
    getSearchItems(`is:pr involves:${viewer.login} archived:false`, true, warnings),
    getSearchItems(`is:issue involves:${viewer.login} archived:false`, false, warnings),
    getBilling(viewer.login, warnings),
  ])

  const runsByRepo = new Map<string, WorkflowRunSummary>()
  for (const run of runs) {
    if (!runsByRepo.has(run.repo)) {
      runsByRepo.set(run.repo, run)
    }
  }

  const payload: DashboardPayload = {
    generatedAt: new Date().toISOString(),
    detailLevel: "full",
    scanLimit,
    viewer,
    repos: enrichedRepos.map((repo) => ({
      ...repo,
      latestRun: runsByRepo.get(repo.fullName) ?? repo.latestRun,
    })),
    recentCommits: commits,
    pullRequests,
    issues,
    ciRuns: runs,
    billing,
    warnings,
  }

  fullCache = { timestamp: now, payload }
  return payload
}

async function getQuickDashboard(scanLimit: number): Promise<DashboardPayload> {
  const warnings: DashboardWarning[] = []
  const viewer = await getViewer()
  const [repos, billing] = await Promise.all([
    getRepos(warnings),
    getBilling(viewer.login, warnings),
  ])

  return {
    generatedAt: new Date().toISOString(),
    detailLevel: "quick",
    scanLimit,
    viewer,
    repos: repos.map((repo) => toRepoSummary(repo)),
    recentCommits: [],
    pullRequests: [],
    issues: [],
    ciRuns: [],
    billing,
    warnings,
  }
}

async function getViewer(): Promise<Viewer> {
  const raw = await ghJson<{
    login: string
    name: string | null
    avatar_url: string
    html_url: string
  }>("user")

  return {
    login: raw.login,
    name: raw.name,
    avatarUrl: raw.avatar_url,
    profileUrl: raw.html_url,
  }
}

async function getRepos(warnings: DashboardWarning[]): Promise<RawRepo[]> {
  try {
    const pages = await ghJson<RawRepo[][]>(
      "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
      { paginate: true, slurp: true }
    )
    return pages.flat()
  } catch (error) {
    warnings.push(toWarning("repos", error))
    return []
  }
}

async function getRepoGraphData(
  login: string,
  warnings: DashboardWarning[]
): Promise<Map<string, GraphRepoNode>> {
  const query = `query($login:String!,$first:Int!,$after:String){
    user(login:$login){
      repositories(first:$first, after:$after, orderBy:{field:PUSHED_AT,direction:DESC}, affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER]) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          nameWithOwner
          pullRequests(states:OPEN){ totalCount }
          issues(states:OPEN){ totalCount }
          defaultBranchRef {
            target {
              ... on Commit {
                statusCheckRollup { state }
              }
            }
          }
        }
      }
    }
  }`

  const nodes: GraphRepoNode[] = []
  let after: string | undefined

  try {
    for (let page = 0; page < 4; page += 1) {
      const raw = await ghGraphql<{
        data?: {
          user?: {
            repositories?: {
              nodes?: GraphRepoNode[]
              pageInfo?: {
                hasNextPage: boolean
                endCursor: string | null
              }
            }
          }
        }
      }>(query, { login, first: "50", after })

      const repositories = raw.data?.user?.repositories
      nodes.push(...(repositories?.nodes ?? []))
      if (!repositories?.pageInfo?.hasNextPage || !repositories.pageInfo.endCursor) break
      after = repositories.pageInfo.endCursor
    }

    return new Map(nodes.map((node) => [node.nameWithOwner, node]))
  } catch (error) {
    warnings.push(toWarning("repo counts", error))
    return new Map(nodes.map((node) => [node.nameWithOwner, node]))
  }
}

async function getRecentCommits(
  login: string,
  repos: RepoSummary[],
  warnings: DashboardWarning[]
): Promise<CommitSummary[]> {
  const results = await mapLimit(repos, 5, async (repo) => {
    if (!repo.defaultBranch) return []
    try {
      const commits = await ghJson<RawCommit[]>(
        `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commits?author=${encodeURIComponent(login)}&per_page=3`
      )
      return commits
        .map((commit) => toCommitSummary(repo.fullName, commit))
        .filter((commit): commit is CommitSummary => Boolean(commit))
    } catch {
      return []
    }
  })

  const commits = results.flat()
  if (commits.length === 0 && repos.length > 0) {
    warnings.push({
      area: "commits",
      message: "No recent commits were returned from scanned repositories.",
    })
  }

  return commits
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 30)
}

async function getWorkflowRuns(
  repos: RepoSummary[],
  warnings: DashboardWarning[]
): Promise<WorkflowRunSummary[]> {
  const results = await mapLimit(repos, 5, async (repo) => {
    try {
      const raw = await ghJson<{ workflow_runs?: RawWorkflowRun[] }>(
        `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/actions/runs?per_page=3`
      )
      return (raw.workflow_runs ?? []).map((run) => toWorkflowRunSummary(repo.fullName, run))
    } catch {
      return []
    }
  })

  const runs = results.flat()
  if (runs.length === 0 && repos.length > 0) {
    warnings.push({
      area: "ci",
      message: "No workflow runs were returned from scanned repositories.",
    })
  }

  return runs
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 40)
}

async function getSearchItems(
  query: string,
  isPullRequest: boolean,
  warnings: DashboardWarning[]
): Promise<IssueSummary[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      sort: "updated",
      order: "desc",
      per_page: "30",
    })
    const raw = await ghJson<{ items?: RawSearchIssue[] }>(`/search/issues?${params.toString()}`)
    return (raw.items ?? []).map((item) => toIssueSummary(item, isPullRequest))
  } catch (error) {
    warnings.push(toWarning(isPullRequest ? "pull requests" : "issues", error))
    return []
  }
}

async function getBilling(login: string, warnings: DashboardWarning[]): Promise<BillingSummary> {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  try {
    const raw = await ghJson<{ usageItems?: BillingUsageItem[] }>(
      `/users/${encodeURIComponent(login)}/settings/billing/usage?year=${year}&month=${month}`
    )
    return summarizeBilling(raw.usageItems ?? [], year, month)
  } catch (error) {
    const rawMessage = errorText(error)
    const needsUserScope = rawMessage.includes("needs the \"user\" scope")
    const warning = needsUserScope
      ? {
          area: "billing",
          message: "GitHub billing usage requires the GitHub CLI token to include the user scope.",
        }
      : toWarning("billing", error)
    const fix = needsUserScope
      ? "gh auth refresh -h github.com -s user"
      : undefined
    warnings.push({ ...warning, fix })

    return {
      available: false,
      year,
      month,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
      unitTotals: [],
      skus: [],
      repositories: [],
      message: warning.message,
      fix,
    }
  }
}

function summarizeBilling(items: BillingUsageItem[], year: number, month: number): BillingSummary {
  const actionsItems = items.filter((item) => {
    const product = item.product?.toLowerCase() ?? ""
    const sku = item.sku?.toLowerCase() ?? ""
    return product.includes("actions") || sku.includes("actions")
  })

  const skuMap = new Map<string, BillingSkuSummary>()
  const repoMap = new Map<string, BillingRepoSummary>()
  const unitMap = new Map<string, BillingUnitSummary>()
  let grossAmount = 0
  let discountAmount = 0
  let netAmount = 0

  for (const item of actionsItems) {
    const quantity = Number(item.quantity ?? 0)
    const gross = Number(item.grossAmount ?? 0)
    const discount = Number(item.discountAmount ?? 0)
    const net = Number(item.netAmount ?? 0)
    const sku = item.sku ?? "Actions usage"
    const repo = item.repositoryName ?? "Unattributed"
    const unitType = item.unitType ?? "Units"

    grossAmount += gross
    discountAmount += discount
    netAmount += net

    const unitEntry = unitMap.get(unitType) ?? {
      unitType,
      quantity: 0,
    }
    unitEntry.quantity += quantity
    unitMap.set(unitType, unitEntry)

    const skuEntry = skuMap.get(sku) ?? {
      sku,
      quantity: 0,
      unitType,
      grossAmount: 0,
      netAmount: 0,
    }
    skuEntry.quantity += quantity
    skuEntry.grossAmount += gross
    skuEntry.netAmount += net
    skuMap.set(sku, skuEntry)

    const repoEntry = repoMap.get(repo) ?? {
      repo,
      quantity: 0,
      grossAmount: 0,
      netAmount: 0,
    }
    repoEntry.quantity += quantity
    repoEntry.grossAmount += gross
    repoEntry.netAmount += net
    repoMap.set(repo, repoEntry)
  }

  return {
    available: true,
    year,
    month,
    grossAmount,
    discountAmount,
    netAmount,
    unitTotals: [...unitMap.values()].sort((a, b) => b.quantity - a.quantity),
    skus: [...skuMap.values()].sort((a, b) => b.grossAmount - a.grossAmount).slice(0, 8),
    repositories: [...repoMap.values()].sort((a, b) => b.grossAmount - a.grossAmount).slice(0, 8),
  }
}

function toRepoSummary(repo: RawRepo, graph?: GraphRepoNode): RepoSummary {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner.login,
    description: repo.description,
    url: repo.html_url,
    language: repo.language,
    visibility: repo.visibility ?? (repo.private ? "private" : "public"),
    isPrivate: repo.private,
    isFork: repo.fork,
    isArchived: repo.archived,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    sizeKb: repo.size,
    defaultBranch: repo.default_branch ?? null,
    pushedAt: repo.pushed_at,
    updatedAt: repo.updated_at,
    openIssues: graph?.issues?.totalCount ?? repo.open_issues_count,
    openPullRequests: graph?.pullRequests?.totalCount ?? null,
    checkState: graph?.defaultBranchRef?.target?.statusCheckRollup?.state ?? null,
    latestRun: null,
  }
}

function toCommitSummary(repo: string, commit: RawCommit): CommitSummary | null {
  const date = commit.commit.author?.date
  if (!date) return null
  const firstLine = commit.commit.message.split("\n")[0] ?? "Commit"

  return {
    repo,
    sha: commit.sha,
    shortSha: commit.sha.slice(0, 7),
    message: firstLine,
    author: commit.commit.author?.name ?? null,
    date,
    url: commit.html_url,
  }
}

function toIssueSummary(item: RawSearchIssue, isPullRequest: boolean): IssueSummary {
  return {
    id: item.id,
    number: item.number,
    repo: item.repository_url.replace("https://api.github.com/repos/", ""),
    title: item.title,
    state: item.state,
    url: item.html_url,
    updatedAt: item.updated_at,
    createdAt: item.created_at,
    author: item.user?.login ?? null,
    labels: (item.labels ?? []).map((label) => label.name).slice(0, 3),
    isPullRequest,
  }
}

function toWorkflowRunSummary(repo: string, run: RawWorkflowRun): WorkflowRunSummary {
  return {
    id: run.id,
    repo,
    name: run.name ?? "Workflow run",
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    branch: run.head_branch,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    runStartedAt: run.run_started_at,
    durationSeconds: run.run_started_at
      ? Math.max(0, Math.round((Date.parse(run.updated_at) - Date.parse(run.run_started_at)) / 1000))
      : null,
    url: run.html_url,
  }
}

async function ghJson<T>(
  endpoint: string,
  options: { paginate?: boolean; slurp?: boolean } = {}
): Promise<T> {
  const args = ["api", endpoint, "-H", `X-GitHub-Api-Version:${API_VERSION}`]
  if (options.paginate) args.push("--paginate")
  if (options.slurp) args.push("--slurp")

  const stdout = await execGh(args, endpoint)
  return JSON.parse(stdout) as T
}

async function ghGraphql<T>(query: string, fields: Record<string, string | undefined>): Promise<T> {
  const args = ["api", "graphql", "-H", `X-GitHub-Api-Version:${API_VERSION}`, "-f", `query=${query}`]
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue
    args.push("-F", `${key}=${value}`)
  }
  const stdout = await execGh(args, "graphql")
  return JSON.parse(stdout) as T
}

function execGh(args: string[], endpoint: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      GH_BIN,
      args,
      {
        timeout: 30_000,
        maxBuffer: MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          const ghError = error as GhError
          ghError.stderr = stderr
          ghError.stdout = stdout
          ghError.endpoint = endpoint
          reject(ghError)
          return
        }
        resolve(stdout)
      }
    )
  })
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

function toWarning(area: string, error: unknown): DashboardWarning {
  const rawMessage = errorText(error)
  const message =
    rawMessage
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => !line.startsWith("{")) ?? "GitHub API request failed."

  return { area, message }
}

function errorText(error: unknown): string {
  const ghError = error as GhError
  return [ghError.stderr, ghError.stdout, ghError.message].filter(Boolean).join("\n")
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
