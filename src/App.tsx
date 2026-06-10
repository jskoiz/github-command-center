import { useCallback, useEffect, useMemo, useState } from "react"
import {
  CircleDotIcon,
  RefreshCcwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { SiGithub } from "react-icons/si"

import { ActivityPanels } from "@/components/dashboard/ActivityPanels"
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton"
import { OperationalRail } from "@/components/dashboard/OperationalRail"
import { RepoTable, type RepoSort, type RepoSortKey } from "@/components/dashboard/RepoTable"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  TooltipProvider,
} from "@/components/ui/tooltip"
import { formatRelative } from "@/lib/format"
import type { CommitSummary, DashboardPayload, IssueSummary, RepoSummary } from "@/types/github"

const DASHBOARD_CACHE_KEY = "github-command-center:dashboard-cache:v1"
const DASHBOARD_CACHE_MAX_AGE_MS = 10 * 60 * 1000

type DashboardCacheEntry = {
  cachedAt: number
  payload: DashboardPayload
}

function App() {
  const [initialDashboardCache] = useState<DashboardCacheEntry | null>(() => readDashboardCache())
  const [data, setData] = useState<DashboardPayload | null>(() => initialDashboardCache?.payload ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => !initialDashboardCache?.payload)
  const [refreshing, setRefreshing] = useState(false)
  const [updatingDetails, setUpdatingDetails] = useState(() => (
    Boolean(initialDashboardCache && !isDashboardCacheFresh(initialDashboardCache))
  ))
  const [query, setQuery] = useState("")
  const [visibility, setVisibility] = useState("all")
  const [language, setLanguage] = useState("all")
  const [ciState, setCiState] = useState("all")
  const [sort, setSort] = useState<RepoSort>({ key: "pushedAt", direction: "desc" })
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(15)

  const loadDashboard = useCallback(async (force = false) => {
    setError(null)
    setRefreshing(force)

    try {
      const response = await fetch(`/api/dashboard${force ? "?refresh=1" : ""}`)
      if (!response.ok) {
        throw new Error(`Dashboard API returned ${response.status}`)
      }
      const payload = await response.json() as DashboardPayload
      setData(payload)
      writeDashboardCache(payload)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Dashboard request failed.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function fetchDashboard(path: string) {
      const response = await fetch(path)
      if (!response.ok) {
        throw new Error(`Dashboard API returned ${response.status}`)
      }
      return await response.json() as DashboardPayload
    }

    async function loadInitialDashboard() {
      if (initialDashboardCache && isDashboardCacheFresh(initialDashboardCache)) {
        setLoading(false)
        return
      }

      if (initialDashboardCache) {
        if (!cancelled) {
          setLoading(false)
          setUpdatingDetails(true)
        }

        try {
          const payload = await fetchDashboard("/api/dashboard")
          if (!cancelled) {
            setData(payload)
            writeDashboardCache(payload)
          }
        } catch (requestError) {
          if (!cancelled) {
            setError(requestError instanceof Error ? requestError.message : "Dashboard request failed.")
          }
        } finally {
          if (!cancelled) setUpdatingDetails(false)
        }
        return
      }

      try {
        const payload = await fetchDashboard("/api/dashboard?quick=1")
        if (!cancelled) setData(payload)
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Dashboard request failed.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }

      if (!cancelled) setUpdatingDetails(true)
      try {
        const payload = await fetchDashboard("/api/dashboard")
        if (!cancelled) {
          setData(payload)
          writeDashboardCache(payload)
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Dashboard request failed.")
        }
      } finally {
        if (!cancelled) setUpdatingDetails(false)
      }
    }

    void loadInitialDashboard()

    return () => {
      cancelled = true
    }
  }, [initialDashboardCache])

  const languages = useMemo(() => {
    if (!data) return []
    return [...new Set(data.repos.map((repo) => repo.language).filter((value): value is string => Boolean(value)))]
      .sort((a, b) => a.localeCompare(b))
  }, [data])

  const latestCommitByRepo = useMemo(() => {
    return latestItemByRepo(data?.recentCommits ?? [], (item) => item.repo, (item) => item.date)
  }, [data?.recentCommits])

  const latestPullRequestByRepo = useMemo(() => {
    return latestItemByRepo(data?.pullRequests ?? [], (item) => item.repo, (item) => item.updatedAt)
  }, [data?.pullRequests])

  const filteredRepos = useMemo(() => {
    if (!data) return []

    const normalizedQuery = query.trim().toLowerCase()
    return data.repos
      .filter((repo) => {
        if (!normalizedQuery) return true
        return [repo.fullName, repo.description, repo.language]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedQuery))
      })
      .filter((repo) => visibility === "all" || repo.visibility === visibility)
      .filter((repo) => language === "all" || repo.language === language)
      .filter((repo) => ciState === "all" || getRepoState(repo) === ciState)
      .sort((a, b) => compareRepos(a, b, sort, latestCommitByRepo, latestPullRequestByRepo))
  }, [ciState, data, language, latestCommitByRepo, latestPullRequestByRepo, query, sort, visibility])

  const safePageIndex = Math.min(pageIndex, Math.max(0, Math.ceil(filteredRepos.length / pageSize) - 1))
  const pagedRepos = useMemo(() => {
    return filteredRepos.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize)
  }, [filteredRepos, pageSize, safePageIndex])

  const handleSort = useCallback((key: RepoSortKey) => {
    setPageIndex(0)
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }))
  }, [])

  const handleVisibilityChange = useCallback((value: string) => {
    setVisibility(value)
    setPageIndex(0)
  }, [])

  const handleLanguageChange = useCallback((value: string) => {
    setLanguage(value)
    setPageIndex(0)
  }, [])

  const handleCiStateChange = useCallback((value: string) => {
    setCiState(value)
    setPageIndex(0)
  }, [])

  const handlePageSizeChange = useCallback((value: number) => {
    setPageSize(value)
    setPageIndex(0)
  }, [])

  if (loading) {
    return <DashboardSkeleton />
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen bg-background text-foreground lg:h-screen lg:overflow-hidden">
        <main className="min-w-0 lg:h-screen lg:min-h-0">
          <Header
            data={data}
            query={query}
            visibility={visibility}
            language={language}
            ciState={ciState}
            languages={languages}
            refreshing={refreshing}
            updatingDetails={updatingDetails}
            onQueryChange={setQuery}
            onVisibilityChange={handleVisibilityChange}
            onLanguageChange={handleLanguageChange}
            onCiStateChange={handleCiStateChange}
            onRefresh={() => void loadDashboard(true)}
          />
          <div className="flex min-h-0 flex-col gap-3 p-3 lg:h-[calc(100vh-3.5rem)] lg:overflow-hidden">
            {error ? <ErrorPanel message={error} /> : null}
            {data ? (
              <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="grid min-h-0 gap-3 lg:grid-rows-[minmax(0,1fr)_190px]">
                      <RepoTable
                        repos={pagedRepos}
                        totalCount={data.repos.length}
                        filteredCount={filteredRepos.length}
                        pageIndex={safePageIndex}
                        pageSize={pageSize}
                        sort={sort}
                        viewerLogin={data.viewer.login}
                        latestCommitByRepo={latestCommitByRepo}
                        latestPullRequestByRepo={latestPullRequestByRepo}
                        onPageChange={setPageIndex}
                        onPageSizeChange={handlePageSizeChange}
                        onSort={handleSort}
                      />
                      <ActivityPanels
                        commits={data.recentCommits}
                        pullRequests={data.pullRequests}
                        issues={data.issues}
                        isUpdating={data.detailLevel === "quick"}
                      />
                    </div>
                  <OperationalRail
                    billing={data.billing}
                    detailLevel={data.detailLevel}
                    runs={data.ciRuns}
                    repos={data.repos}
                    warnings={data.warnings}
                  />
                </div>
            ) : null}
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}

function Header({
  data,
  query,
  visibility,
  language,
  ciState,
  languages,
  refreshing,
  updatingDetails,
  onQueryChange,
  onVisibilityChange,
  onLanguageChange,
  onCiStateChange,
  onRefresh,
}: {
  data: DashboardPayload | null
  query: string
  visibility: string
  language: string
  ciState: string
  languages: string[]
  refreshing: boolean
  updatingDetails: boolean
  onQueryChange: (value: string) => void
  onVisibilityChange: (value: string) => void
  onLanguageChange: (value: string) => void
  onCiStateChange: (value: string) => void
  onRefresh: () => void
}) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="flex min-h-14 flex-col gap-2 p-2 lg:flex-row lg:items-center lg:justify-between lg:px-3">
        <div className="flex min-w-0 items-center gap-3">
          <a href="#repos" className="flex shrink-0 items-center gap-2" aria-label="GitHub Home">
            <SiGithub className="size-7 text-foreground" aria-hidden="true" />
            <span className="text-lg font-semibold">{data?.viewer.login ?? "jskoiz"}</span>
          </a>
          <HeaderStats data={data} />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search repositories..."
              className="h-8 pl-8"
            />
          </div>
          <HeaderFilters
            visibility={visibility}
            language={language}
            ciState={ciState}
            languages={languages}
            onVisibilityChange={onVisibilityChange}
            onLanguageChange={onLanguageChange}
            onCiStateChange={onCiStateChange}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCcwIcon data-icon="inline-start" />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
          <div className="hidden items-center gap-2 px-2 text-sm text-muted-foreground md:flex">
            <CircleDotIcon className="size-4 text-status-success" aria-hidden="true" />
            <span>{updatingDetails ? "Updating" : data ? `Refreshed ${formatRelative(data.generatedAt)}` : "Ready"}</span>
          </div>
          <Avatar className="size-8">
            {data?.viewer.avatarUrl ? <AvatarImage src={data.viewer.avatarUrl} alt={data.viewer.login} /> : null}
            <AvatarFallback>{data?.viewer.login.slice(0, 2).toUpperCase() ?? "JS"}</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  )
}

function HeaderStats({ data }: { data: DashboardPayload | null }) {
  if (!data) return null

  const openPrs = data.repos.reduce((sum, repo) => sum + (repo.openPullRequests ?? 0), 0)
  const openIssues = data.repos.reduce((sum, repo) => sum + (repo.openIssues ?? 0), 0)
  const failingRuns = data.ciRuns.filter((run) =>
    ["failure", "timed_out", "cancelled", "action_required"].includes(run.conclusion ?? "")
  ).length

  return (
    <div className="hidden items-center gap-1 2xl:flex">
      <Badge variant="outline" className="font-mono">{data.repos.length} repos</Badge>
      <Badge variant="outline" className="font-mono">{openPrs} PRs</Badge>
      <Badge variant="outline" className="font-mono">{openIssues} issues</Badge>
      <Badge variant="outline" className="font-mono">{failingRuns} CI</Badge>
    </div>
  )
}

function HeaderFilters({
  visibility,
  language,
  ciState,
  languages,
  onVisibilityChange,
  onLanguageChange,
  onCiStateChange,
}: {
  visibility: string
  language: string
  ciState: string
  languages: string[]
  onVisibilityChange: (value: string) => void
  onLanguageChange: (value: string) => void
  onCiStateChange: (value: string) => void
}) {
  return (
    <div className="hidden shrink-0 items-center gap-1.5 text-sm md:flex">
      <div className="flex items-center gap-1 px-1 text-muted-foreground">
        <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
        <span className="sr-only">Filters</span>
      </div>
      <Select value={visibility} onValueChange={onVisibilityChange}>
        <SelectTrigger size="sm" className="h-8 w-32">
          <SelectValue placeholder="Visibility" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">All visibility</SelectItem>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="private">Private</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select value={language} onValueChange={onLanguageChange}>
        <SelectTrigger size="sm" className="h-8 w-36">
          <SelectValue placeholder="Language" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">All languages</SelectItem>
            {languages.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select value={ciState} onValueChange={onCiStateChange}>
        <SelectTrigger size="sm" className="h-8 w-24">
          <SelectValue placeholder="CI" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">All CI</SelectItem>
            <SelectItem value="success">Passing</SelectItem>
            <SelectItem value="failure">Failing</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="none">No CI</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Dashboard failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function getRepoState(repo: RepoSummary): string {
  const value = (repo.latestRun?.conclusion ?? repo.latestRun?.status ?? repo.checkState)?.toLowerCase()
  if (!value) return "none"
  if (value === "success") return "success"
  if (["failure", "timed_out", "cancelled", "action_required"].includes(value)) return "failure"
  if (["queued", "requested", "waiting", "pending", "in_progress"].includes(value)) return "running"
  return "none"
}

function compareRepos(
  a: RepoSummary,
  b: RepoSummary,
  sort: RepoSort,
  latestCommitByRepo: Map<string, CommitSummary>,
  latestPullRequestByRepo: Map<string, IssueSummary>
): number {
  const aValue = getSortValue(a, sort.key, latestCommitByRepo, latestPullRequestByRepo)
  const bValue = getSortValue(b, sort.key, latestCommitByRepo, latestPullRequestByRepo)
  const direction = sort.direction === "asc" ? 1 : -1

  if (typeof aValue === "number" && typeof bValue === "number") {
    return (aValue - bValue) * direction
  }

  return String(aValue).localeCompare(String(bValue)) * direction
}

function getSortValue(
  repo: RepoSummary,
  key: RepoSortKey,
  latestCommitByRepo: Map<string, CommitSummary>,
  latestPullRequestByRepo: Map<string, IssueSummary>
): string | number {
  if (key === "pushedAt") return repo.pushedAt ? Date.parse(repo.pushedAt) : 0
  if (key === "updatedAt") return repo.updatedAt ? Date.parse(repo.updatedAt) : 0
  if (key === "lastCommitAt") return dateSortValue(latestCommitByRepo.get(repo.fullName)?.date)
  if (key === "lastPullRequestAt") return dateSortValue(latestPullRequestByRepo.get(repo.fullName)?.updatedAt)
  if (key === "openPullRequests") return repo.openPullRequests ?? -1
  if (key === "openIssues") return repo.openIssues ?? -1
  if (key === "stars") return repo.stars
  if (key === "forks") return repo.forks
  if (key === "sizeKb") return repo.sizeKb
  if (key === "checkState") return getRepoState(repo)
  return repo[key] ?? ""
}

function dateSortValue(value: string | null | undefined) {
  return value ? Date.parse(value) : 0
}

function latestItemByRepo<T>(
  items: T[],
  getRepo: (item: T) => string,
  getDate: (item: T) => string
) {
  const latestByRepo = new Map<string, T>()

  for (const item of items) {
    const repo = getRepo(item)
    const current = latestByRepo.get(repo)
    if (!current || Date.parse(getDate(item)) > Date.parse(getDate(current))) {
      latestByRepo.set(repo, item)
    }
  }

  return latestByRepo
}

function readDashboardCache(): DashboardCacheEntry | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(DASHBOARD_CACHE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<DashboardCacheEntry>
    if (!parsed.payload || typeof parsed.cachedAt !== "number") return null
    if (parsed.payload.detailLevel !== "full") return null

    return {
      cachedAt: parsed.cachedAt,
      payload: parsed.payload,
    }
  } catch {
    return null
  }
}

function writeDashboardCache(payload: DashboardPayload) {
  if (typeof window === "undefined" || payload.detailLevel !== "full") return

  window.localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
    cachedAt: Date.now(),
    payload,
  }))
}

function isDashboardCacheFresh(entry: DashboardCacheEntry) {
  return Date.now() - entry.cachedAt <= DASHBOARD_CACHE_MAX_AGE_MS
}

export default App
