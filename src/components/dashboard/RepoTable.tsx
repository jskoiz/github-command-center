import { useEffect, useMemo, useState } from "react"
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns3Icon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
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
import type { RepoScope } from "@/App"
import { formatCompactNumber, formatDecimal, formatDuration, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { RepoSummary } from "@/types/github"
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
  width: number
  minWidth: number
  maxWidth: number
  cellClassName?: string
}

type ColumnDropPosition = "before" | "after"

type ColumnState = {
  order: RepoColumnKey[]
  visible: Set<RepoColumnKey>
  widths: Record<RepoColumnKey, number>
}

const COLUMN_STORAGE_KEY = "github-command-center:repo-columns:v7"
const COLUMN_RESIZE_STEP = 24

const COLUMN_DEFS: RepoColumn[] = [
  { key: "repo", label: "Repo", sortKey: "fullName", required: true, width: 224, minWidth: 168, maxWidth: 420 },
  { key: "language", label: "Lang", sortKey: "language", width: 112, minWidth: 88, maxWidth: 220 },
  { key: "visibility", label: "Vis", sortKey: "visibility", width: 96, minWidth: 88, maxWidth: 180 },
  { key: "stars", label: "Stars", sortKey: "stars", align: "right", width: 80, minWidth: 72, maxWidth: 160, cellClassName: "text-right font-mono" },
  { key: "forks", label: "Forks", sortKey: "forks", align: "right", width: 80, minWidth: 72, maxWidth: 160, cellClassName: "text-right font-mono" },
  { key: "openPullRequests", label: "PRs", sortKey: "openPullRequests", align: "right", width: 72, minWidth: 64, maxWidth: 140, cellClassName: "text-right font-mono" },
  { key: "openIssues", label: "Issues", sortKey: "openIssues", align: "right", width: 84, minWidth: 72, maxWidth: 160, cellClassName: "text-right font-mono" },
  { key: "ci", label: "CI", sortKey: "checkState", align: "center", width: 72, minWidth: 64, maxWidth: 140, cellClassName: "text-center" },
  { key: "pushedAt", label: "Pushed", sortKey: "pushedAt", width: 112, minWidth: 96, maxWidth: 220, cellClassName: "text-muted-foreground" },
  { key: "updatedAt", label: "Updated", sortKey: "updatedAt", width: 112, minWidth: 96, maxWidth: 220, cellClassName: "text-muted-foreground" },
  { key: "lastCommit", label: "Commit", sortKey: "lastCommitAt", width: 288, minWidth: 192, maxWidth: 560, cellClassName: "text-muted-foreground" },
  { key: "lastPullRequest", label: "Last PR", sortKey: "lastPullRequestAt", width: 304, minWidth: 216, maxWidth: 600, cellClassName: "text-muted-foreground" },
  { key: "latestRun", label: "Run", width: 240, minWidth: 176, maxWidth: 520, cellClassName: "text-muted-foreground" },
  { key: "sizeKb", label: "Size", sortKey: "sizeKb", align: "right", width: 88, minWidth: 72, maxWidth: 180, cellClassName: "text-right font-mono" },
  { key: "defaultBranch", label: "Branch", sortKey: "defaultBranch", width: 136, minWidth: 104, maxWidth: 260, cellClassName: "font-mono text-muted-foreground" },
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
  "latestRun",
  "ci",
  "pushedAt",
  "forks",
  "updatedAt",
  "sizeKb",
  "defaultBranch",
]

const DEFAULT_VISIBLE_COLUMNS = new Set<RepoColumnKey>([
  "repo",
  "openPullRequests",
  "openIssues",
  "lastCommit",
  "lastPullRequest",
  "latestRun",
])

const COLUMN_DEF_BY_KEY = new Map(COLUMN_DEFS.map((column) => [column.key, column]))
const DEFAULT_COLUMN_WIDTHS = createDefaultColumnWidths()

export function RepoTable({
  repos,
  totalCount,
  filteredCount,
  pageIndex,
  pageSize,
  sort,
  viewerLogin,
  hasActiveFilters,
  scope,
  activeCount,
  hiddenCount,
  onScopeChange,
  onToggleRepoHidden,
  onClearFilters,
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
  hasActiveFilters?: boolean
  scope?: RepoScope
  activeCount?: number
  hiddenCount?: number
  onScopeChange?: (value: RepoScope) => void
  onToggleRepoHidden?: (id: number) => void
  onClearFilters?: () => void
  onPageChange: (pageIndex: number) => void
  onPageSizeChange: (pageSize: number) => void
  onSort: (key: RepoSortKey) => void
}) {
  const [initialColumnState] = useState<ColumnState>(() => loadColumnState())
  const [columnOrder, setColumnOrder] = useState<RepoColumnKey[]>(() => initialColumnState.order)
  const [visibleColumns, setVisibleColumns] = useState<Set<RepoColumnKey>>(() => initialColumnState.visible)
  const [columnWidths, setColumnWidths] = useState<Record<RepoColumnKey, number>>(() => initialColumnState.widths)
  const [columnPreferencesDirty, setColumnPreferencesDirty] = useState(false)
  const [dragState, setDragState] = useState<{
    source: RepoColumnKey | null
    target: RepoColumnKey | null
    position: ColumnDropPosition
  }>({ source: null, target: null, position: "before" })
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
  const tableWidth = useMemo(() => {
    return renderedColumns.reduce((total, column) => total + getColumnWidth(columnWidths, column.key), 0)
  }, [columnWidths, renderedColumns])

  useEffect(() => {
    if (!columnPreferencesDirty) return

    const payload = {
      order: orderedColumns,
      visible: [...visibleColumns],
      widths: normalizeColumnWidths(columnWidths),
    }
    try {
      window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Column preferences are best-effort and should not break table rendering.
    }
  }, [columnPreferencesDirty, columnWidths, orderedColumns, visibleColumns])

  function toggleColumn(key: RepoColumnKey) {
    const column = COLUMN_DEF_BY_KEY.get(key)
    if (column?.required) return

    setColumnPreferencesDirty(true)
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
    setColumnPreferencesDirty(true)
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

  function moveColumnTo(source: RepoColumnKey, target: RepoColumnKey, position: ColumnDropPosition) {
    setColumnPreferencesDirty(true)
    setColumnOrder((current) => reorderColumn(current, source, target, position))
  }

  function resizeColumn(key: RepoColumnKey, nextWidth: number) {
    setColumnPreferencesDirty(true)
    setColumnWidths((current) => ({
      ...current,
      [key]: normalizeColumnWidth(key, nextWidth),
    }))
  }

  function startColumnResize(key: RepoColumnKey, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = getColumnWidth(columnWidths, key)
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    function handlePointerMove(moveEvent: PointerEvent) {
      resizeColumn(key, startWidth + moveEvent.clientX - startX)
    }

    function handlePointerUp() {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
  }

  function resizeColumnByKeyboard(key: RepoColumnKey, direction: -1 | 1) {
    resizeColumn(key, getColumnWidth(columnWidths, key) + direction * COLUMN_RESIZE_STEP)
  }

  function handleColumnDragStart(key: RepoColumnKey, event: ReactDragEvent<HTMLButtonElement>) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", key)
    setDragState({ source: key, target: key, position: "before" })
  }

  function handleColumnDragOver(key: RepoColumnKey, event: ReactDragEvent<HTMLTableCellElement>) {
    const source = dragState.source ?? getDraggedColumnKey(event)
    if (!source || source === key) return

    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    const bounds = event.currentTarget.getBoundingClientRect()
    const position: ColumnDropPosition = event.clientX - bounds.left > bounds.width / 2 ? "after" : "before"
    setDragState({ source, target: key, position })
  }

  function handleColumnDrop(key: RepoColumnKey, event: ReactDragEvent<HTMLTableCellElement>) {
    const source = dragState.source ?? getDraggedColumnKey(event)
    if (!source || source === key) {
      setDragState({ source: null, target: null, position: "before" })
      return
    }

    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const position: ColumnDropPosition = event.clientX - bounds.left > bounds.width / 2 ? "after" : "before"
    moveColumnTo(source, key, position)
    setDragState({ source: null, target: null, position: "before" })
  }

  function handleColumnDragEnd() {
    setDragState({ source: null, target: null, position: "before" })
  }

  function resetColumns() {
    setColumnPreferencesDirty(true)
    setColumnOrder(DEFAULT_COLUMN_ORDER)
    setVisibleColumns(new Set(DEFAULT_VISIBLE_COLUMNS))
    setColumnWidths({ ...DEFAULT_COLUMN_WIDTHS })
  }

  return (
    <Card id="repos" className="min-h-0 gap-0 rounded-lg py-0 shadow-sm shadow-foreground/[0.02] lg:h-full">
      <CardHeader className="min-h-10 items-center border-b px-3 py-1.5 [.border-b]:pb-1.5">
        <CardTitle className="flex items-center gap-2 text-sm leading-none">
          Repositories
          <Badge variant="outline" className="h-5 px-1.5 font-mono">
            {filteredCount}
          </Badge>
          {onScopeChange ? (
            <div role="group" aria-label="Repository scope" className="flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5">
              <Button
                variant={scope === "active" ? "secondary" : "ghost"}
                size="xs"
                className="h-5 px-1.5 text-[11px]"
                aria-pressed={scope === "active"}
                onClick={() => onScopeChange("active")}
              >
                Active {activeCount ?? 0}
              </Button>
              <Button
                variant={scope === "all" ? "secondary" : "ghost"}
                size="xs"
                className="h-5 px-1.5 text-[11px]"
                aria-pressed={scope === "all"}
                onClick={() => onScopeChange("all")}
              >
                All {totalCount}
              </Button>
              {(hiddenCount ?? 0) > 0 || scope === "hidden" ? (
                <Button
                  variant={scope === "hidden" ? "secondary" : "ghost"}
                  size="xs"
                  className="h-5 px-1.5 text-[11px]"
                  aria-pressed={scope === "hidden"}
                  onClick={() => onScopeChange("hidden")}
                >
                  Hidden {hiddenCount ?? 0}
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardTitle>
        <CardAction>
          <div className="flex items-center gap-2">
            <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger size="sm" className="hidden w-24 sm:flex">
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
                  <span className="hidden sm:inline">Columns</span>
                  <span className="sr-only sm:hidden">Columns</span>
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
                      <div key={key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted">
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
                        <div className="px-1 font-mono text-[11px] text-muted-foreground">
                          {getColumnWidth(columnWidths, key)}
                        </div>
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
            <Badge variant="outline" className="hidden h-6 px-2 font-mono md:inline-flex">
              live gh
            </Badge>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-0 py-0">
        <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
          <Table className="table-fixed text-xs leading-none" style={{ width: tableWidth, minWidth: tableWidth }}>
            <colgroup>
              {renderedColumns.map((column) => (
                <col
                  key={column.key}
                  style={{
                    width: getColumnWidth(columnWidths, column.key),
                    minWidth: column.minWidth,
                    maxWidth: column.maxWidth,
                  }}
                />
              ))}
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
              <TableRow>
                {renderedColumns.map((column) => (
                  <RepoHead
                    key={column.key}
                    column={column}
                    width={getColumnWidth(columnWidths, column.key)}
                    sort={sort}
                    isDragTarget={dragState.target === column.key && dragState.source !== column.key}
                    dropPosition={dragState.position}
                    onSort={onSort}
                    onResizeStart={startColumnResize}
                    onResizeByKeyboard={resizeColumnByKeyboard}
                    onColumnDragStart={handleColumnDragStart}
                    onColumnDragOver={handleColumnDragOver}
                    onColumnDrop={handleColumnDrop}
                    onColumnDragEnd={handleColumnDragEnd}
                  />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {repos.map((repo) => (
                <TableRow key={repo.id} className="group h-11 hover:bg-muted/40">
                  {renderedColumns.map((column) => (
                    <RepoCell
                      key={column.key}
                      column={column}
                      width={getColumnWidth(columnWidths, column.key)}
                      repo={repo}
                      viewerLogin={viewerLogin}
                      isHiddenScope={scope === "hidden"}
                      onToggleRepoHidden={onToggleRepoHidden}
                    />
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {repos.length === 0 ? (
            <div className="sticky left-0 flex flex-col items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <span>
                {hasActiveFilters
                  ? "No repositories match the current filters."
                  : scope === "hidden"
                    ? "No hidden repositories."
                    : scope === "active" && totalCount > 0
                      ? "No repositories with recent activity."
                      : "No repositories found."}
              </span>
              <div className="flex items-center gap-2">
                {hasActiveFilters && onClearFilters ? (
                  <Button variant="outline" size="sm" onClick={onClearFilters}>
                    Clear filters
                  </Button>
                ) : null}
                {scope === "active" && totalCount > 0 && onScopeChange ? (
                  <Button variant="outline" size="sm" onClick={() => onScopeChange("all")}>
                    Show all {totalCount}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex min-h-9 items-center justify-between gap-3 border-t bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
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
            {pageCount > 1 && Array.from({ length: Math.min(3, pageCount) }, (_, index) => {
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
  width,
  sort,
  isDragTarget,
  dropPosition,
  onSort,
  onResizeStart,
  onResizeByKeyboard,
  onColumnDragStart,
  onColumnDragOver,
  onColumnDrop,
  onColumnDragEnd,
}: {
  column: RepoColumn
  width: number
  sort: RepoSort
  isDragTarget: boolean
  dropPosition: ColumnDropPosition
  onSort: (key: RepoSortKey) => void
  onResizeStart: (key: RepoColumnKey, event: ReactPointerEvent<HTMLButtonElement>) => void
  onResizeByKeyboard: (key: RepoColumnKey, direction: -1 | 1) => void
  onColumnDragStart: (key: RepoColumnKey, event: ReactDragEvent<HTMLButtonElement>) => void
  onColumnDragOver: (key: RepoColumnKey, event: ReactDragEvent<HTMLTableCellElement>) => void
  onColumnDrop: (key: RepoColumnKey, event: ReactDragEvent<HTMLTableCellElement>) => void
  onColumnDragEnd: () => void
}) {
  const alignClassName =
    column.align === "right" ? "text-right" :
    column.align === "center" ? "text-center" :
    undefined
  const headerClassName = cn(
    "group relative h-8 select-none px-0 text-xs",
    alignClassName,
    isDragTarget && "ring-1 ring-inset ring-ring/60",
    isDragTarget && dropPosition === "before" && "shadow-[-2px_0_0_0_var(--ring)]",
    isDragTarget && dropPosition === "after" && "shadow-[2px_0_0_0_var(--ring)]"
  )
  const headerStyle = { width, minWidth: column.minWidth, maxWidth: column.maxWidth }

  const active = sort.key === column.sortKey
  const Icon = !active ? ArrowUpDownIcon : sort.direction === "asc" ? ArrowUpIcon : ArrowDownIcon

  return (
    <TableHead
      className={headerClassName}
      style={headerStyle}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
      data-column-key={column.key}
      onDragOver={(event) => onColumnDragOver(column.key, event)}
      onDrop={(event) => onColumnDrop(column.key, event)}
    >
      <div
        className={cn(
          "flex h-full min-w-0 items-center gap-1 px-1.5 pr-3",
          column.align === "right" && "justify-end",
          column.align === "center" && "justify-center"
        )}
      >
        <button
          type="button"
          draggable
          className="grid size-4 shrink-0 cursor-grab place-items-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-50 active:cursor-grabbing"
          aria-label={`Drag ${column.label} column`}
          title={`Drag ${column.label} column`}
          onDragStart={(event) => onColumnDragStart(column.key, event)}
          onDragEnd={onColumnDragEnd}
        >
          <GripVerticalIcon className="size-3.5" aria-hidden="true" />
        </button>
        {column.sortKey ? (
          <Button
            variant="ghost"
            size="xs"
            className={cn(
              "h-6 min-w-0 px-1 font-medium text-foreground/90 hover:bg-background/70",
              column.align === "right" && "ml-auto",
              column.align === "center" && "mx-auto"
            )}
            onClick={() => onSort(column.sortKey!)}
          >
            <span className="truncate">{column.label}</span>
            <Icon data-icon="inline-end" />
          </Button>
        ) : (
          <span className="min-w-0 truncate px-1 font-medium text-foreground/90">{column.label}</span>
        )}
      </div>
      <button
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${column.label} column`}
        aria-valuemin={column.minWidth}
        aria-valuemax={column.maxWidth}
        aria-valuenow={width}
        title={`Resize ${column.label} column`}
        className="absolute top-0 right-0 z-20 h-full w-2 translate-x-1/2 cursor-col-resize touch-none rounded-sm outline-none after:absolute after:top-1 after:right-1/2 after:h-[calc(100%-0.5rem)] after:w-px after:bg-border/80 after:content-[''] hover:after:bg-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:after:bg-ring"
        onPointerDown={(event) => onResizeStart(column.key, event)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault()
            onResizeByKeyboard(column.key, -1)
          }
          if (event.key === "ArrowRight") {
            event.preventDefault()
            onResizeByKeyboard(column.key, 1)
          }
        }}
      />
    </TableHead>
  )
}

function RepoCell({
  column,
  width,
  repo,
  viewerLogin,
  isHiddenScope,
  onToggleRepoHidden,
}: {
  column: RepoColumn
  width: number
  repo: RepoSummary
  viewerLogin: string
  isHiddenScope?: boolean
  onToggleRepoHidden?: (id: number) => void
}) {
  return (
    <TableCell
      className={cn("h-11 overflow-hidden px-2 py-0 align-middle text-ellipsis", column.cellClassName)}
      style={{ width, minWidth: column.minWidth, maxWidth: column.maxWidth }}
    >
      {renderRepoCell(column.key, repo, viewerLogin, isHiddenScope, onToggleRepoHidden)}
    </TableCell>
  )
}

function renderRepoCell(
  key: RepoColumnKey,
  repo: RepoSummary,
  viewerLogin: string,
  isHiddenScope?: boolean,
  onToggleRepoHidden?: (id: number) => void
) {
  if (key === "repo") {
    return (
      <div className="flex min-w-0 max-w-full items-center gap-1.5">
        <StatusBadge
          compact
          state={repo.latestRun?.conclusion ?? repo.latestRun?.status ?? repo.checkState}
          className="size-4 shrink-0 [&>svg]:size-3"
        />
        <a
          href={repo.url}
          target="_blank"
          rel="noreferrer"
          className="group/link flex min-w-0 items-center gap-1.5 rounded-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          title={repo.fullName}
        >
          <span className="truncate">{displayRepoName(repo, viewerLogin)}</span>
          <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/link:opacity-100" aria-hidden="true" />
        </a>
        {onToggleRepoHidden ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
            title={isHiddenScope ? "Unhide repository" : "Hide repository"}
            onClick={() => onToggleRepoHidden(repo.id)}
          >
            {isHiddenScope
              ? <EyeIcon className="size-3.5" aria-hidden="true" />
              : <EyeOffIcon className="size-3.5" aria-hidden="true" />}
            <span className="sr-only">{isHiddenScope ? "Unhide" : "Hide"} {repo.name}</span>
          </Button>
        ) : null}
      </div>
    )
  }

  if (key === "language") return repo.language ?? <EmptyValue />

  if (key === "visibility") {
    return (
      <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[11px] capitalize text-muted-foreground">
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
    const latestCommit = repo.latestCommit
    if (!latestCommit) return <EmptyValue />
    return (
      <a
        href={latestCommit.url}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 max-w-full flex-col justify-center rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        title={`${latestCommit.message} · ${formatRelative(latestCommit.date)}`}
      >
        <span className="min-w-0 truncate leading-4 text-foreground">{latestCommit.message}</span>
        <span className="truncate text-[11px] leading-4 text-muted-foreground">
          <span className="font-mono">{latestCommit.shortSha}</span> · {formatRelative(latestCommit.date)}
        </span>
      </a>
    )
  }

  if (key === "lastPullRequest") {
    const latestPullRequest = repo.latestPullRequest
    if (!latestPullRequest) return <EmptyValue />

    return (
      <a
        href={latestPullRequest.url}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 max-w-full flex-col justify-center rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        title={`#${latestPullRequest.number} ${latestPullRequest.title} · ${latestPullRequest.state} · ${formatRelative(latestPullRequest.updatedAt)}`}
      >
        <span className="min-w-0 truncate leading-4 text-foreground">{latestPullRequest.title}</span>
        <span className="truncate text-[11px] leading-4 text-muted-foreground">
          <span className="font-mono">#{latestPullRequest.number}</span>
          {" · "}
          <span className={cn("capitalize", pullRequestStateClassName(latestPullRequest.state))}>{latestPullRequest.state}</span>
          {" · "}
          {formatRelative(latestPullRequest.updatedAt)}
        </span>
      </a>
    )
  }

  if (key === "latestRun") {
    if (!repo.latestRun) return <EmptyValue />
    return (
      <a href={repo.latestRun.url} target="_blank" rel="noreferrer" className="flex min-w-0 max-w-full items-center gap-1.5 rounded-sm whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
        <span className="truncate">{repo.latestRun.name}</span>
        <span className="shrink-0 font-mono text-[11px]">{formatDuration(repo.latestRun.durationSeconds)}</span>
      </a>
    )
  }

  if (key === "sizeKb") return formatRepoSize(repo.sizeKb)
  if (key === "defaultBranch") return repo.defaultBranch ?? <EmptyValue />

  return null
}

function pullRequestStateClassName(state: string) {
  if (state === "open") return "text-status-success"
  if (state === "merged") return "text-status-info"
  return "text-muted-foreground"
}

function EmptyValue() {
  return <span className="text-muted-foreground/70">none</span>
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

function reorderColumn(
  order: RepoColumnKey[],
  source: RepoColumnKey,
  target: RepoColumnKey,
  position: ColumnDropPosition
) {
  if (source === target) return normalizeColumnOrder(order)

  const next = normalizeColumnOrder(order).filter((key) => key !== source)
  const targetIndex = next.indexOf(target)
  if (targetIndex < 0) return normalizeColumnOrder(order)

  const insertIndex = targetIndex + (position === "after" ? 1 : 0)
  next.splice(insertIndex, 0, source)
  return next
}

function createDefaultColumnWidths() {
  return Object.fromEntries(COLUMN_DEFS.map((column) => [column.key, column.width])) as Record<RepoColumnKey, number>
}

function normalizeColumnWidths(widths: Partial<Record<RepoColumnKey, number>>) {
  return Object.fromEntries(
    COLUMN_DEFS.map((column) => [
      column.key,
      normalizeColumnWidth(column.key, widths[column.key] ?? column.width),
    ])
  ) as Record<RepoColumnKey, number>
}

function normalizeColumnWidth(key: RepoColumnKey, width: number) {
  const column = COLUMN_DEF_BY_KEY.get(key)
  if (!column || !Number.isFinite(width)) return DEFAULT_COLUMN_WIDTHS[key]
  return Math.min(column.maxWidth, Math.max(column.minWidth, Math.round(width)))
}

function getColumnWidth(widths: Record<RepoColumnKey, number>, key: RepoColumnKey) {
  return normalizeColumnWidth(key, widths[key])
}

function getDraggedColumnKey(event: ReactDragEvent) {
  const value = event.dataTransfer.getData("text/plain")
  return COLUMN_DEF_BY_KEY.has(value as RepoColumnKey) ? value as RepoColumnKey : null
}

function loadColumnState(): ColumnState {
  if (typeof window === "undefined") {
    return {
      order: DEFAULT_COLUMN_ORDER,
      visible: new Set(DEFAULT_VISIBLE_COLUMNS),
      widths: DEFAULT_COLUMN_WIDTHS,
    }
  }

  try {
    const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY)
    if (!raw) {
      return {
        order: DEFAULT_COLUMN_ORDER,
        visible: new Set(DEFAULT_VISIBLE_COLUMNS),
        widths: DEFAULT_COLUMN_WIDTHS,
      }
    }

    const parsed = JSON.parse(raw) as {
      order?: RepoColumnKey[]
      visible?: RepoColumnKey[]
      widths?: Partial<Record<RepoColumnKey, number>>
    }
    const order = normalizeColumnOrder(Array.isArray(parsed.order) ? parsed.order : DEFAULT_COLUMN_ORDER)
    const visible = new Set(
      (Array.isArray(parsed.visible) ? parsed.visible : [...DEFAULT_VISIBLE_COLUMNS])
        .filter((key) => COLUMN_DEF_BY_KEY.has(key))
    )
    visible.add("repo")
    return {
      order,
      visible,
      widths: normalizeColumnWidths(parsed.widths ?? DEFAULT_COLUMN_WIDTHS),
    }
  } catch {
    return {
      order: DEFAULT_COLUMN_ORDER,
      visible: new Set(DEFAULT_VISIBLE_COLUMNS),
      widths: DEFAULT_COLUMN_WIDTHS,
    }
  }
}

function formatRepoSize(sizeKb: number) {
  if (sizeKb >= 1024) {
    return `${formatDecimal(Math.round(sizeKb / 102.4) / 10, 1)} MB`
  }
  return `${formatCompactNumber(sizeKb)} KB`
}
