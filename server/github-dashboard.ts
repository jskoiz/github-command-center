import { AsyncLocalStorage } from "node:async_hooks"
import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { createPublicExecutor, createTokenExecutor, isPaginationLimitError, type GhExecutor } from "./github-client.ts"
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

const GH_BIN = process.env.GH_BIN || "gh"
const API_VERSION = "2026-03-10"
const FULL_CACHE_MS = 5 * 60_000
const QUICK_CACHE_MS = 60_000
const REPO_DETAILS_CACHE_MS = 24 * 60 * 60_000
const RECENT_REPO_ACTIVITY_MS = 7 * 24 * 60 * 60_000
const REPO_DETAILS_CACHE_PATH = process.env.GITHUB_COMMAND_CENTER_REPO_CACHE
  || join(process.cwd(), ".cache", "github-command-center", "repo-details.json")
const MAX_BUFFER = 32 * 1024 * 1024
const GRAPHQL_REPO_PAGE_SIZE = 50
const MAX_GRAPHQL_REPO_PAGES = 20

type CacheEntry = {
  timestamp: number
  payload: DashboardPayload
}

const LOCAL_CACHE_KEY = "local"
const MAX_CACHED_USERS = 200

const fullCaches = new Map<string, CacheEntry>()
const quickCaches = new Map<string, CacheEntry>()
const inFlightDashboards = new Map<string, Promise<DashboardPayload>>()
const repoDetailsCaches = new Map<string, RepoDetailsCacheFile>()
let localRepoDetailsCacheLoaded = false
let skipRepoDetailsCacheWrites = false

type AuthContext = {
  executor: GhExecutor
  cacheKey: string
  publicLogin?: string
}

const authContext = new AsyncLocalStorage<AuthContext>()

function currentExecutor(): GhExecutor {
  return authContext.getStore()?.executor ?? ghExecutor
}

function currentCacheKey(): string {
  return authContext.getStore()?.cacheKey ?? LOCAL_CACHE_KEY
}

function currentPublicLogin(): string | undefined {
  return authContext.getStore()?.publicLogin
}

function boundedMapSet<T>(map: Map<string, T>, key: string, value: T) {
  if (!map.has(key) && map.size >= MAX_CACHED_USERS) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, value)
}

type GhError = Error & {
  stderr?: string
  stdout?: string
  endpoint?: string
}

let ghExecutor: GhExecutor = execGh

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
  draft?: boolean
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

type RawPullRequest = {
  id: number
  number: number
  title: string
  state: string
  html_url: string
  updated_at: string
  created_at: string
  user?: { login: string }
  draft?: boolean
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

type WorkflowRunFetchResult = {
  repo: string
  runs: WorkflowRunSummary[]
  error?: unknown
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

type RepoLatestDetails = {
  latestCommit: CommitSummary | null
  latestPullRequest: IssueSummary | null
}

type RepoDetailsCacheEntry = RepoLatestDetails & {
  refreshedAt: number
  activityAt: string | null
}

type RepoDetailsCacheFile = {
  version: 1
  repos: Record<string, RepoDetailsCacheEntry>
}

export type DashboardAuth = {
  token: string
  userKey: string
}

const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/

export async function getGithubDashboard(options: {
  force?: boolean
  quick?: boolean
  scanLimit?: number
  auth?: DashboardAuth
} = {}): Promise<DashboardPayload> {
  if (options.auth) {
    const context: AuthContext = {
      executor: createTokenExecutor(options.auth.token),
      cacheKey: `user:${options.auth.userKey}`,
    }
    return authContext.run(context, () => getGithubDashboardInner(options))
  }
  return getGithubDashboardInner(options)
}

export async function getPublicGithubDashboard(
  username: string,
  options: {
    force?: boolean
    quick?: boolean
    scanLimit?: number
  } = {}
): Promise<DashboardPayload> {
  const login = normalizeGithubLogin(username)
  const context: AuthContext = {
    executor: createPublicExecutor(publicGithubToken()),
    cacheKey: `public:${login.toLowerCase()}`,
    publicLogin: login,
  }
  return authContext.run(context, () => getGithubDashboardInner(options))
}

function publicGithubToken(): string | null {
  return process.env.GITHUB_PUBLIC_TOKEN || null
}

function normalizeGithubLogin(username: string): string {
  const login = username.trim()
  if (!GITHUB_LOGIN_PATTERN.test(login)) {
    const error = new Error("Invalid GitHub username.") as Error & { status: number }
    error.status = 400
    throw error
  }
  return login
}

async function getGithubDashboardInner(options: {
  force?: boolean
  quick?: boolean
  scanLimit?: number
} = {}): Promise<DashboardPayload> {
  const now = Date.now()
  const scanLimit = clamp(options.scanLimit ?? 24, 8, 60)
  const quick = Boolean(options.quick)
  const force = Boolean(options.force)
  const cached = getCachedDashboard({ force, quick, scanLimit, now })

  if (cached) {
    return cached
  }

  const inFlightKey = `${currentCacheKey()}:${quick ? "quick" : "full"}:${scanLimit}:${force ? "force" : "normal"}`
  const existing = inFlightDashboards.get(inFlightKey)
  if (existing) return existing

  const promise = loadGithubDashboard({ quick, scanLimit, now })
  inFlightDashboards.set(inFlightKey, promise)

  try {
    return await promise
  } finally {
    if (inFlightDashboards.get(inFlightKey) === promise) {
      inFlightDashboards.delete(inFlightKey)
    }
  }
}

function getCachedDashboard({
  force,
  quick,
  scanLimit,
  now,
}: {
  force: boolean
  quick: boolean
  scanLimit: number
  now: number
}): DashboardPayload | null {
  if (force) return null

  const fullCache = fullCaches.get(currentCacheKey())
  const quickCache = quickCaches.get(currentCacheKey())

  if (quick) {
    if (fullCache && now - fullCache.timestamp < FULL_CACHE_MS && fullCache.payload.scanLimit === scanLimit) {
      return fullCache.payload
    }
    if (quickCache && now - quickCache.timestamp < QUICK_CACHE_MS && quickCache.payload.scanLimit === scanLimit) {
      return quickCache.payload
    }
    return null
  }

  if (fullCache && now - fullCache.timestamp < FULL_CACHE_MS && fullCache.payload.scanLimit === scanLimit) {
    return fullCache.payload
  }

  return null
}

async function loadGithubDashboard({
  quick,
  scanLimit,
  now,
}: {
  quick: boolean
  scanLimit: number
  now: number
}): Promise<DashboardPayload> {
  if (quick) {
    const payload = await getQuickDashboard(scanLimit)
    boundedMapSet(quickCaches, currentCacheKey(), { timestamp: now, payload })
    return payload
  }

  const warnings: DashboardWarning[] = []
  const viewer = await getViewer()
  const repos = await getRepos(warnings)
  const graphRepoData = await getRepoGraphData(viewer.login, repos.length, warnings)
  const enrichedRepos = repos.map((repo) => toRepoSummary(repo, graphRepoData.get(repo.full_name), {
    useRestIssueFallback: false,
  }))
  const scanRepos = enrichedRepos.slice(0, scanLimit)

  const [repoDetails, runs, pullRequests, issues, billing] = await Promise.all([
    getPerRepoLatestDetails(enrichedRepos, scanRepos, warnings, now),
    getWorkflowRuns(scanRepos, warnings),
    getSearchItems(`is:pr involves:${viewer.login} archived:false`, true, warnings),
    getSearchItems(`is:issue involves:${viewer.login} archived:false`, false, warnings),
    getBilling(viewer.login, warnings),
  ])
  const commits = getRecentCommitsFromRepoDetails(enrichedRepos, repoDetails)

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
      ...(repoDetails.get(repo.fullName) ?? {}),
      latestRun: runsByRepo.get(repo.fullName) ?? repo.latestRun,
    })),
    recentCommits: commits,
    pullRequests,
    issues,
    ciRuns: runs,
    billing,
    warnings,
  }

  boundedMapSet(fullCaches, currentCacheKey(), { timestamp: now, payload })
  return payload
}

async function getQuickDashboard(scanLimit: number): Promise<DashboardPayload> {
  const warnings: DashboardWarning[] = []
  const viewer = await getViewer()
  const repos = await getRepos(warnings, { paginate: false, perPage: scanLimit })
  const now = new Date()

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
    billing: createUnavailableBillingSummary(
      now.getFullYear(),
      now.getMonth() + 1,
      "Billing loads with full dashboard details."
    ),
    warnings,
  }
}

async function getViewer(): Promise<Viewer> {
  const publicLogin = currentPublicLogin()
  const raw = await ghJson<{
    login: string
    name: string | null
    avatar_url: string
    html_url: string
  }>(publicLogin ? `/users/${encodeURIComponent(publicLogin)}` : "user")

  return {
    login: raw.login,
    name: raw.name,
    avatarUrl: raw.avatar_url,
    profileUrl: raw.html_url,
  }
}

async function getRepos(
  warnings: DashboardWarning[],
  options: { paginate?: boolean; perPage?: number } = {}
): Promise<RawRepo[]> {
  const paginate = options.paginate ?? true
  const perPage = clamp(options.perPage ?? 100, 1, 100)
  const publicLogin = currentPublicLogin()
  const endpoint = publicLogin
    ? `/users/${encodeURIComponent(publicLogin)}/repos?per_page=${perPage}&sort=pushed&type=owner`
    : `/user/repos?per_page=${perPage}&sort=pushed&affiliation=owner,collaborator,organization_member`

  try {
    if (!paginate) {
      return await ghJson<RawRepo[]>(endpoint)
    }

    const pages = await ghJson<RawRepo[][]>(endpoint, { paginate: true, slurp: true })
    return pages.flat()
  } catch (error) {
    if (isPaginationLimitError(error)) {
      warnings.push({
        area: "repos",
        message: "Repository list reached the hosted pagination limit; dashboard data is partial.",
      })
      return flattenRepoPages(error.partialPages)
    }
    warnings.push(toWarning("repos", error))
    return []
  }
}

async function getRepoGraphData(
  login: string,
  repoCount: number,
  warnings: DashboardWarning[]
): Promise<Map<string, GraphRepoNode>> {
  if (currentPublicLogin()) {
    warnings.push({
      area: "public mode",
      message: "Open PR counts and default-branch check rollups require sign-in; public profile data is limited to public GitHub REST responses.",
    })
    return new Map()
  }

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
  const requestedPages = Math.max(1, Math.ceil(repoCount / GRAPHQL_REPO_PAGE_SIZE))
  const maxPages = Math.min(requestedPages, MAX_GRAPHQL_REPO_PAGES)

  try {
    for (let page = 0; page < maxPages; page += 1) {
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
      }>(query, { login, first: String(GRAPHQL_REPO_PAGE_SIZE), after })

      const repositories = raw.data?.user?.repositories
      nodes.push(...(repositories?.nodes ?? []))
      const pageInfo = repositories?.pageInfo
      if (page === maxPages - 1 && pageInfo?.hasNextPage) {
        warnings.push({
          area: "repo counts",
          message: "Repository count enrichment reached the GraphQL pagination limit; some repository counts are unknown.",
        })
      }
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break
      after = pageInfo.endCursor
    }

    return new Map(nodes.map((node) => [node.nameWithOwner, node]))
  } catch (error) {
    warnings.push(toWarning("repo counts", error))
    return new Map(nodes.map((node) => [node.nameWithOwner, node]))
  }
}

function flattenRepoPages(pages: unknown[]): RawRepo[] {
  return pages.flatMap((page) => Array.isArray(page) ? page as RawRepo[] : [])
}

async function getPerRepoLatestDetails(
  repos: RepoSummary[],
  refreshRepos: RepoSummary[],
  warnings: DashboardWarning[],
  now: number
): Promise<Map<string, RepoLatestDetails>> {
  const cache = await loadRepoDetailsCache()
  const refreshRepoNames = new Set(refreshRepos.map((repo) => repo.fullName))
  const detailsByRepo = new Map<string, RepoLatestDetails>()
  let dirty = false
  let failedRefreshes = 0
  let activeReposOutsideRefreshScope = 0

  await mapLimit(repos, 4, async (repo) => {
    const cached = cache.repos[repo.fullName]
    const activityAt = getRepoActivityAt(repo)

    if (!refreshRepoNames.has(repo.fullName)) {
      if (isRecentlyActive(activityAt, now)) activeReposOutsideRefreshScope += 1
      detailsByRepo.set(repo.fullName, cached ? toRepoLatestDetails(cached) : emptyRepoLatestDetails())
      return
    }

    if (cached && now - cached.refreshedAt < REPO_DETAILS_CACHE_MS) {
      detailsByRepo.set(repo.fullName, toRepoLatestDetails(cached))
      return
    }

    if (!isRecentlyActive(activityAt, now)) {
      detailsByRepo.set(repo.fullName, cached ? toRepoLatestDetails(cached) : emptyRepoLatestDetails())
      return
    }

    const [commitResult, pullRequestResult] = await Promise.allSettled([
      getLatestRepoCommit(repo),
      getLatestRepoPullRequest(repo),
    ])
    const refreshSucceeded = commitResult.status === "fulfilled" && pullRequestResult.status === "fulfilled"
    if (!refreshSucceeded) {
      failedRefreshes += 1
    }

    const details: RepoLatestDetails = {
      latestCommit: commitResult.status === "fulfilled" ? commitResult.value : cached?.latestCommit ?? null,
      latestPullRequest: pullRequestResult.status === "fulfilled" ? pullRequestResult.value : cached?.latestPullRequest ?? null,
    }
    cache.repos[repo.fullName] = {
      ...details,
      refreshedAt: refreshSucceeded ? now : cached?.refreshedAt ?? 0,
      activityAt,
    }
    dirty = true
    detailsByRepo.set(repo.fullName, details)
  })

  if (dirty) {
    await writeRepoDetailsCache(cache)
  }

  if (failedRefreshes > 0) {
    warnings.push({
      area: "repo details",
      message: `Latest commit or pull request refresh failed for ${failedRefreshes} repositories.`,
    })
  }

  if (activeReposOutsideRefreshScope > 0) {
    warnings.push({
      area: "repo details",
      message: `Latest commit and pull request refresh is limited to ${refreshRepos.length} of ${repos.length} repositories; active repositories outside the live refresh scope: ${activeReposOutsideRefreshScope}.`,
    })
  }

  return detailsByRepo
}

async function getLatestRepoCommit(repo: RepoSummary): Promise<CommitSummary | null> {
  if (!repo.defaultBranch) return null

  const commits = await ghJson<RawCommit[]>(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commits?per_page=1`
  )
  const commit = commits[0]
  return commit ? toCommitSummary(repo.fullName, commit) : null
}

async function getLatestRepoPullRequest(repo: RepoSummary): Promise<IssueSummary | null> {
  const pullRequests = await ghJson<RawPullRequest[]>(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/pulls?state=all&sort=updated&direction=desc&per_page=1`
  )
  const pullRequest = pullRequests[0]
  return pullRequest ? toPullRequestSummary(repo.fullName, pullRequest) : null
}

async function loadRepoDetailsCache(): Promise<RepoDetailsCacheFile> {
  const key = currentCacheKey()
  const existing = repoDetailsCaches.get(key)
  if (existing && (key !== LOCAL_CACHE_KEY || localRepoDetailsCacheLoaded)) return existing

  if (key !== LOCAL_CACHE_KEY) {
    const created = createEmptyRepoDetailsCache()
    boundedMapSet(repoDetailsCaches, key, created)
    return created
  }

  localRepoDetailsCacheLoaded = true
  let cache: RepoDetailsCacheFile
  try {
    const parsed = JSON.parse(await readFile(REPO_DETAILS_CACHE_PATH, "utf8")) as unknown
    cache = normalizeRepoDetailsCache(parsed)
  } catch {
    cache = createEmptyRepoDetailsCache()
  }
  repoDetailsCaches.set(LOCAL_CACHE_KEY, cache)
  return cache
}

async function writeRepoDetailsCache(cache: RepoDetailsCacheFile) {
  // Hosted users keep repo details in memory only; the disk cache is for local mode.
  if (skipRepoDetailsCacheWrites || currentCacheKey() !== LOCAL_CACHE_KEY) return

  try {
    await mkdir(dirname(REPO_DETAILS_CACHE_PATH), { recursive: true })
    await writeFile(REPO_DETAILS_CACHE_PATH, JSON.stringify(cache, null, 2))
  } catch {
    // Repo detail caching is best-effort. A dashboard fetch should still render.
  }
}

function getRepoActivityAt(repo: RepoSummary) {
  const values = [repo.pushedAt, repo.updatedAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
  if (values.length === 0) return null
  return new Date(Math.max(...values)).toISOString()
}

function isRecentlyActive(activityAt: string | null, now: number) {
  return activityAt ? now - Date.parse(activityAt) <= RECENT_REPO_ACTIVITY_MS : false
}

function emptyRepoLatestDetails(): RepoLatestDetails {
  return {
    latestCommit: null,
    latestPullRequest: null,
  }
}

function toRepoLatestDetails(entry: RepoDetailsCacheEntry): RepoLatestDetails {
  return {
    latestCommit: entry.latestCommit,
    latestPullRequest: entry.latestPullRequest,
  }
}

function getRecentCommitsFromRepoDetails(
  repos: RepoSummary[],
  repoDetails: Map<string, RepoLatestDetails>
): CommitSummary[] {
  return repos
    .map((repo) => repoDetails.get(repo.fullName)?.latestCommit ?? null)
    .filter((commit): commit is CommitSummary => Boolean(commit))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 30)
}

async function getWorkflowRuns(
  repos: RepoSummary[],
  warnings: DashboardWarning[]
): Promise<WorkflowRunSummary[]> {
  const results = await mapLimit(repos, 5, async (repo): Promise<WorkflowRunFetchResult> => {
    try {
      const raw = await ghJson<{ workflow_runs?: RawWorkflowRun[] }>(
        `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/actions/runs?per_page=3`
      )
      return {
        repo: repo.fullName,
        runs: (raw.workflow_runs ?? []).map((run) => toWorkflowRunSummary(repo.fullName, run)),
      }
    } catch (error) {
      return {
        repo: repo.fullName,
        runs: [],
        error: error ?? "Workflow run request failed.",
      }
    }
  })

  const failedResults = results.filter((result) => result.error !== undefined)
  const runs = results.flatMap((result) => result.runs)

  if (failedResults.length > 0) {
    const repoNames = failedResults.slice(0, 3).map((result) => result.repo).join(", ")
    const hiddenCount = failedResults.length - 3
    const hiddenSuffix = hiddenCount > 0 ? `, and ${hiddenCount} more` : ""
    const repositoryLabel = repos.length === 1 ? "repository" : "repositories"

    warnings.push({
      area: "ci",
      message: `Workflow runs could not be loaded for ${failedResults.length} of ${repos.length} scanned ${repositoryLabel}: ${repoNames}${hiddenSuffix}.`,
    })
  }

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

  if (currentPublicLogin()) {
    return createUnavailableBillingSummary(
      year,
      month,
      "Billing is not available in public profile mode."
    )
  }

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

function createUnavailableBillingSummary(year: number, month: number, message: string): BillingSummary {
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
    message,
  }
}

function toRepoSummary(
  repo: RawRepo,
  graph?: GraphRepoNode,
  options: { useRestIssueFallback?: boolean } = {}
): RepoSummary {
  const useRestIssueFallback = options.useRestIssueFallback ?? true

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
    openIssues: graph?.issues?.totalCount ?? (useRestIssueFallback ? repo.open_issues_count : null),
    openPullRequests: graph?.pullRequests?.totalCount ?? null,
    checkState: graph?.defaultBranchRef?.target?.statusCheckRollup?.state ?? null,
    latestCommit: null,
    latestPullRequest: null,
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
    isDraft: Boolean(item.draft),
  }
}

function toPullRequestSummary(repo: string, item: RawPullRequest): IssueSummary {
  return {
    id: item.id,
    number: item.number,
    repo,
    title: item.title,
    state: item.state,
    url: item.html_url,
    updatedAt: item.updated_at,
    createdAt: item.created_at,
    author: item.user?.login ?? null,
    labels: [],
    isPullRequest: true,
    isDraft: Boolean(item.draft),
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

  const stdout = await currentExecutor()(args, endpoint)
  return JSON.parse(stdout) as T
}

async function ghGraphql<T>(query: string, fields: Record<string, string | undefined>): Promise<T> {
  const args = ["api", "graphql", "-H", `X-GitHub-Api-Version:${API_VERSION}`, "-f", `query=${query}`]
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue
    args.push("-F", `${key}=${value}`)
  }
  const stdout = await currentExecutor()(args, "graphql")
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

function createEmptyRepoDetailsCache(): RepoDetailsCacheFile {
  return {
    version: 1,
    repos: {},
  }
}

function normalizeRepoDetailsCache(value: unknown): RepoDetailsCacheFile {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.repos)) {
    return createEmptyRepoDetailsCache()
  }

  const repos: Record<string, RepoDetailsCacheEntry> = {}
  for (const [repo, entry] of Object.entries(value.repos)) {
    if (!isRepoDetailsCacheEntry(entry)) continue
    repos[repo] = entry
  }

  return {
    version: 1,
    repos,
  }
}

function isRepoDetailsCacheEntry(value: unknown): value is RepoDetailsCacheEntry {
  return isRecord(value)
    && Number.isFinite(value.refreshedAt)
    && (typeof value.activityAt === "string" || value.activityAt === null)
    && (value.latestCommit === null || isCommitSummary(value.latestCommit))
    && (value.latestPullRequest === null || isIssueSummary(value.latestPullRequest))
}

function isCommitSummary(value: unknown): value is CommitSummary {
  return isRecord(value)
    && typeof value.repo === "string"
    && typeof value.sha === "string"
    && typeof value.shortSha === "string"
    && typeof value.message === "string"
    && (typeof value.author === "string" || value.author === null)
    && typeof value.date === "string"
    && typeof value.url === "string"
}

function isIssueSummary(value: unknown): value is IssueSummary {
  return isRecord(value)
    && Number.isFinite(value.id)
    && Number.isFinite(value.number)
    && typeof value.repo === "string"
    && typeof value.title === "string"
    && typeof value.state === "string"
    && typeof value.url === "string"
    && typeof value.updatedAt === "string"
    && typeof value.createdAt === "string"
    && (typeof value.author === "string" || value.author === null)
    && Array.isArray(value.labels)
    && typeof value.isPullRequest === "boolean"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
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

export function configureGithubDashboardForTests(executor: GhExecutor | null) {
  ghExecutor = executor ?? execGh
  fullCaches.clear()
  quickCaches.clear()
  repoDetailsCaches.clear()
  if (executor) repoDetailsCaches.set(LOCAL_CACHE_KEY, createEmptyRepoDetailsCache())
  localRepoDetailsCacheLoaded = Boolean(executor)
  skipRepoDetailsCacheWrites = Boolean(executor)
  inFlightDashboards.clear()
}
