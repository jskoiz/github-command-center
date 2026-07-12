import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react"
import { LogOutIcon, MoonIcon, RefreshCcwIcon, SearchIcon, SunIcon, XIcon } from "lucide-react"

import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton"
import { FocusView, type RepoScope } from "@/components/dashboard/FocusView"
import { OperationalRail } from "@/components/dashboard/OperationalRail"
import { GitHubIcon } from "@/components/icons/GitHubIcon"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
  clearDashboardCache,
  isDashboardCacheFresh,
  readDashboardCache,
  type DashboardCacheEntry,
  writeDashboardCache,
} from "@/lib/dashboard-cache"
import { createDemoDashboard } from "@/lib/demo-dashboard"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { loadDismissedRuns, saveDismissedRuns } from "@/lib/dismissed-runs"
import { loadHiddenRepos, saveHiddenRepos } from "@/lib/hidden-repos"
import { formatRelative } from "@/lib/format"
import { classifyGithubStatus } from "@/lib/github-status"
import type { Theme } from "@/lib/theme"
import { Homepage } from "@/pages/Homepage"
import type { DashboardPayload, RepoSummary } from "@/types/github"

type AuthMode = "local" | "oauth" | "public" | "demo"
type DashboardErrorPayload = {
  code?: string
  message?: string
  loginUrl?: string
  retryAfterSeconds?: number
  retryAt?: string
}
type DashboardErrorState = {
  code?: string
  title: string
  message: string
  loginUrl?: string
  retryAfterSeconds?: number
  retryAt?: string
  stale?: boolean
  status?: number
}
class DashboardRequestError extends Error {
  readonly status: number
  readonly payload: DashboardErrorPayload

  constructor(message: string, status: number, payload: DashboardErrorPayload) {
    super(message)
    this.name = "DashboardRequestError"
    this.status = status
    this.payload = payload
  }
}

async function createDashboardRequestError(response: Response): Promise<DashboardRequestError> {
  let payload: DashboardErrorPayload = {}
  try {
    const parsed = await response.json() as unknown
    if (isDashboardErrorPayload(parsed)) payload = parsed
  } catch {
    // Non-JSON error responses still render with the HTTP status fallback.
  }

  return new DashboardRequestError(
    payload.message || `Dashboard API returned ${response.status}`,
    response.status,
    payload
  )
}

function toDashboardErrorState(error: unknown, options: { stale?: boolean } = {}): DashboardErrorState {
  if (error instanceof DashboardRequestError) {
    return {
      code: error.payload.code,
      title: dashboardErrorTitle(error.payload.code, error.status),
      message: error.message || "Dashboard request failed.",
      loginUrl: error.payload.loginUrl,
      retryAfterSeconds: error.payload.retryAfterSeconds,
      retryAt: error.payload.retryAt,
      stale: options.stale,
      status: error.status,
    }
  }

  return {
    title: "Dashboard failed",
    message: error instanceof Error ? error.message : "Dashboard request failed.",
    stale: options.stale,
  }
}

function dashboardErrorTitle(code: string | undefined, status: number): string {
  if (code === "github_rate_limit") return "GitHub rate limit reached"
  if (code === "app_rate_limit" || status === 429) return "Too many requests"
  return "Dashboard failed"
}

function isGithubRateLimitRequestError(error: unknown): boolean {
  return error instanceof DashboardRequestError && error.payload.code === "github_rate_limit"
}

function isDashboardErrorPayload(value: unknown): value is DashboardErrorPayload {
  if (typeof value !== "object" || value === null) return false
  const payload = value as Record<string, unknown>
  return (payload.code === undefined || typeof payload.code === "string")
    && (payload.message === undefined || typeof payload.message === "string")
    && (payload.loginUrl === undefined || typeof payload.loginUrl === "string")
    && (payload.retryAfterSeconds === undefined || typeof payload.retryAfterSeconds === "number")
    && (payload.retryAt === undefined || typeof payload.retryAt === "string")
}

function cacheMatchesPublicViewer(entry: DashboardCacheEntry | null, publicUsername: string | null): boolean {
  return Boolean(
    entry
    && publicUsername
    && entry.payload.viewer.login.toLowerCase() === publicUsername.toLowerCase()
  )
}

type DashboardRequestResult =
  | { kind: "unauthorized"; authMode: "oauth" }
  | { kind: "success"; authMode: "oauth" | "public" | null; payload: DashboardPayload }

async function requestDashboard(path: string, signal?: AbortSignal): Promise<DashboardRequestResult> {
  const response = await fetch(path, signal ? { signal } : undefined)
  const responseAuth = response.headers.get("x-gcc-auth")
  const authMode = responseAuth === "oauth" || responseAuth === "public" ? responseAuth : null

  if (response.status === 401 && authMode === "oauth") {
    return { kind: "unauthorized", authMode }
  }
  if (!response.ok) {
    throw await createDashboardRequestError(response)
  }

  return {
    kind: "success",
    authMode,
    payload: await response.json() as DashboardPayload,
  }
}

export default function DashboardPage({
  demoMode,
  publicUsername,
  theme,
  onThemeToggle,
}: {
  demoMode: boolean
  publicUsername: string | null
  theme: Theme
  onThemeToggle: () => void
}) {
  const dashboardSourceKey = demoMode ? "demo" : publicUsername ? `public:${publicUsername.toLowerCase()}` : "session"
  const [initialDashboardCache] = useState<DashboardCacheEntry | null>(() => (
    !demoMode ? readDashboardCache(dashboardSourceKey) : null
  ))
  const [data, setData] = useState<DashboardPayload | null>(() => demoMode ? createDemoDashboard() : null)
  const [error, setError] = useState<DashboardErrorState | null>(null)
  const [loading, setLoading] = useState(!demoMode)
  const [refreshing, setRefreshing] = useState(false)
  const [updatingDetails, setUpdatingDetails] = useState(false)
  const [query, setQuery] = useState("")
  const [visibility, setVisibility] = useState("all")
  const [language, setLanguage] = useState("all")
  const [ciState, setCiState] = useState("all")
  const [repoScope, setRepoScope] = useState<RepoScope>("active")
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>(() => demoMode ? "demo" : publicUsername ? "public" : "local")
  const [needsLogin, setNeedsLogin] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const preferenceScope = demoMode
    ? null
    : `viewer:${(data?.viewer.login ?? publicUsername ?? "").toLowerCase()}`

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return
      event.preventDefault()
      searchInputRef.current?.focus()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const dashboardApiPath = useCallback((options: { force?: boolean; quick?: boolean } = {}) => {
    const base = publicUsername ? `/api/dashboard/${encodeURIComponent(publicUsername)}` : "/api/dashboard"
    const params = new URLSearchParams()
    if (options.force) params.set("refresh", "1")
    if (options.quick) params.set("quick", "1")
    const queryString = params.toString()
    return queryString ? `${base}?${queryString}` : base
  }, [publicUsername])

  const loadDashboard = useCallback(async (force = false) => {
    setError(null)
    setRefreshing(force)

    if (demoMode) {
      setData(createDemoDashboard())
      setNeedsLogin(false)
      setLoading(false)
      setRefreshing(false)
      return
    }

    try {
      const result = await requestDashboard(dashboardApiPath({ force }))
      if (result.kind === "unauthorized") {
        clearDashboardCache(dashboardSourceKey)
        setData(null)
        setNeedsLogin(true)
        return
      }
      if (result.authMode) setAuthMode(result.authMode)
      setNeedsLogin(false)
      setData(result.payload)
      writeDashboardCache(dashboardSourceKey, result.payload)
    } catch (requestError) {
      setError(toDashboardErrorState(requestError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [dashboardApiPath, dashboardSourceKey, demoMode])

  useEffect(() => {
    if (demoMode) return

    let cancelled = false
    const controller = new AbortController()

    async function fetchDashboard(path: string) {
      const result = await requestDashboard(path, controller.signal)
      if (cancelled) return null
      if (result.kind === "unauthorized") {
        clearDashboardCache(dashboardSourceKey)
        setData(null)
        setNeedsLogin(true)
        return null
      }
      if (result.authMode) setAuthMode(result.authMode)
      setNeedsLogin(false)
      return result.payload
    }

    async function loadInitialDashboard() {
      let quickPayload: DashboardPayload | null = null
      try {
        quickPayload = await fetchDashboard(dashboardApiPath({ quick: true }))
        if (!cancelled) {
          if (!quickPayload) {
            setLoading(false)
            return
          }

          const cacheMatchesViewer = initialDashboardCache?.payload.viewer.login === quickPayload.viewer.login
          if (initialDashboardCache && cacheMatchesViewer) {
            setData(initialDashboardCache.payload)
            setUpdatingDetails(!isDashboardCacheFresh(initialDashboardCache))
            setLoading(false)
            if (isDashboardCacheFresh(initialDashboardCache)) return
          } else {
            setData(quickPayload)
            setUpdatingDetails(true)
            setLoading(false)
          }
        }
      } catch (requestError) {
        if (!cancelled && !isAbortError(requestError)) {
          const stale = isGithubRateLimitRequestError(requestError)
            && cacheMatchesPublicViewer(initialDashboardCache, publicUsername)
          if (stale) {
            setData(initialDashboardCache!.payload)
            setUpdatingDetails(false)
            setNeedsLogin(false)
          }
          setError(toDashboardErrorState(requestError, { stale }))
          setLoading(false)
        }
      }
      if (cancelled || !quickPayload) return

      if (!cancelled) setUpdatingDetails(true)
      try {
        const payload = await fetchDashboard(dashboardApiPath())
        if (!cancelled && payload) {
          setData(payload)
          writeDashboardCache(dashboardSourceKey, payload)
        }
      } catch (requestError) {
        if (!cancelled && !isAbortError(requestError)) {
          setError(toDashboardErrorState(requestError, {
            stale: isGithubRateLimitRequestError(requestError)
              && cacheMatchesPublicViewer(initialDashboardCache, publicUsername),
          }))
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
  }, [dashboardApiPath, dashboardSourceKey, demoMode, initialDashboardCache, publicUsername])

  const languages = useMemo(() => {
    if (!data) return []
    return [...new Set(data.repos.map((repo) => repo.language).filter((value): value is string => Boolean(value)))]
      .sort((a, b) => a.localeCompare(b))
  }, [data])

  const handleVisibilityChange = useCallback((value: string) => {
    setVisibility(value)
  }, [])

  const handleLanguageChange = useCallback((value: string) => {
    setLanguage(value)
  }, [])

  const handleCiStateChange = useCallback((value: string) => {
    setCiState(value)
  }, [])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
  }, [])

  const handleRepoScopeChange = useCallback((value: RepoScope) => {
    setRepoScope(value)
  }, [])

  const handleDemoLinkClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!demoMode) return
    const target = event.target
    if (!(target instanceof Element) || !target.closest("a[href]")) return
    event.preventDefault()
  }, [demoMode])

  if (needsLogin) {
    return <Homepage theme={theme} onThemeToggle={onThemeToggle} />
  }

  if (loading) {
    return <DashboardSkeleton />
  }

  return (
    <div
      className="min-h-screen bg-background text-foreground lg:h-screen lg:overflow-hidden"
      onClickCapture={demoMode ? handleDemoLinkClick : undefined}
    >
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
            theme={theme}
            authMode={authMode}
            searchInputRef={searchInputRef}
            onThemeToggle={onThemeToggle}
            onQueryChange={handleQueryChange}
            onVisibilityChange={handleVisibilityChange}
            onLanguageChange={handleLanguageChange}
            onCiStateChange={handleCiStateChange}
            onRefresh={() => void loadDashboard(true)}
          />
          <div className="flex min-h-0 flex-col gap-3 p-3 lg:h-[calc(100vh-3.5rem)] lg:overflow-hidden">
            {error ? <ErrorPanel error={error} retrying={refreshing} onRetry={() => void loadDashboard(true)} /> : null}
            {data ? (
              <DashboardPreferences key={preferenceScope ?? "demo"} scope={preferenceScope}>
                {({ dismissedRunIds, hiddenRepoIds, dismissRun, restoreRuns, toggleRepoHidden }) => {
                  const view = deriveDashboardView(data, hiddenRepoIds, {
                    ciState,
                    language,
                    query,
                    repoScope,
                    visibility,
                  })

                  return (
                    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
                      <FocusView
                        repos={view.filteredRepos}
                        scope={repoScope}
                        activeCount={view.activeCount}
                        totalCount={view.visibleRepos.length}
                        hiddenCount={view.hiddenRepoNames.size}
                        commits={view.visibleActivity.commits}
                        pullRequests={view.visibleActivity.pullRequests}
                        issues={view.visibleActivity.issues}
                        isUpdating={updatingDetails}
                        selectedRepo={selectedRepo}
                        viewerLogin={data.viewer.login}
                        onScopeChange={handleRepoScopeChange}
                        onSelectRepo={setSelectedRepo}
                        onToggleRepoHidden={toggleRepoHidden}
                      />
                      <OperationalRail
                        billing={data.billing}
                        isUpdating={updatingDetails}
                        runs={view.visibleRuns}
                        warnings={data.warnings}
                        viewerLogin={data.viewer.login}
                        dismissedRunIds={dismissedRunIds}
                        onDismissRun={dismissRun}
                        onRestoreRuns={restoreRuns}
                      />
                    </div>
                  )
                }}
              </DashboardPreferences>
            ) : null}
          </div>
      </main>
    </div>
  )
}

function DashboardPreferences({
  scope,
  children,
}: {
  scope: string | null
  children: (preferences: {
    dismissedRunIds: Set<number>
    hiddenRepoIds: Set<number>
    dismissRun: (id: number) => void
    restoreRuns: () => void
    toggleRepoHidden: (id: number) => void
  }) => ReactNode
}) {
  const [dismissedRunIds, setDismissedRunIds] = useState<Set<number>>(() => (
    scope ? loadDismissedRuns(scope) : new Set()
  ))
  const [hiddenRepoIds, setHiddenRepoIds] = useState<Set<number>>(() => (
    scope ? loadHiddenRepos(scope) : new Set()
  ))

  useEffect(() => {
    if (scope) saveDismissedRuns(scope, dismissedRunIds)
  }, [dismissedRunIds, scope])

  useEffect(() => {
    if (scope) saveHiddenRepos(scope, hiddenRepoIds)
  }, [hiddenRepoIds, scope])

  const dismissRun = useCallback((id: number) => {
    setDismissedRunIds((current) => new Set(current).add(id))
  }, [])

  const restoreRuns = useCallback(() => {
    setDismissedRunIds(new Set())
  }, [])

  const toggleRepoHidden = useCallback((id: number) => {
    setHiddenRepoIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return children({
    dismissedRunIds,
    hiddenRepoIds,
    dismissRun,
    restoreRuns,
    toggleRepoHidden,
  })
}

function deriveDashboardView(
  data: DashboardPayload,
  hiddenRepoIds: Set<number>,
  filters: {
    ciState: string
    language: string
    query: string
    repoScope: RepoScope
    visibility: string
  }
) {
  const hiddenRepoNames = new Set(
    data.repos.filter((repo) => hiddenRepoIds.has(repo.id)).map((repo) => repo.fullName)
  )
  const visibleRepos = data.repos.filter((repo) => !hiddenRepoIds.has(repo.id))
  const normalizedQuery = filters.query.trim().toLowerCase()
  const scopedRepos = filters.repoScope === "hidden"
    ? data.repos.filter((repo) => hiddenRepoIds.has(repo.id))
    : filters.repoScope === "active"
      ? visibleRepos.filter(isActiveRepo)
      : visibleRepos
  const filteredRepos = scopedRepos
    .filter((repo) => {
      if (!normalizedQuery) return true
      return [repo.fullName, repo.description, repo.language]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery))
    })
    .filter((repo) => filters.visibility === "all" || repo.visibility === filters.visibility)
    .filter((repo) => filters.language === "all" || repo.language === filters.language)
    .filter((repo) => filters.ciState === "all" || getRepoCiState(repo) === filters.ciState)
    .sort((a, b) => pushedAtValue(b) - pushedAtValue(a))

  return {
    activeCount: visibleRepos.filter(isActiveRepo).length,
    filteredRepos,
    hiddenRepoNames,
    visibleActivity: {
      commits: data.recentCommits.filter((commit) => !hiddenRepoNames.has(commit.repo)),
      pullRequests: data.pullRequests.filter((item) => !hiddenRepoNames.has(item.repo)),
      issues: data.issues.filter((item) => !hiddenRepoNames.has(item.repo)),
    },
    visibleRepos,
    visibleRuns: data.ciRuns.filter((run) => !hiddenRepoNames.has(run.repo)),
  }
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
  theme,
  authMode,
  searchInputRef,
  onThemeToggle,
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
  theme: Theme
  authMode: AuthMode
  searchInputRef: RefObject<HTMLInputElement | null>
  onThemeToggle: () => void
  onQueryChange: (value: string) => void
  onVisibilityChange: (value: string) => void
  onLanguageChange: (value: string) => void
  onCiStateChange: (value: string) => void
  onRefresh: () => void
}) {
  return (
    <header className="top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:sticky">
      <div className="flex min-h-14 flex-col gap-2 px-2 py-2 sm:px-3 lg:h-14 lg:flex-row lg:items-center lg:justify-between lg:py-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <a href="#repos" className="flex shrink-0 items-center gap-2" aria-label="GitHub Home">
            <GitHubIcon className="size-7 text-foreground" aria-hidden="true" />
            <span className="text-lg font-semibold leading-none">{data?.viewer.login ?? "Command Center"}</span>
          </a>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center lg:max-w-[820px] xl:max-w-none">
          <div className="relative min-w-0 flex-1 md:min-w-48">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.stopPropagation()
                  onQueryChange("")
                }
              }}
              placeholder="Search repositories..."
              aria-label="Search repositories"
              className="h-8 bg-card pl-8 pr-8"
            />
            {query ? (
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  onQueryChange("")
                  searchInputRef.current?.focus()
                }}
              >
                <XIcon className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Clear search</span>
              </Button>
            ) : (
              <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-sm border bg-muted px-1.5 font-mono text-[10px] leading-4 text-muted-foreground md:block" aria-hidden="true">
                /
              </kbd>
            )}
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
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCcwIcon data-icon="inline-start" className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
          <div className="hidden min-w-0 items-center gap-2 px-1 text-sm text-muted-foreground md:flex lg:hidden xl:flex">
            <span className="truncate" aria-live="polite">
              {updatingDetails ? "Updating" : data ? `Refreshed ${formatRelative(data.generatedAt)}` : "Ready"}
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={onThemeToggle}>
            {theme === "dark" ? <SunIcon className="size-4" aria-hidden="true" /> : <MoonIcon className="size-4" aria-hidden="true" />}
            <span className="sr-only">Switch to {theme === "dark" ? "light" : "dark"} theme</span>
          </Button>
          {authMode === "oauth" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                  <Avatar className="size-8">
                    {data?.viewer.avatarUrl ? <AvatarImage src={data.viewer.avatarUrl} alt={data.viewer.login} /> : null}
                    <AvatarFallback>{data?.viewer.login.slice(0, 2).toUpperCase() ?? "GH"}</AvatarFallback>
                  </Avatar>
                  <span className="sr-only">Account menu</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="truncate">
                  {data?.viewer.login ? `Signed in as ${data.viewer.login}` : "Signed in"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href="/auth/logout">
                    <LogOutIcon className="size-4" aria-hidden="true" />
                    Sign out
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Avatar className="size-8">
              {data?.viewer.avatarUrl ? <AvatarImage src={data.viewer.avatarUrl} alt={data.viewer.login} /> : null}
              <AvatarFallback>{data?.viewer.login.slice(0, 2).toUpperCase() ?? "GH"}</AvatarFallback>
            </Avatar>
          )}
        </div>
      </div>
    </header>
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

function ErrorPanel({
  error,
  retrying,
  onRetry,
}: {
  error: DashboardErrorState
  retrying: boolean
  onRetry: () => void
}) {
  const retryMessage = rateLimitRetryMessage(error)

  return (
    <Alert variant="destructive">
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p>{error.message}</p>
            {error.stale ? (
              <p>Showing cached data while GitHub public data is temporarily unavailable.</p>
            ) : null}
            {retryMessage ? <p>{retryMessage}</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {error.loginUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={error.loginUrl}>Sign in with GitHub</a>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
              <RefreshCcwIcon data-icon="inline-start" className={retrying ? "animate-spin motion-reduce:animate-none" : undefined} />
              {retrying ? "Retrying" : "Retry"}
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  )
}

function rateLimitRetryMessage(error: DashboardErrorState): string | null {
  if (!error.retryAfterSeconds) return null

  const seconds = Math.max(1, Math.ceil(error.retryAfterSeconds))
  if (seconds < 60) return `Try again in about ${seconds} second${seconds === 1 ? "" : "s"}.`

  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`

  const hours = Math.ceil(minutes / 60)
  return `Try again in about ${hours} hour${hours === 1 ? "" : "s"}.`
}

function getRepoCiState(repo: RepoSummary): string {
  return classifyGithubStatus(repo.latestRun?.conclusion ?? repo.latestRun?.status ?? repo.checkState).rollup
}

const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function isActiveRepo(repo: RepoSummary): boolean {
  if (!repo.pushedAt) return false
  return Date.now() - Date.parse(repo.pushedAt) <= ACTIVE_WINDOW_MS
}

function pushedAtValue(repo: RepoSummary): number {
  return repo.pushedAt ? Date.parse(repo.pushedAt) : 0
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}
