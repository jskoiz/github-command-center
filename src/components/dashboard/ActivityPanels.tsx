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
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatRelative, shortRepoName } from "@/lib/format"
import type { CommitSummary, IssueSummary } from "@/types/github"

const PANEL_ITEM_LIMIT = 30

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
  return (
    <div id="activity" className="grid min-h-0 gap-3 overflow-hidden lg:h-full lg:grid-cols-3">
      <Panel title="Recent Commits" icon={GitCommitHorizontalIcon} href="https://github.com/dashboard-feed">
        {isUpdating && commits.length === 0 ? (
          <UpdatingLabel />
        ) : (
          commits.slice(0, PANEL_ITEM_LIMIT).map((commit) => (
            <a
              key={`${commit.repo}-${commit.sha}`}
              href={commit.url}
              target="_blank"
              rel="noreferrer"
              className="grid min-h-9 grid-cols-[1fr_auto] items-center gap-2 rounded-md py-1 hover:text-foreground"
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
          ))
        )}
      </Panel>
      <Panel title="Pull Requests" icon={GitPullRequestIcon} href="https://github.com/pulls">
        {isUpdating && pullRequests.length === 0 ? (
          <UpdatingLabel />
        ) : (
          pullRequests.slice(0, PANEL_ITEM_LIMIT).map((item) => (
            <IssueRow key={item.id} item={item} icon={GitPullRequestIcon} />
          ))
        )}
      </Panel>
      <Panel title="Issues" icon={CircleDotIcon} href="https://github.com/issues">
        {isUpdating && issues.length === 0 ? (
          <UpdatingLabel />
        ) : (
          issues.slice(0, PANEL_ITEM_LIMIT).map((item) => (
            <IssueRow key={item.id} item={item} icon={CircleDotIcon} />
          ))
        )}
      </Panel>
    </div>
  )
}

function Panel({
  title,
  icon: Icon,
  href,
  children,
}: {
  title: string
  icon: typeof GitCommitHorizontalIcon
  href: string
  children: ReactNode
}) {
  return (
    <Card className="h-48 min-h-0 gap-0 rounded-lg py-0 lg:h-full" size="sm">
      <CardHeader className="items-center border-b px-3 py-1 [.border-b]:pb-1">
        <CardTitle className="flex items-center gap-1.5 text-xs leading-none">
          <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {title}
        </CardTitle>
        <CardAction className="self-center">
          <Button variant="link" size="xs" className="h-5 px-1 text-xs" asChild>
            <a href={href} target="_blank" rel="noreferrer">
              View all
              <ExternalLinkIcon data-icon="inline-end" />
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-1 text-xs">
        {children}
      </CardContent>
    </Card>
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
      className="grid min-h-9 grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md py-1 hover:text-foreground"
    >
      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate font-medium leading-4">{item.title}</span>
        <span className="block truncate text-[11px] leading-4 text-muted-foreground">
          {shortRepoName(item.repo)}#{item.number} · {formatRelative(item.updatedAt)}
        </span>
      </span>
      <ExternalLinkIcon className="size-3 text-muted-foreground" aria-hidden="true" />
    </a>
  )
}

function UpdatingLabel() {
  return <div className="py-3 text-xs text-muted-foreground">Updating details...</div>
}
