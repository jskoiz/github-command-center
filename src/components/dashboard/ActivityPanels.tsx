import { useState } from "react"
import {
  CircleDotIcon,
  ExternalLinkIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatRelative, shortRepoName } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CommitSummary, IssueSummary } from "@/types/github"

const PANEL_ITEM_LIMIT = 30

type ActivityTab = "pullRequests" | "issues" | "commits"

const TAB_DEFS: { key: ActivityTab; label: string; icon: typeof GitCommitHorizontalIcon; href: string }[] = [
  { key: "pullRequests", label: "Pull Requests", icon: GitPullRequestIcon, href: "https://github.com/pulls" },
  { key: "issues", label: "Issues", icon: CircleDotIcon, href: "https://github.com/issues" },
  { key: "commits", label: "Commits", icon: GitCommitHorizontalIcon, href: "https://github.com/dashboard-feed" },
]

export function ActivityPanels({
  commits,
  pullRequests,
  issues,
  isUpdating,
}: {
  commits: CommitSummary[]
  pullRequests: IssueSummary[]
  issues: IssueSummary[]
  isUpdating: boolean
}) {
  const [tab, setTab] = useState<ActivityTab>("pullRequests")
  const counts: Record<ActivityTab, number> = {
    pullRequests: pullRequests.length,
    issues: issues.length,
    commits: commits.length,
  }
  const activeTab = TAB_DEFS.find((definition) => definition.key === tab) ?? TAB_DEFS[0]

  return (
    <Card id="activity" className="min-h-0 gap-0 overflow-hidden rounded-lg py-0 shadow-sm shadow-foreground/[0.02] lg:h-full" size="sm">
      <CardHeader className="min-h-9 items-center border-b px-2 py-1 [.border-b]:pb-1">
        <div role="tablist" aria-label="Recent activity" className="flex items-center gap-1">
          {TAB_DEFS.map((definition) => {
            const isActive = definition.key === tab
            return (
              <button
                key={definition.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(definition.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                  isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <definition.icon className="size-3.5" aria-hidden="true" />
                {definition.label}
                <span className="font-mono text-[11px] text-muted-foreground">{counts[definition.key]}</span>
              </button>
            )
          })}
        </div>
        <CardAction className="self-center">
          <Button variant="link" size="xs" className="h-5 px-1 text-xs" asChild>
            <a href={activeTab.href} target="_blank" rel="noreferrer">
              View all
              <ExternalLinkIcon data-icon="inline-end" />
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 content-start gap-x-4 gap-y-0.5 overflow-y-auto px-2 py-1.5 text-xs md:grid-cols-2 2xl:grid-cols-3 [scrollbar-gutter:stable]">
        {tab === "commits" ? (
          isUpdating && commits.length === 0 ? (
            <UpdatingLabel />
          ) : commits.length === 0 ? (
            <EmptyPanelMessage>No recent commits</EmptyPanelMessage>
          ) : (
            commits.slice(0, PANEL_ITEM_LIMIT).map((commit) => (
              <CommitRow key={`${commit.repo}-${commit.sha}`} commit={commit} />
            ))
          )
        ) : null}
        {tab === "pullRequests" ? (
          isUpdating && pullRequests.length === 0 ? (
            <UpdatingLabel />
          ) : pullRequests.length === 0 ? (
            <EmptyPanelMessage>No recent pull requests</EmptyPanelMessage>
          ) : (
            pullRequests.slice(0, PANEL_ITEM_LIMIT).map((item) => (
              <IssueRow key={item.id} item={item} icon={GitPullRequestIcon} />
            ))
          )
        ) : null}
        {tab === "issues" ? (
          isUpdating && issues.length === 0 ? (
            <UpdatingLabel />
          ) : issues.length === 0 ? (
            <EmptyPanelMessage>No recent issues</EmptyPanelMessage>
          ) : (
            issues.slice(0, PANEL_ITEM_LIMIT).map((item) => (
              <IssueRow key={item.id} item={item} icon={CircleDotIcon} />
            ))
          )
        ) : null}
      </CardContent>
    </Card>
  )
}

function CommitRow({ commit }: { commit: CommitSummary }) {
  return (
    <a
      href={commit.url}
      target="_blank"
      rel="noreferrer"
      className="grid min-h-9 grid-cols-[1fr_auto] items-center gap-2 rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="min-w-0">
        <span className="block truncate font-medium leading-4">{commit.message}</span>
        <span className="block truncate text-[11px] leading-4 text-muted-foreground">
          {shortRepoName(commit.repo)} · {formatRelative(commit.date)}
        </span>
      </span>
      <span className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        {commit.shortSha}
      </span>
    </a>
  )
}

function IssueRow({
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
      className="group grid min-h-9 grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate font-medium leading-4">{item.title}</span>
        <span className="block truncate text-[11px] leading-4 text-muted-foreground">
          {shortRepoName(item.repo)}#{item.number} · {formatRelative(item.updatedAt)}
        </span>
      </span>
      <ExternalLinkIcon className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
    </a>
  )
}

function UpdatingLabel() {
  return <div className="rounded-md bg-muted/40 px-2 py-3 text-xs text-muted-foreground md:col-span-2 2xl:col-span-3">Updating details...</div>
}

function EmptyPanelMessage({ children }: { children: ReactNode }) {
  return <div className="rounded-md bg-muted/30 px-2 py-3 text-xs text-muted-foreground md:col-span-2 2xl:col-span-3">{children}</div>
}
