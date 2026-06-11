import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import {
  CircleDotIcon,
  LogOutIcon,
  MoonIcon,
  PanelLeftIcon,
  RefreshCcwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SunIcon,
  Table2Icon,
  XIcon,
} from "lucide-react"
import { SiGithub } from "react-icons/si"

import { ActivityPanels } from "@/components/dashboard/ActivityPanels"
import { AttentionStrip } from "@/components/dashboard/AttentionStrip"
import { FocusView } from "@/components/dashboard/FocusView"
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton"
import { OperationalRail } from "@/components/dashboard/OperationalRail"
import { RepoTable, type RepoSort, type RepoSortKey } from "@/components/dashboard/RepoTable"
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
import { cn } from "@/lib/utils"
import type { DashboardPayload, RepoSummary } from "@/types/github"

const THEME_STORAGE_KEY = "github-command-center:theme"
const VIEW_MODE_STORAGE_KEY = "github-command-center:view-mode"
type Theme = "light" | "dark"
export type RepoScope = "active" | "all" | "hidden"
export type ViewMode = "table" | "focus"

function getInitialViewMode(): ViewMode {
  if (typeof window === "undefined") return "table"
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (stored === "table" || stored === "focus") return stored
  } catch {
    // View mode is best-effort; default to the table view.
  }
  return "table"
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light"
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === "light" || stored === "dark") return stored
  } catch {
    // Stored preference is best-effort; fall through to the system preference.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function App() {
  const [initialDashboardCache] = useState<DashboardCacheEntry | null>(() => readDashboardCache())
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatingDetails, setUpdatingDetails] = useState(false)
  const [query, setQuery] = useState("")
  const [visibility, setVisibility] = useState("all")
  const [language, setLanguage] = useState("all")
  const [ciState, setCiState] = useState("all")
  const [sort, setSort] = useState<RepoSort>({ key: "pushedAt", direction: "desc" })
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(15)
  const [repoScope, setRepoScope] = useState<RepoScope>("active")
  const [viewMode, setViewMode] = useState<ViewMode>(() => getInitialViewMode())
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme())
  const [dismissedRunIds, setDismissedRunIds] = useState<Set<number>>(() => loadDismissedRuns())
  const [hiddenRepoIds, setHiddenRepoIds] = useState<Set<number>>(() => loadHiddenRepos())
  const [authMode, setAuthMode] = useState<"local" | "oauth">("local")
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

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode)
    } catch {
      // View mode is best-effort; the toggle still works for this session.
    }
  }, [viewMode])

  const toggleViewMode = useCallback(() => {
    setViewMode((current) => (current === "table" ? "focus" : "table"))
  }, [])

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

  const loadDashboard = useCallback(async (force = false) => {
    setError(null)
    setRefreshing(force)

    try {
      const response = await fetch(`/api/dashboard${force ? "?refresh=1" : ""}`)
      if (response.headers.get("x-gcc-auth") === "oauth") setAuthMode("oauth")
      if (response.status === 401) {
        clearDashboardCache()
        setData(null)
        setNeedsLogin(true)
        return
      }
      if (!response.ok) {
        throw new Error(`Dashboard API returned ${response.status}`)
      }
      const payload = await response.json() as DashboardPayload
      setNeedsLogin(false)
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
      if (!cancelled && response.headers.get("x-gcc-auth") === "oauth") setAuthMode("oauth")
      if (response.status === 401) {
        clearDashboardCache()
        if (!cancelled) {
          setData(null)
          setNeedsLogin(true)
        }
        return null
      }
      if (!response.ok) {
        throw new Error(`Dashboard API returned ${response.status}`)
      }
      if (!cancelled) setNeedsLogin(false)
      return await response.json() as DashboardPayload
    }

    async function loadInitialDashboard() {
      let quickPayload: DashboardPayload | null = null
      try {
        quickPayload = await fetchDashboard("/api/dashboard?quick=1")
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
          setError(requestError instanceof Error ? requestError.message : "Dashboard request failed.")
          setLoading(false)
        }
      }
      if (cancelled || !quickPayload) return

      if (!cancelled) setUpdatingDetails(true)
      try {
        const payload = await fetchDashboard("/api/dashboard")
        if (!cancelled && payload) {
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
      .sort((a, b) => compareRepos(a, b, sort))
  }, [ciState, data, hiddenRepoIds, language, query, repoScope, sort, visibility, visibleRepos])

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

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    setPageIndex(0)
  }, [])

  const hasActiveFilters = query.trim() !== "" || visibility !== "all" || language !== "all" || ciState !== "all"

  const handleClearFilters = useCallback(() => {
    setQuery("")
    setVisibility("all")
    setLanguage("all")
    setCiState("all")
    setPageIndex(0)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"))
  }, [])

  const handleRepoScopeChange = useCallback((value: RepoScope) => {
    setRepoScope(value)
    setPageIndex(0)
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

  const showAttentionScope = useCallback(() => {
    setQuery("")
    setVisibility("all")
    setLanguage("all")
    setCiState("all")
    setRepoScope("all")
    setPageIndex(0)
  }, [])

  const handleShowFailing = useCallback(() => {
    showAttentionScope()
    setCiState("failure")
  }, [showAttentionScope])

  const handleShowPullRequests = useCallback(() => {
    showAttentionScope()
    setSort({ key: "openPullRequests", direction: "desc" })
  }, [showAttentionScope])

  const handleShowIssues = useCallback(() => {
    showAttentionScope()
    setSort({ key: "openIssues", direction: "desc" })
  }, [showAttentionScope])

  if (needsLogin) {
    return <SignInScreen />
  }

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
            theme={theme}
            viewMode={viewMode}
            authMode={authMode}
            searchInputRef={searchInputRef}
            onThemeToggle={toggleTheme}
            onViewModeToggle={toggleViewMode}
            onQueryChange={handleQueryChange}
            onVisibilityChange={handleVisibilityChange}
            onLanguageChange={handleLanguageChange}
            onCiStateChange={handleCiStateChange}
            onRefresh={() => void loadDashboard(true)}
          />
          <div className="flex min-h-0 flex-col gap-3 p-3 lg:h-[calc(100vh-3.5rem)] lg:overflow-hidden">
            {error ? <ErrorPanel message={error} retrying={refreshing} onRetry={() => void loadDashboard(true)} /> : null}
            {data ? (
              <>
                <AttentionStrip
                  repos={visibleRepos}
                  runs={visibleRuns}
                  billing={data.billing}
                  detailLevel={data.detailLevel}
                  dismissedRunIds={dismissedRunIds}
                  onShowFailing={handleShowFailing}
                  onShowPullRequests={handleShowPullRequests}
                  onShowIssues={handleShowIssues}
                />
                <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
                  {viewMode === "focus" ? (
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
                  ) : (
                  <div className="grid min-h-0 gap-3 lg:grid-rows-[minmax(0,1fr)_190px]">
                    <RepoTable
                      repos={pagedRepos}
                      totalCount={visibleRepos.length}
                      filteredCount={filteredRepos.length}
                      pageIndex={safePageIndex}
                      pageSize={pageSize}
                      sort={sort}
                      viewerLogin={data.viewer.login}
                      hasActiveFilters={hasActiveFilters}
                      scope={repoScope}
                      activeCount={activeCount}
                      hiddenCount={hiddenRepoIds.size}
                      onScopeChange={handleRepoScopeChange}
                      onToggleRepoHidden={handleToggleRepoHidden}
                      onClearFilters={handleClearFilters}
                      onPageChange={setPageIndex}
                      onPageSizeChange={handlePageSizeChange}
                      onSort={handleSort}
                    />
                    <ActivityPanels
                      commits={visibleActivity.commits}
                      pullRequests={visibleActivity.pullRequests}
                      issues={visibleActivity.issues}
                      isUpdating={data.detailLevel === "quick"}
                    />
                  </div>
                  )}
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
              </>
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
  viewMode,
  authMode,
  searchInputRef,
  onThemeToggle,
  onViewModeToggle,
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
  viewMode: ViewMode
  authMode: "local" | "oauth"
  searchInputRef: RefObject<HTMLInputElement | null>
  onThemeToggle: () => void
  onViewModeToggle: () => void
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
          <Button variant="outline" size="default" onClick={onRefresh} disabled={refreshing}>
            <RefreshCcwIcon data-icon="inline-start" className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
          <div className="hidden min-w-0 items-center gap-2 px-1 text-sm text-muted-foreground md:flex lg:hidden xl:flex">
            <CircleDotIcon
              className={cn(
                "size-4 text-status-success",
                updatingDetails && "animate-pulse text-status-info motion-reduce:animate-none"
              )}
              aria-hidden="true"
            />
            <span className="truncate" aria-live="polite">
              {updatingDetails ? "Updating" : data ? `Refreshed ${formatRelative(data.generatedAt)}` : "Ready"}
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={onViewModeToggle} title={viewMode === "table" ? "Switch to focus view" : "Switch to table view"}>
            {viewMode === "table" ? <PanelLeftIcon className="size-4" aria-hidden="true" /> : <Table2Icon className="size-4" aria-hidden="true" />}
            <span className="sr-only">Switch to {viewMode === "table" ? "focus" : "table"} view</span>
          </Button>
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

function SignInScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-sm">
        <SiGithub className="size-10" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-semibold">GitHub Command Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Repos, PRs, issues, CI health, and Actions billing in one dense view.
          </p>
        </div>
        <Button size="lg" className="w-full" asChild>
          <a href="/auth/login">
            <SiGithub data-icon="inline-start" aria-hidden="true" />
            Sign in with GitHub
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          Requests repo and user scopes to read your repositories, workflow runs, and Actions billing.
          Your token stays in an encrypted cookie in your browser.
        </p>
      </div>
    </div>
  )
}

function ErrorPanel({
  message,
  retrying,
  onRetry,
}: {
  message: string
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Dashboard failed</AlertTitle>
      <AlertDescription>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{message}</span>
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
            <RefreshCcwIcon data-icon="inline-start" className={retrying ? "animate-spin motion-reduce:animate-none" : undefined} />
            {retrying ? "Retrying" : "Retry"}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
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
