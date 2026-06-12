import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react"
import {
  LogOutIcon,
  MoonIcon,
  RefreshCcwIcon,
  SearchIcon,
  SunIcon,
  XIcon,
} from "lucide-react"
import { SiGithub } from "react-icons/si"

import { FocusView } from "@/components/dashboard/FocusView"
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton"
import { OperationalRail } from "@/components/dashboard/OperationalRail"
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
  TooltipProvider,
} from "@/components/ui/tooltip"
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
import { formatRelative, setViewerLogin } from "@/lib/format"
import { classifyGithubStatus } from "@/lib/github-status"
import type { DashboardPayload, RepoSummary } from "@/types/github"

const THEME_STORAGE_KEY = "github-command-center:theme"
const REPO_URL = "https://github.com/jskoiz/github-command-center"
const X_URL = "https://x.com/jskoiz"
const DASHBOARD_PREVIEW_WIDTH = 1240
const DASHBOARD_PREVIEW_HEIGHT = 620
const DEMO_PREVIEW_VERSION = "stripless"
type Theme = "light" | "dark"
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
export type RepoScope = "active" | "all" | "hidden"
type RepoSortKey =
  | "fullName"
  | "language"
  | "visibility"
  | "openPullRequests"
  | "openIssues"
  | "checkState"
  | "pushedAt"
  | "updatedAt"
  | "stars"
  | "forks"
  | "sizeKb"
  | "defaultBranch"
  | "lastCommitAt"
  | "lastPullRequestAt"
type RepoSort = {
  key: RepoSortKey
  direction: "asc" | "desc"
}

const DEFAULT_REPO_SORT: RepoSort = { key: "pushedAt", direction: "desc" }
const RESERVED_PUBLIC_PATHS = new Set(["api", "assets", "auth", "dashboard", "demo", "healthz"])
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/

function getPublicUsernameFromPath(): string | null {
  if (typeof window === "undefined") return null
  const segments = window.location.pathname.split("/").filter(Boolean)
  if (segments.length !== 1) return null

  const username = decodeURIComponent(segments[0] ?? "")
  if (RESERVED_PUBLIC_PATHS.has(username.toLowerCase())) return null
  return GITHUB_LOGIN_PATTERN.test(username) ? username : null
}

function isSignedDashboardPath(): boolean {
  if (typeof window === "undefined") return false
  return window.location.pathname.replace(/\/+$/, "") === "/dashboard"
}

function isDemoPath(): boolean {
  if (typeof window === "undefined") return false
  return window.location.pathname.replace(/\/+$/, "") === "/demo"
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

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light"
  const themeParam = new URLSearchParams(window.location.search).get("theme")
  if (themeParam === "light" || themeParam === "dark") return themeParam
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === "light" || stored === "dark") return stored
  } catch {
    // Stored preference is best-effort; fall through to the system preference.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function App() {
  const publicUsername = useMemo(() => getPublicUsernameFromPath(), [])
  const signedDashboard = useMemo(() => isSignedDashboardPath(), [])
  const demoMode = useMemo(() => isDemoPath(), [])
  const shouldLoadDashboard = Boolean(publicUsername || signedDashboard || demoMode)
  const dashboardSourceKey = demoMode ? "demo" : publicUsername ? `public:${publicUsername.toLowerCase()}` : "session"
  const [initialDashboardCache] = useState<DashboardCacheEntry | null>(() => (
    shouldLoadDashboard && !demoMode ? readDashboardCache(dashboardSourceKey) : null
  ))
  const [data, setData] = useState<DashboardPayload | null>(() => demoMode ? createDemoDashboard() : null)
  const [error, setError] = useState<DashboardErrorState | null>(null)
  const [loading, setLoading] = useState(shouldLoadDashboard && !demoMode)
  const [refreshing, setRefreshing] = useState(false)
  const [updatingDetails, setUpdatingDetails] = useState(false)
  const [query, setQuery] = useState("")
  const [visibility, setVisibility] = useState("all")
  const [language, setLanguage] = useState("all")
  const [ciState, setCiState] = useState("all")
  const [repoScope, setRepoScope] = useState<RepoScope>("active")
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme())
  const [dismissedRunIds, setDismissedRunIds] = useState<Set<number>>(() => loadDismissedRuns())
  const [hiddenRepoIds, setHiddenRepoIds] = useState<Set<number>>(() => loadHiddenRepos())
  const [authMode, setAuthMode] = useState<AuthMode>(() => demoMode ? "demo" : publicUsername ? "public" : "local")
  const [needsLogin, setNeedsLogin] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Set during render (not an effect) so child components strip the viewer
  // prefix from repo names on the very first paint. Idempotent module state.
  setViewerLogin(data?.viewer.login ?? null)

  useEffect(() => {
    saveDismissedRuns(dismissedRunIds)
  }, [dismissedRunIds])

  useEffect(() => {
    saveHiddenRepos(hiddenRepoIds)
  }, [hiddenRepoIds])

  const handleDismissRun = useCallback((id: number) => {
    setDismissedRunIds((current) => new Set(current).add(id))
  }, [])

  const handleRestoreRuns = useCallback(() => {
    setDismissedRunIds(new Set())
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Theme preference is best-effort; the toggle still works for this session.
    }
  }, [theme])

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

  const applyAuthHeader = useCallback((response: Response) => {
    const responseAuth = response.headers.get("x-gcc-auth")
    if (responseAuth === "oauth" || responseAuth === "public") setAuthMode(responseAuth)
  }, [])

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
      const response = await fetch(dashboardApiPath({ force }))
      applyAuthHeader(response)
      if (response.status === 401 && response.headers.get("x-gcc-auth") === "oauth") {
        clearDashboardCache(dashboardSourceKey)
        setData(null)
        setNeedsLogin(true)
        return
      }
      if (!response.ok) {
        throw await createDashboardRequestError(response)
      }
      const payload = await response.json() as DashboardPayload
      setNeedsLogin(false)
      setData(payload)
      writeDashboardCache(dashboardSourceKey, payload)
    } catch (requestError) {
      setError(toDashboardErrorState(requestError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [applyAuthHeader, dashboardApiPath, dashboardSourceKey, demoMode])

  useEffect(() => {
    if (!shouldLoadDashboard || demoMode) return

    let cancelled = false
    const controller = new AbortController()

    async function fetchDashboard(path: string) {
      const response = await fetch(path, { signal: controller.signal })
      if (!cancelled) applyAuthHeader(response)
      if (response.status === 401 && response.headers.get("x-gcc-auth") === "oauth") {
        clearDashboardCache(dashboardSourceKey)
        if (!cancelled) {
          setData(null)
          setNeedsLogin(true)
        }
        return null
      }
      if (!response.ok) {
        throw await createDashboardRequestError(response)
      }
      if (!cancelled) setNeedsLogin(false)
      return await response.json() as DashboardPayload
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
  }, [applyAuthHeader, dashboardApiPath, dashboardSourceKey, demoMode, initialDashboardCache, publicUsername, shouldLoadDashboard])

  const languages = useMemo(() => {
    if (!data) return []
    return [...new Set(data.repos.map((repo) => repo.language).filter((value): value is string => Boolean(value)))]
      .sort((a, b) => a.localeCompare(b))
  }, [data])

  const visibleRepos = useMemo(() => {
    if (!data) return []
    return data.repos.filter((repo) => !hiddenRepoIds.has(repo.id))
  }, [data, hiddenRepoIds])

  const hiddenRepoNames = useMemo(() => {
    if (!data) return new Set<string>()
    return new Set(data.repos.filter((repo) => hiddenRepoIds.has(repo.id)).map((repo) => repo.fullName))
  }, [data, hiddenRepoIds])

  const visibleRuns = useMemo(() => {
    if (!data) return []
    return data.ciRuns.filter((run) => !hiddenRepoNames.has(run.repo))
  }, [data, hiddenRepoNames])

  const visibleActivity = useMemo(() => {
    if (!data) return { commits: [], pullRequests: [], issues: [] }
    return {
      commits: data.recentCommits.filter((commit) => !hiddenRepoNames.has(commit.repo)),
      pullRequests: data.pullRequests.filter((item) => !hiddenRepoNames.has(item.repo)),
      issues: data.issues.filter((item) => !hiddenRepoNames.has(item.repo)),
    }
  }, [data, hiddenRepoNames])

  const activeCount = useMemo(() => {
    return visibleRepos.filter(isActiveRepo).length
  }, [visibleRepos])

  const filteredRepos = useMemo(() => {
    if (!data) return []

    const normalizedQuery = query.trim().toLowerCase()
    const scopedRepos =
      repoScope === "hidden"
        ? data.repos.filter((repo) => hiddenRepoIds.has(repo.id))
        : repoScope === "active"
          ? visibleRepos.filter(isActiveRepo)
          : visibleRepos
    return scopedRepos
      .filter((repo) => {
        if (!normalizedQuery) return true
        return [repo.fullName, repo.description, repo.language]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedQuery))
      })
      .filter((repo) => visibility === "all" || repo.visibility === visibility)
      .filter((repo) => language === "all" || repo.language === language)
      .filter((repo) => ciState === "all" || getRepoCiState(repo) === ciState)
      .sort((a, b) => compareRepos(a, b, DEFAULT_REPO_SORT))
  }, [ciState, data, hiddenRepoIds, language, query, repoScope, visibility, visibleRepos])

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

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"))
  }, [])

  const handleRepoScopeChange = useCallback((value: RepoScope) => {
    setRepoScope(value)
  }, [])

  const handleToggleRepoHidden = useCallback((id: number) => {
    setHiddenRepoIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleDemoLinkClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!demoMode) return
    const target = event.target
    if (!(target instanceof Element) || !target.closest("a[href]")) return
    event.preventDefault()
  }, [demoMode])

  if (!shouldLoadDashboard || needsLogin) {
    return <Homepage theme={theme} onThemeToggle={toggleTheme} />
  }

  if (loading) {
    return <DashboardSkeleton />
  }

  return (
    <TooltipProvider delayDuration={150}>
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
            onThemeToggle={toggleTheme}
            onQueryChange={handleQueryChange}
            onVisibilityChange={handleVisibilityChange}
            onLanguageChange={handleLanguageChange}
            onCiStateChange={handleCiStateChange}
            onRefresh={() => void loadDashboard(true)}
          />
          <div className="flex min-h-0 flex-col gap-3 p-3 lg:h-[calc(100vh-3.5rem)] lg:overflow-hidden">
            {error ? <ErrorPanel error={error} retrying={refreshing} onRetry={() => void loadDashboard(true)} /> : null}
            {data ? (
              <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
                <FocusView
                  repos={filteredRepos}
                  scope={repoScope}
                  activeCount={activeCount}
                  totalCount={visibleRepos.length}
                  hiddenCount={hiddenRepoIds.size}
                  commits={visibleActivity.commits}
                  pullRequests={visibleActivity.pullRequests}
                  issues={visibleActivity.issues}
                  isUpdating={data.detailLevel === "quick"}
                  selectedRepo={selectedRepo}
                  viewerLogin={data.viewer.login}
                  onScopeChange={handleRepoScopeChange}
                  onSelectRepo={setSelectedRepo}
                  onToggleRepoHidden={handleToggleRepoHidden}
                />
                <OperationalRail
                  billing={data.billing}
                  detailLevel={data.detailLevel}
                  runs={visibleRuns}
                  warnings={data.warnings}
                  dismissedRunIds={dismissedRunIds}
                  onDismissRun={handleDismissRun}
                  onRestoreRuns={handleRestoreRuns}
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
            <SiGithub className="size-7 text-foreground" aria-hidden="true" />
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

function Homepage({
  theme,
  onThemeToggle,
}: {
  theme: Theme
  onThemeToggle: () => void
}) {
  const [username, setUsername] = useState("")
  const normalizedUsername = username.trim()
  const publicPath = GITHUB_LOGIN_PATTERN.test(normalizedUsername)
    ? `/${encodeURIComponent(normalizedUsername)}`
    : "/"

  return (
    <div className="min-h-screen bg-background text-foreground [text-wrap:pretty]">
      <div className="mx-auto max-w-[1320px] px-6 min-[520px]:px-10">
        <header className="flex items-center pt-9">
          <a href="/" className="flex items-center gap-[9px] text-[17px] leading-none font-semibold" aria-label="okgithub home">
            <SiGithub className="size-7" aria-hidden="true" />
            okgithub
          </a>
          <div className="flex-1" />
          <Button
            type="button"
            onClick={onThemeToggle}
            title="Toggle theme"
            aria-label="Toggle theme"
            variant="outline"
            size="icon-lg"
            className="text-muted-foreground"
          >
            {theme === "dark" ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
          </Button>
        </header>

        <main>
          <section className="mx-auto max-w-[620px] pt-16 text-center">
            <h1 className="m-0 text-[44px] leading-[1.15] font-semibold tracking-[-0.02em]">
              A better GitHub homepage.
            </h1>
            <p className="mt-4 text-[17px] leading-[1.6] font-normal text-muted-foreground">
              One view of everything: PRs, issues, commits, CI, and Actions billing across all your repos. No login needed unless you want to see the private stuff. Open source.
            </p>

            <div className="mx-auto mt-7 max-w-[460px]">
              <form
                action={publicPath}
                className="flex flex-col gap-2.5 min-[520px]:flex-row"
                onSubmit={(event) => {
                  if (!normalizedUsername || !GITHUB_LOGIN_PATTERN.test(normalizedUsername)) {
                    event.preventDefault()
                  }
                }}
              >
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="github username"
                  aria-label="GitHub username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="h-[42px] flex-1 bg-card px-3.5 text-[15px]"
                />
                <Button
                  type="submit"
                  className="h-[42px] px-[18px] text-[14px]"
                >
                  Open public view
                </Button>
              </form>
              <p className="mt-3 text-[13px] leading-[1.5] font-normal text-muted-foreground">
                Or{" "}
                <a href="/auth/login" className="font-medium underline underline-offset-3">
                  sign in with GitHub
                </a>{" "}
                for private repos, workflow runs, and billing.
              </p>
            </div>
          </section>

          <section className="mt-14" aria-label="Demo dashboard">
            <div className="mb-2.5 flex items-center gap-2.5 font-mono text-[12.5px] leading-none font-medium text-muted-foreground">
              <Button asChild variant="secondary" size="xs" className="font-mono">
                <a href="/demo">/demo</a>
              </Button>
              <span>live with sample data</span>
            </div>
            <ScaledDemoFrame>
              <iframe
                src={`/demo?theme=${theme}&preview=${DEMO_PREVIEW_VERSION}`}
                title="Live demo dashboard"
                className="block border-0 bg-background"
                style={{ width: DASHBOARD_PREVIEW_WIDTH, height: DASHBOARD_PREVIEW_HEIGHT }}
              />
            </ScaledDemoFrame>
          </section>

          <section className="mt-[60px] grid grid-cols-1 gap-9 min-[860px]:grid-cols-3">
            <HomepageFeature title="Public view, no login">
              Any profile is a dashboard: <code className="rounded-[5px] bg-muted px-1.5 py-0.5 font-mono text-[12px] leading-none font-medium text-foreground">okgithub.com/username</code> shows public PRs, issues, commits, CI, and repos instantly.
            </HomepageFeature>
            <HomepageFeature title="Sign in for everything">
              GitHub OAuth unlocks private repos, workflow runs, Actions billing — everything your token can read.
            </HomepageFeature>
            <HomepageFeature title="Self-host or run local">
              Open source. Run it on your machine against the <code className="rounded-[5px] bg-muted px-1.5 py-0.5 font-mono text-[12px] leading-none font-medium text-foreground">gh</code> CLI, or deploy the hosted server anywhere a container runs.
            </HomepageFeature>
          </section>
        </main>

        <footer className="mt-[60px] flex flex-wrap items-center gap-x-[22px] gap-y-3 border-t border-border py-[26px] pb-[34px] text-[13px] leading-none font-normal text-muted-foreground">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline">
            <SiGithub className="size-[15px]" aria-hidden="true" />
            jskoiz/github-command-center
          </a>
          <span>MIT</span>
          <span className="hidden flex-1 min-[620px]:block" />
          <span>
            Questions?{" "}
            <a href={X_URL} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:underline">
              @jskoiz
            </a>{" "}
            on X
          </span>
        </footer>
      </div>
    </div>
  )
}

function HomepageFeature({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-[15px] leading-[1.3] font-semibold">{title}</h3>
      <p className="text-[13.5px] leading-[1.55] font-normal text-muted-foreground">{children}</p>
    </div>
  )
}

function ScaledDemoFrame({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const updateScale = () => {
      const width = frame.clientWidth || DASHBOARD_PREVIEW_WIDTH
      setScale(width / DASHBOARD_PREVIEW_WIDTH)
    }

    updateScale()

    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(updateScale)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  const height = Math.round(DASHBOARD_PREVIEW_HEIGHT * scale)
  const previewStyle: CSSProperties = {
    width: DASHBOARD_PREVIEW_WIDTH,
    height: DASHBOARD_PREVIEW_HEIGHT,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
  }

  return (
    <div
      ref={frameRef}
      className="overflow-hidden rounded-xl border border-border bg-background shadow-[0_1px_2px_oklch(0_0_0_/_5%),0_12px_32px_-16px_oklch(0_0_0_/_14%)]"
      style={{ height }}
    >
      <div style={previewStyle}>{children}</div>
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
