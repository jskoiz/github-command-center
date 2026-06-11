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
import {
  isDashboardCacheFresh,
  readDashboardCache,
  type DashboardCacheEntry,
  writeDashboardCache,
} from "@/lib/dashboard-cache"
import { formatRelative } from "@/lib/format"
import { classifyGithubStatus, isGithubStatusFailure } from "@/lib/github-status"
import type { DashboardPayload, RepoSummary } from "@/types/github"

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
    const controller = new AbortController()

    async function fetchDashboard(path: string) {
      const response = await fetch(path, { signal: controller.signal })
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
          if (!cancelled && !isAbortError(requestError)) {
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
        if (!cancelled && !isAbortError(requestError)) {
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
        if (!cancelled && !isAbortError(requestError)) {
          setError(requestError instanceof Error ? requestError.message : "Dashboard request failed.")
        }
      } finally {
        if (!cancelled) setUpdatingDetails(false)
      }
    }

    void loadInitialDashboard()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [initialDashboardCache])

  const languages = useMemo(() => {
    if (!data) return []
    return [...new Set(data.repos.map((repo) => repo.language).filter((value): value is string => Boolean(value)))]
      .sort((a, b) => a.localeCompare(b))
  }, [data])

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
      .filter((repo) => ciState === "all" || getRepoCiState(repo) === ciState)
      .sort((a, b) => compareRepos(a, b, sort))
  }, [ciState, data, language, query, sort, visibility])

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
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="flex min-h-14 flex-col gap-2 px-2 py-2 sm:px-3 lg:h-14 lg:flex-row lg:items-center lg:justify-between lg:py-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <a href="#repos" className="flex shrink-0 items-center gap-2" aria-label="GitHub Home">
            <SiGithub className="size-7 text-foreground" aria-hidden="true" />
            <span className="text-lg font-semibold leading-none">{data?.viewer.login ?? "jskoiz"}</span>
          </a>
          <HeaderStats data={data} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center lg:max-w-[820px] xl:max-w-none">
          <div className="relative min-w-0 flex-1 md:min-w-48">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search repositories..."
              className="h-8 bg-card pl-8"
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
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="default" onClick={onRefresh} disabled={refreshing}>
            <RefreshCcwIcon data-icon="inline-start" />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
          <div className="hidden min-w-0 items-center gap-2 px-1 text-sm text-muted-foreground md:flex">
            <CircleDotIcon className="size-4 text-status-success" aria-hidden="true" />
            <span className="truncate">{updatingDetails ? "Updating" : data ? `Refreshed ${formatRelative(data.generatedAt)}` : "Ready"}</span>
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
  const failingRuns = data.ciRuns.filter((run) => isGithubStatusFailure(run.conclusion ?? run.status)).length

  return (
    <div className="hidden items-center gap-1 xl:flex">
      <Badge variant="outline" className="h-6 px-2 font-mono">{data.repos.length} repos</Badge>
      <Badge variant="outline" className="h-6 px-2 font-mono">{openPrs} PRs</Badge>
      <Badge variant="outline" className="h-6 px-2 font-mono">{openIssues} issues</Badge>
      <Badge variant="outline" className="h-6 px-2 font-mono">{failingRuns} CI</Badge>
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
    <div className="flex w-full shrink-0 flex-wrap items-center gap-2 text-sm md:w-auto md:flex-nowrap">
      <div className="hidden items-center gap-1 text-muted-foreground md:flex">
        <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
        <span className="sr-only">Filters</span>
      </div>
      <Select value={visibility} onValueChange={onVisibilityChange}>
        <SelectTrigger size="sm" className="h-8 min-w-32 flex-1 bg-card sm:flex-none md:w-32">
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
        <SelectTrigger size="sm" className="h-8 min-w-36 flex-1 bg-card sm:flex-none md:w-36">
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
        <SelectTrigger size="sm" className="h-8 min-w-24 flex-1 bg-card sm:flex-none md:w-24">
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

function getRepoCiState(repo: RepoSummary): string {
  return classifyGithubStatus(repo.latestRun?.conclusion ?? repo.latestRun?.status ?? repo.checkState).rollup
}

function compareRepos(
  a: RepoSummary,
  b: RepoSummary,
  sort: RepoSort
): number {
  const aValue = getSortValue(a, sort.key)
  const bValue = getSortValue(b, sort.key)
  const direction = sort.direction === "asc" ? 1 : -1

  if (typeof aValue === "number" && typeof bValue === "number") {
    return (aValue - bValue) * direction
  }

  return String(aValue).localeCompare(String(bValue)) * direction
}

function getSortValue(
  repo: RepoSummary,
  key: RepoSortKey
): string | number {
  if (key === "pushedAt") return repo.pushedAt ? Date.parse(repo.pushedAt) : 0
  if (key === "updatedAt") return repo.updatedAt ? Date.parse(repo.updatedAt) : 0
  if (key === "lastCommitAt") return dateSortValue(repo.latestCommit?.date)
  if (key === "lastPullRequestAt") return dateSortValue(repo.latestPullRequest?.updatedAt)
  if (key === "openPullRequests") return repo.openPullRequests ?? -1
  if (key === "openIssues") return repo.openIssues ?? -1
  if (key === "stars") return repo.stars
  if (key === "forks") return repo.forks
  if (key === "sizeKb") return repo.sizeKb
  if (key === "checkState") return getRepoCiState(repo)
  return repo[key] ?? ""
}

function dateSortValue(value: string | null | undefined) {
  return value ? Date.parse(value) : 0
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

export default App
