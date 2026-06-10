import { useEffect, useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns3Icon,
  ExternalLinkIcon,
  RotateCcwIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCompactNumber, formatDecimal, formatDuration, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CommitSummary, IssueSummary, RepoSummary } from "@/types/github"
import { StatusBadge } from "./StatusBadge"

export type RepoSortKey =
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

export type RepoSort = {
  key: RepoSortKey
  direction: "asc" | "desc"
}

type RepoColumnKey =
  | "repo"
  | "language"
  | "visibility"
  | "stars"
  | "forks"
  | "openPullRequests"
  | "openIssues"
  | "ci"
  | "pushedAt"
  | "updatedAt"
  | "lastCommit"
  | "lastPullRequest"
  | "latestRun"
  | "sizeKb"
  | "defaultBranch"

type RepoColumn = {
  key: RepoColumnKey
  label: string
  sortKey?: RepoSortKey
  align?: "left" | "right" | "center"
  required?: boolean
  headerClassName?: string
  cellClassName?: string
}

const COLUMN_STORAGE_KEY = "github-command-center:repo-columns:v2"

const COLUMN_DEFS: RepoColumn[] = [
  { key: "repo", label: "Repo", sortKey: "fullName", required: true, headerClassName: "w-56", cellClassName: "w-56 max-w-56" },
  { key: "language", label: "Lang", sortKey: "language", headerClassName: "w-28", cellClassName: "w-28" },
  { key: "visibility", label: "Vis", sortKey: "visibility", headerClassName: "w-24", cellClassName: "w-24" },
  { key: "stars", label: "Stars", sortKey: "stars", align: "right", headerClassName: "w-20", cellClassName: "w-20 text-right font-mono" },
  { key: "forks", label: "Forks", sortKey: "forks", align: "right", headerClassName: "w-20", cellClassName: "w-20 text-right font-mono" },
  { key: "openPullRequests", label: "PRs", sortKey: "openPullRequests", align: "right", headerClassName: "w-18", cellClassName: "w-18 text-right font-mono" },
  { key: "openIssues", label: "Issues", sortKey: "openIssues", align: "right", headerClassName: "w-20", cellClassName: "w-20 text-right font-mono" },
  { key: "ci", label: "CI", sortKey: "checkState", align: "center", headerClassName: "w-16", cellClassName: "w-16 text-center" },
  { key: "pushedAt", label: "Pushed", sortKey: "pushedAt", headerClassName: "w-28", cellClassName: "w-28 whitespace-nowrap text-muted-foreground" },
  { key: "updatedAt", label: "Updated", sortKey: "updatedAt", headerClassName: "w-28", cellClassName: "w-28 whitespace-nowrap text-muted-foreground" },
  { key: "lastCommit", label: "Commit", sortKey: "lastCommitAt", headerClassName: "min-w-64", cellClassName: "min-w-64 text-muted-foreground" },
  { key: "lastPullRequest", label: "Last PR", sortKey: "lastPullRequestAt", headerClassName: "min-w-56", cellClassName: "min-w-56 text-muted-foreground" },
  { key: "latestRun", label: "Run", headerClassName: "min-w-52", cellClassName: "min-w-52 text-muted-foreground" },
  { key: "sizeKb", label: "Size", sortKey: "sizeKb", align: "right", headerClassName: "w-20", cellClassName: "w-20 text-right font-mono" },
  { key: "defaultBranch", label: "Branch", sortKey: "defaultBranch", headerClassName: "w-32", cellClassName: "w-32 font-mono text-muted-foreground" },
]

const DEFAULT_COLUMN_ORDER: RepoColumnKey[] = [
  "repo",
  "language",
  "visibility",
  "stars",
  "openPullRequests",
  "openIssues",
  "lastCommit",
  "lastPullRequest",
  "ci",
  "latestRun",
  "pushedAt",
  "forks",
  "updatedAt",
  "sizeKb",
  "defaultBranch",
]

const DEFAULT_VISIBLE_COLUMNS = new Set<RepoColumnKey>([
  "repo",
  "language",
  "visibility",
  "stars",
  "openPullRequests",
  "openIssues",
  "lastCommit",
  "lastPullRequest",
  "ci",
  "latestRun",
])

const COLUMN_DEF_BY_KEY = new Map(COLUMN_DEFS.map((column) => [column.key, column]))

export function RepoTable({
  repos,
  totalCount,
  filteredCount,
  pageIndex,
  pageSize,
  sort,
  viewerLogin,
  latestCommitByRepo,
  latestPullRequestByRepo,
  onPageChange,
  onPageSizeChange,
  onSort,
}: {
  repos: RepoSummary[]
  totalCount: number
  filteredCount: number
  pageIndex: number
  pageSize: number
  sort: RepoSort
  viewerLogin: string
  latestCommitByRepo: Map<string, CommitSummary>
  latestPullRequestByRepo: Map<string, IssueSummary>
  onPageChange: (pageIndex: number) => void
  onPageSizeChange: (pageSize: number) => void
  onSort: (key: RepoSortKey) => void
}) {
  const [columnOrder, setColumnOrder] = useState<RepoColumnKey[]>(() => loadColumnState().order)
  const [visibleColumns, setVisibleColumns] = useState<Set<RepoColumnKey>>(() => loadColumnState().visible)
  const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize))
  const canGoPrevious = pageIndex > 0
  const canGoNext = pageIndex < pageCount - 1

  const orderedColumns = useMemo(() => normalizeColumnOrder(columnOrder), [columnOrder])
  const renderedColumns = useMemo(() => {
    return orderedColumns
      .filter((key) => visibleColumns.has(key))
      .map((key) => COLUMN_DEF_BY_KEY.get(key))
      .filter((column): column is RepoColumn => Boolean(column))
  }, [orderedColumns, visibleColumns])

  useEffect(() => {
    const payload = {
      order: orderedColumns,
      visible: [...visibleColumns],
    }
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(payload))
  }, [orderedColumns, visibleColumns])

  function toggleColumn(key: RepoColumnKey) {
    const column = COLUMN_DEF_BY_KEY.get(key)
    if (column?.required) return

    setVisibleColumns((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  function moveColumn(key: RepoColumnKey, direction: -1 | 1) {
    setColumnOrder((current) => {
      const next = normalizeColumnOrder(current)
      const index = next.indexOf(key)
      const target = index + direction
      if (index < 0 || target < 0 || target >= next.length) return next
      const swap = next[target]
      next[target] = key
      next[index] = swap
      return [...next]
    })
  }

  function resetColumns() {
    setColumnOrder(DEFAULT_COLUMN_ORDER)
    setVisibleColumns(new Set(DEFAULT_VISIBLE_COLUMNS))
  }

  return (
    <Card id="repos" className="min-h-0 gap-0 rounded-lg py-0 lg:h-full">
      <CardHeader className="border-b px-3 py-1.5 [.border-b]:pb-1.5">
        <CardTitle className="flex items-center gap-2 text-sm">
          Repositories
          <Badge variant="outline" className="font-mono">
            {filteredCount}
          </Badge>
        </CardTitle>
        <CardAction>
          <div className="hidden items-center gap-2 sm:flex">
            <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger size="sm" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="10">Show 10</SelectItem>
                  <SelectItem value="15">Show 15</SelectItem>
                  <SelectItem value="25">Show 25</SelectItem>
                  <SelectItem value="50">Show 50</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Columns3Icon data-icon="inline-start" />
                  Columns
                  <ChevronDownIcon data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <div>
                    <div className="text-sm font-medium">Columns</div>
                    <div className="text-xs text-muted-foreground">Show, hide, and reorder.</div>
                  </div>
                  <Button variant="ghost" size="xs" onClick={resetColumns}>
                    <RotateCcwIcon data-icon="inline-start" />
                    Reset
                  </Button>
                </div>
                <div className="max-h-80 overflow-y-auto px-1 pb-1">
                  {orderedColumns.map((key, index) => {
                    const column = COLUMN_DEF_BY_KEY.get(key)
                    if (!column) return null
                    const isVisible = visibleColumns.has(key)

                    return (
                      <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted">
                        <label className="flex min-w-0 items-center gap-2 px-1 py-1 text-sm">
                          <input
                            type="checkbox"
                            checked={isVisible}
                            disabled={column.required}
                            className="size-3.5 accent-foreground"
                            onChange={() => toggleColumn(key)}
                          />
                          <span className="truncate">{column.label}</span>
                          {column.required ? <span className="text-xs text-muted-foreground">locked</span> : null}
                        </label>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={index === 0}
                          onClick={() => moveColumn(key, -1)}
                        >
                          <ArrowUpIcon data-icon="inline-start" />
                          <span className="sr-only">Move {column.label} left</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={index === orderedColumns.length - 1}
                          onClick={() => moveColumn(key, 1)}
                        >
                          <ArrowDownIcon data-icon="inline-start" />
                          <span className="sr-only">Move {column.label} right</span>
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <Badge variant="outline" className="font-mono">
              live gh
            </Badge>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-0 py-0">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="min-w-max text-xs">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                {renderedColumns.map((column) => (
                  <RepoHead key={column.key} column={column} sort={sort} onSort={onSort} />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {repos.map((repo) => (
                <TableRow key={repo.id} className="h-9">
                  {renderedColumns.map((column) => (
                    <RepoCell
                      key={column.key}
                      column={column}
                      repo={repo}
                      viewerLogin={viewerLogin}
                      latestCommit={latestCommitByRepo.get(repo.fullName)}
                      latestPullRequest={latestPullRequestByRepo.get(repo.fullName)}
                    />
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
          <div className="hidden sm:block">
            Showing {repos.length ? pageIndex * pageSize + 1 : 0}-{Math.min(filteredCount, (pageIndex + 1) * pageSize)} of {filteredCount}
            {filteredCount !== totalCount ? ` filtered from ${totalCount}` : ""}
          </div>
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger size="sm" className="w-24 sm:hidden">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="10">Show 10</SelectItem>
                <SelectItem value="15">Show 15</SelectItem>
                <SelectItem value="25">Show 25</SelectItem>
                <SelectItem value="50">Show 50</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon-xs" disabled={!canGoPrevious} onClick={() => onPageChange(pageIndex - 1)}>
              <ChevronLeftIcon data-icon="inline-start" />
              <span className="sr-only">Previous page</span>
            </Button>
            {Array.from({ length: Math.min(3, pageCount) }, (_, index) => {
              const start = Math.min(Math.max(0, pageIndex - 1), Math.max(0, pageCount - 3))
              const page = start + index
              return (
                <Button
                  key={page}
                  variant={page === pageIndex ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => onPageChange(page)}
                >
                  {page + 1}
                </Button>
              )
            })}
            <Button variant="ghost" size="icon-xs" disabled={!canGoNext} onClick={() => onPageChange(pageIndex + 1)}>
              <ChevronRightIcon data-icon="inline-start" />
              <span className="sr-only">Next page</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function RepoHead({
  column,
  sort,
  onSort,
}: {
  column: RepoColumn
  sort: RepoSort
  onSort: (key: RepoSortKey) => void
}) {
  const alignClassName =
    column.align === "right" ? "text-right" :
    column.align === "center" ? "text-center" :
    undefined

  if (!column.sortKey) {
    return (
      <TableHead className={cn("h-7 px-2 text-xs", alignClassName, column.headerClassName)}>
        {column.label}
      </TableHead>
    )
  }

  const active = sort.key === column.sortKey
  const Icon = !active ? ArrowUpDownIcon : sort.direction === "asc" ? ArrowUpIcon : ArrowDownIcon

  return (
    <TableHead className={cn("h-7 px-2 text-xs", alignClassName, column.headerClassName)}>
      <Button
        variant="ghost"
        size="xs"
        className={cn(
          "px-1",
          column.align === "right" && "ml-auto",
          column.align === "center" && "mx-auto"
        )}
        onClick={() => onSort(column.sortKey!)}
      >
        {column.label}
        <Icon data-icon="inline-end" />
      </Button>
    </TableHead>
  )
}

function RepoCell({
  column,
  repo,
  viewerLogin,
  latestCommit,
  latestPullRequest,
}: {
  column: RepoColumn
  repo: RepoSummary
  viewerLogin: string
  latestCommit: CommitSummary | undefined
  latestPullRequest: IssueSummary | undefined
}) {
  return (
    <TableCell className={cn("h-9 px-2 py-0 align-middle", column.cellClassName)}>
      {renderRepoCell(column.key, repo, viewerLogin, latestCommit, latestPullRequest)}
    </TableCell>
  )
}

function renderRepoCell(
  key: RepoColumnKey,
  repo: RepoSummary,
  viewerLogin: string,
  latestCommit: CommitSummary | undefined,
  latestPullRequest: IssueSummary | undefined
) {
  if (key === "repo") {
    return (
      <a
        href={repo.url}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex min-w-0 max-w-56 items-center gap-1.5 font-medium text-foreground"
        title={repo.fullName}
      >
        <span className="truncate">{displayRepoName(repo, viewerLogin)}</span>
        <ExternalLinkIcon className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </a>
    )
  }

  if (key === "language") return repo.language ?? "-"

  if (key === "visibility") {
    return (
      <Badge variant="outline" className="h-5 capitalize">
        {repo.visibility}
      </Badge>
    )
  }

  if (key === "stars") return formatCompactNumber(repo.stars)
  if (key === "forks") return formatCompactNumber(repo.forks)
  if (key === "openPullRequests") return repo.openPullRequests ?? "-"
  if (key === "openIssues") return repo.openIssues ?? "-"

  if (key === "ci") {
    return <StatusBadge compact state={repo.latestRun?.conclusion ?? repo.latestRun?.status ?? repo.checkState} />
  }

  if (key === "pushedAt") return formatRelative(repo.pushedAt)
  if (key === "updatedAt") return formatRelative(repo.updatedAt)

  if (key === "lastCommit") {
    if (!latestCommit) return "-"
    return (
      <a
        href={latestCommit.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-72 items-center gap-1.5 whitespace-nowrap hover:text-foreground"
        title={`${latestCommit.message} · ${formatRelative(latestCommit.date)}`}
      >
        <span className="min-w-0 truncate text-foreground">{latestCommit.message}</span>
        <span className="shrink-0 font-mono text-[11px]">{latestCommit.shortSha}</span>
        <span className="shrink-0 text-[11px]">{formatRelative(latestCommit.date)}</span>
      </a>
    )
  }

  if (key === "lastPullRequest") {
    if (!latestPullRequest) return "-"
    return (
      <a
        href={latestPullRequest.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-64 items-center gap-1.5 whitespace-nowrap hover:text-foreground"
        title={`#${latestPullRequest.number} ${latestPullRequest.title} · ${formatRelative(latestPullRequest.updatedAt)}`}
      >
        <span className="shrink-0 font-mono text-[11px]">#{latestPullRequest.number}</span>
        <span className="min-w-0 truncate text-foreground">{latestPullRequest.title}</span>
        <span className="shrink-0 rounded-sm border px-1 py-px text-[10px] leading-none capitalize">{latestPullRequest.state}</span>
        <span className="shrink-0 text-[11px]">{formatRelative(latestPullRequest.updatedAt)}</span>
      </a>
    )
  }

  if (key === "latestRun") {
    if (!repo.latestRun) return "none"
    return (
      <a href={repo.latestRun.url} target="_blank" rel="noreferrer" className="inline-flex max-w-72 items-center gap-1.5 whitespace-nowrap hover:text-foreground">
        <span className="truncate">{repo.latestRun.name}</span>
        <span className="shrink-0 font-mono text-[11px]">{formatDuration(repo.latestRun.durationSeconds)}</span>
      </a>
    )
  }

  if (key === "sizeKb") return formatRepoSize(repo.sizeKb)
  if (key === "defaultBranch") return repo.defaultBranch ?? "-"

  return null
}

function displayRepoName(repo: RepoSummary, viewerLogin: string) {
  return repo.owner === viewerLogin ? repo.name : repo.fullName
}

function normalizeColumnOrder(order: RepoColumnKey[]) {
  const knownKeys = new Set(COLUMN_DEFS.map((column) => column.key))
  const normalized = order.filter((key, index) => knownKeys.has(key) && order.indexOf(key) === index)
  const missing = DEFAULT_COLUMN_ORDER.filter((key) => !normalized.includes(key))
  return [...normalized, ...missing]
}

function loadColumnState() {
  if (typeof window === "undefined") {
    return { order: DEFAULT_COLUMN_ORDER, visible: new Set(DEFAULT_VISIBLE_COLUMNS) }
  }

  try {
    const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY)
    if (!raw) return { order: DEFAULT_COLUMN_ORDER, visible: new Set(DEFAULT_VISIBLE_COLUMNS) }
    const parsed = JSON.parse(raw) as { order?: RepoColumnKey[]; visible?: RepoColumnKey[] }
    const order = normalizeColumnOrder(Array.isArray(parsed.order) ? parsed.order : DEFAULT_COLUMN_ORDER)
    const visible = new Set(
      (Array.isArray(parsed.visible) ? parsed.visible : [...DEFAULT_VISIBLE_COLUMNS])
        .filter((key) => COLUMN_DEF_BY_KEY.has(key))
    )
    visible.add("repo")
    return { order, visible }
  } catch {
    return { order: DEFAULT_COLUMN_ORDER, visible: new Set(DEFAULT_VISIBLE_COLUMNS) }
  }
}

function formatRepoSize(sizeKb: number) {
  if (sizeKb >= 1024) {
    return `${formatDecimal(Math.round(sizeKb / 102.4) / 10, 1)} MB`
  }
  return `${formatCompactNumber(sizeKb)} KB`
}
