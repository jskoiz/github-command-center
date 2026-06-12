import { useState } from "react"
import {
  CircleDotIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  XIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import type { RepoScope } from "@/App"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatCompactNumber, formatRelative, shortRepoName } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CommitSummary, IssueSummary, RepoSummary } from "@/types/github"
import { StatusBadge } from "./StatusBadge"

type PullRequestStateFilter = "all" | "open" | "draft" | "closed"
type IssueStateFilter = "all" | "open" | "closed"

function matchesPullRequestState(item: IssueSummary, filter: PullRequestStateFilter): boolean {
  if (filter === "all") return true
  if (filter === "draft") return Boolean(item.isDraft)
  if (filter === "open") return item.state === "open" && !item.isDraft
  return item.state === "closed"
}

function matchesIssueState(item: IssueSummary, filter: IssueStateFilter): boolean {
  if (filter === "all") return true
  return item.state === filter
}

export function FocusView({
  repos,
  scope,
  activeCount,
  totalCount,
  hiddenCount,
  commits,
  pullRequests,
  issues,
  isUpdating,
  selectedRepo,
  viewerLogin,
  onScopeChange,
  onSelectRepo,
  onToggleRepoHidden,
}: {
  repos: RepoSummary[]
  scope: RepoScope
  activeCount: number
  totalCount: number
  hiddenCount: number
  commits: CommitSummary[]
  pullRequests: IssueSummary[]
  issues: IssueSummary[]
  isUpdating: boolean
  selectedRepo: string | null
  viewerLogin: string
  onScopeChange: (scope: RepoScope) => void
  onSelectRepo: (fullName: string | null) => void
  onToggleRepoHidden: (id: number) => void
}) {
  const [prState, setPrState] = useState<PullRequestStateFilter>("all")
  const [issueState, setIssueState] = useState<IssueStateFilter>("all")

  const repoPullRequests = selectedRepo ? pullRequests.filter((item) => item.repo === selectedRepo) : pullRequests
  const repoIssues = selectedRepo ? issues.filter((item) => item.repo === selectedRepo) : issues
  const scopedCommits = selectedRepo ? commits.filter((commit) => commit.repo === selectedRepo) : commits

  const scopedPullRequests = repoPullRequests.filter((item) => matchesPullRequestState(item, prState))
  const scopedIssues = repoIssues.filter((item) => matchesIssueState(item, issueState))

  return (
    <div className="grid min-h-0 gap-3 lg:h-full lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_minmax(0,1fr)]">
      <RepoSidebar
        repos={repos}
        scope={scope}
        activeCount={activeCount}
        totalCount={totalCount}
        hiddenCount={hiddenCount}
        selectedRepo={selectedRepo}
        viewerLogin={viewerLogin}
        onScopeChange={onScopeChange}
        onSelectRepo={onSelectRepo}
        onToggleRepoHidden={onToggleRepoHidden}
      />
      <FeedCard
        title="Pull Requests"
        icon={GitPullRequestIcon}
        count={scopedPullRequests.length}
        href="https://github.com/pulls"
        selectedRepo={selectedRepo}
        filter={
          <StateFilterControl
            label="Filter pull requests by state"
            value={prState}
            options={[
              { value: "all", label: "All" },
              { value: "open", label: "Open" },
              { value: "draft", label: "Draft" },
              { value: "closed", label: "Closed" },
            ]}
            onChange={setPrState}
          />
        }
        onClearRepo={() => onSelectRepo(null)}
      >
        {isUpdating && scopedPullRequests.length === 0 ? (
          <FeedNote>Updating details...</FeedNote>
        ) : scopedPullRequests.length === 0 ? (
          <FeedNote>
            No {prState === "all" ? "recent" : prState} pull requests
            {selectedRepo ? ` in ${shortRepoName(selectedRepo)}` : ""}
          </FeedNote>
        ) : (
          scopedPullRequests.map((item) => <FeedIssueRow key={item.id} item={item} icon={GitPullRequestIcon} />)
        )}
      </FeedCard>
      <div className="grid min-h-0 gap-3 lg:col-start-2 xl:col-start-3 xl:grid-rows-2">
        <FeedCard
          title="Issues"
          icon={CircleDotIcon}
          count={scopedIssues.length}
          href="https://github.com/issues"
          selectedRepo={selectedRepo}
          filter={
            <StateFilterControl
              label="Filter issues by state"
              value={issueState}
              options={[
                { value: "all", label: "All" },
                { value: "open", label: "Open" },
                { value: "closed", label: "Closed" },
              ]}
              onChange={setIssueState}
            />
          }
          onClearRepo={() => onSelectRepo(null)}
        >
          {isUpdating && scopedIssues.length === 0 ? (
            <FeedNote>Updating details...</FeedNote>
          ) : scopedIssues.length === 0 ? (
            <FeedNote>
              No {issueState === "all" ? "recent" : issueState} issues
              {selectedRepo ? ` in ${shortRepoName(selectedRepo)}` : ""}
            </FeedNote>
          ) : (
            scopedIssues.map((item) => <FeedIssueRow key={item.id} item={item} icon={CircleDotIcon} />)
          )}
        </FeedCard>
        <FeedCard
          title="Commits"
          icon={GitCommitHorizontalIcon}
          count={scopedCommits.length}
          href="https://github.com/dashboard-feed"
          selectedRepo={selectedRepo}
          onClearRepo={() => onSelectRepo(null)}
        >
          {isUpdating && scopedCommits.length === 0 ? (
            <FeedNote>Updating details...</FeedNote>
          ) : scopedCommits.length === 0 ? (
            <FeedNote>No recent commits{selectedRepo ? ` in ${shortRepoName(selectedRepo)}` : ""}</FeedNote>
          ) : (
            scopedCommits.map((commit) => <FeedCommitRow key={`${commit.repo}-${commit.sha}`} commit={commit} />)
          )}
        </FeedCard>
      </div>
    </div>
  )
}

function RepoSidebar({
  repos,
  scope,
  activeCount,
  totalCount,
  hiddenCount,
  selectedRepo,
  viewerLogin,
  onScopeChange,
  onSelectRepo,
  onToggleRepoHidden,
}: {
  repos: RepoSummary[]
  scope: RepoScope
  activeCount: number
  totalCount: number
  hiddenCount: number
  selectedRepo: string | null
  viewerLogin: string
  onScopeChange: (scope: RepoScope) => void
  onSelectRepo: (fullName: string | null) => void
  onToggleRepoHidden: (id: number) => void
}) {
  return (
    <Card id="repos" role="region" aria-label="Repositories" className="min-h-0 gap-0 rounded-lg py-0 shadow-sm shadow-foreground/[0.02] max-lg:max-h-72 lg:row-span-2 lg:h-full xl:row-span-1" size="sm">
      <CardHeader className="min-h-9 items-center border-b px-3 py-1.5 [.border-b]:pb-1.5">
        <CardTitle className="flex items-center gap-2 text-[13px] font-semibold leading-none">
          Repos
        </CardTitle>
        <CardAction className="self-center">
          <div role="group" aria-label="Repository scope" className="flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5">
            <Button
              variant={scope === "active" ? "secondary" : "ghost"}
              size="xs"
              className="h-5 px-1.5 text-[11px]"
              aria-pressed={scope === "active"}
              title="Repos pushed in the last 30 days"
              onClick={() => onScopeChange("active")}
            >
              Active <span className="font-normal text-muted-foreground tabular-nums">{activeCount}</span>
            </Button>
            <Button
              variant={scope === "all" ? "secondary" : "ghost"}
              size="xs"
              className="h-5 px-1.5 text-[11px]"
              aria-pressed={scope === "all"}
              title="All repos that are not hidden"
              onClick={() => onScopeChange("all")}
            >
              All <span className="font-normal text-muted-foreground tabular-nums">{totalCount}</span>
            </Button>
            {hiddenCount > 0 || scope === "hidden" ? (
              <Button
                variant={scope === "hidden" ? "secondary" : "ghost"}
                size="xs"
                className="h-5 px-1.5 text-[11px]"
                aria-pressed={scope === "hidden"}
                title="Hidden repos"
                onClick={() => onScopeChange("hidden")}
              >
                <EyeOffIcon className="size-3" aria-hidden="true" />
                <span className="font-normal text-muted-foreground tabular-nums">{hiddenCount}</span>
                <span className="sr-only">hidden repos</span>
              </Button>
            ) : null}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-1.5 text-xs [scrollbar-gutter:stable]">
        <div className="mb-1 border-b border-border/70 pb-1">
          <button
            type="button"
            onClick={() => onSelectRepo(null)}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
              selectedRepo === null ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            All repositories
          </button>
        </div>
        {repos.map((repo) => {
          const isSelected = repo.fullName === selectedRepo
          return (
            <div key={repo.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelectRepo(isSelected ? null : repo.fullName)}
                title={repo.fullName}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 pr-7 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                  isSelected ? "bg-muted text-foreground" : "hover:bg-muted/50"
                )}
              >
                <StatusBadge
                  compact
                  state={repo.latestRun?.conclusion ?? repo.latestRun?.status ?? repo.checkState}
                  className="size-4 shrink-0 [&>svg]:size-3"
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {repo.owner === viewerLogin ? repo.name : repo.fullName}
                </span>
                {(repo.openPullRequests ?? 0) > 0 ? (
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums transition-opacity group-hover:opacity-0" title={`${repo.openPullRequests} open PRs`}>
                    {formatCompactNumber(repo.openPullRequests ?? 0)}
                  </span>
                ) : null}
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                title={scope === "hidden" ? "Unhide repository" : "Hide repository"}
                onClick={() => onToggleRepoHidden(repo.id)}
              >
                {scope === "hidden"
                  ? <EyeIcon className="size-3.5" aria-hidden="true" />
                  : <EyeOffIcon className="size-3.5" aria-hidden="true" />}
                <span className="sr-only">{scope === "hidden" ? "Unhide" : "Hide"} {repo.name}</span>
              </Button>
            </div>
          )
        })}
        {repos.length === 0 ? (
          <div className="rounded-md bg-muted/30 px-2 py-3 text-muted-foreground">No repositories in this scope.</div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function StateFilterControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5">
      {options.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? "secondary" : "ghost"}
          size="xs"
          className="h-5 px-1.5 text-[11px]"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

function FeedCard({
  title,
  icon: Icon,
  count,
  href,
  selectedRepo,
  filter,
  onClearRepo,
  children,
}: {
  title: string
  icon: typeof GitCommitHorizontalIcon
  count: number
  href: string
  selectedRepo: string | null
  filter?: ReactNode
  onClearRepo: () => void
  children: ReactNode
}) {
  return (
    <Card className="min-h-0 gap-0 rounded-lg py-0 shadow-sm shadow-foreground/[0.02] max-lg:max-h-96 lg:h-full" size="sm">
      <CardHeader className="min-h-9 gap-1 border-b px-3 py-1.5 [.border-b]:pb-1.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold leading-none">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 truncate">{title}</span>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{count}</span>
          </CardTitle>
          <Button variant="link" size="xs" className="h-5 px-1 text-xs" asChild>
            <a href={href} target="_blank" rel="noreferrer">
              View all
              <ExternalLinkIcon data-icon="inline-end" />
            </a>
          </Button>
        </div>
        {filter || selectedRepo ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {filter}
            {selectedRepo ? (
            <button
              type="button"
              onClick={onClearRepo}
              title={`Stop filtering by ${shortRepoName(selectedRepo)}`}
              className="flex min-w-0 items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="truncate">{shortRepoName(selectedRepo)}</span>
              <XIcon className="size-3 shrink-0" aria-hidden="true" />
            </button>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1.5 text-xs [scrollbar-gutter:stable]">
        {children}
      </CardContent>
    </Card>
  )
}

function FeedIssueRow({
  item,
  icon: Icon,
}: {
  item: IssueSummary
  icon: typeof CircleDotIcon
}) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="group grid grid-cols-[auto_1fr] items-start gap-2 rounded-md px-1.5 py-1.5 outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <Icon className={cn("mt-0.5 size-3.5", issueStateClassName(item.state))} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate font-medium leading-4">{item.title}</span>
        <span className="block truncate text-[11px] leading-4 text-muted-foreground">
          {shortRepoName(item.repo)}#{item.number}
          {" · "}
          {item.isDraft && item.state === "open" ? (
            <span className="text-muted-foreground">Draft</span>
          ) : (
            <span className="capitalize">{item.state}</span>
          )}
          {item.author ? ` · ${item.author}` : ""}
          {" · "}
          {formatRelative(item.updatedAt)}
        </span>
      </span>
    </a>
  )
}

function FeedCommitRow({ commit }: { commit: CommitSummary }) {
  return (
    <a
      href={commit.url}
      target="_blank"
      rel="noreferrer"
      className="grid grid-cols-[1fr_auto] items-start gap-2 rounded-md px-1.5 py-1.5 outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="min-w-0">
        <span className="block truncate font-medium leading-4">{commit.message}</span>
        <span className="block truncate text-[11px] leading-4 text-muted-foreground">
          {shortRepoName(commit.repo)} · {formatRelative(commit.date)}
        </span>
      </span>
      <span className="font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">
        {commit.shortSha}
      </span>
    </a>
  )
}

function issueStateClassName(state: string) {
  if (state === "open") return "text-status-success"
  if (state === "merged") return "text-status-info"
  return "text-muted-foreground"
}

function FeedNote({ children }: { children: ReactNode }) {
  return <div className="rounded-md bg-muted/30 px-2 py-3 text-xs text-muted-foreground">{children}</div>
}
