import {
  CheckCircle2Icon,
  CircleDollarSignIcon,
  CircleDotIcon,
  GitPullRequestIcon,
  LoaderCircleIcon,
  XCircleIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import { formatMoney, formatNumber } from "@/lib/format"
import { isGithubStatusFailure } from "@/lib/github-status"
import { cn } from "@/lib/utils"
import type { BillingSummary, RepoSummary, WorkflowRunSummary } from "@/types/github"

export function AttentionStrip({
  repos,
  runs,
  billing,
  detailLevel,
  dismissedRunIds,
  onShowFailing,
  onShowPullRequests,
  onShowIssues,
}: {
  repos: RepoSummary[]
  runs: WorkflowRunSummary[]
  billing: BillingSummary
  detailLevel: "quick" | "full"
  dismissedRunIds: Set<number>
  onShowFailing: () => void
  onShowPullRequests: () => void
  onShowIssues: () => void
}) {
  const isUpdating = detailLevel === "quick"
  const failingRuns = runs.filter(
    (run) => !dismissedRunIds.has(run.id) && isGithubStatusFailure(run.conclusion ?? run.status)
  )
  const failingRepoCount = new Set(failingRuns.map((run) => run.repo)).size
  const openPrs = repos.reduce((sum, repo) => sum + (repo.openPullRequests ?? 0), 0)
  const prRepoCount = repos.filter((repo) => (repo.openPullRequests ?? 0) > 0).length
  const openIssues = repos.reduce((sum, repo) => sum + (repo.openIssues ?? 0), 0)
  const issueRepoCount = repos.filter((repo) => (repo.openIssues ?? 0) > 0).length

  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
      {isUpdating ? (
        <AttentionCard
          icon={<LoaderCircleIcon className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />}
          value="..."
          label="checking workflows"
        />
      ) : failingRuns.length > 0 ? (
        <AttentionCard
          icon={<XCircleIcon className="size-4 text-destructive" aria-hidden="true" />}
          value={formatNumber(failingRuns.length)}
          label={`failing ${failingRuns.length === 1 ? "workflow" : "workflows"} · ${failingRepoCount} ${failingRepoCount === 1 ? "repo" : "repos"}`}
          tone="danger"
          onClick={onShowFailing}
        />
      ) : (
        <AttentionCard
          icon={<CheckCircle2Icon className="size-4 text-status-success" aria-hidden="true" />}
          value="0"
          label="failing workflows"
        />
      )}
      <AttentionCard
        icon={<GitPullRequestIcon className="size-4 text-status-info" aria-hidden="true" />}
        value={formatNumber(openPrs)}
        label={`open PRs · ${prRepoCount} ${prRepoCount === 1 ? "repo" : "repos"}`}
        onClick={openPrs > 0 ? onShowPullRequests : undefined}
      />
      <AttentionCard
        icon={<CircleDotIcon className="size-4 text-status-success" aria-hidden="true" />}
        value={formatNumber(openIssues)}
        label={`open issues · ${issueRepoCount} ${issueRepoCount === 1 ? "repo" : "repos"}`}
        onClick={openIssues > 0 ? onShowIssues : undefined}
      />
      <AttentionCard
        icon={<CircleDollarSignIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
        value={billing.available ? formatMoney(billing.netAmount) : "n/a"}
        label={billing.available ? `billed · ${formatMoney(billing.discountAmount)} covered` : "billing unavailable"}
        href="#costs"
      />
    </div>
  )
}

function AttentionCard({
  icon,
  value,
  label,
  tone,
  onClick,
  href,
}: {
  icon: ReactNode
  value: string
  label: string
  tone?: "danger"
  onClick?: () => void
  href?: string
}) {
  const interactive = Boolean(onClick || href)
  const className = cn(
    "flex min-w-0 items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left shadow-sm shadow-foreground/[0.02] outline-none",
    tone === "danger" && "border-destructive/30 bg-destructive/5",
    interactive && "transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40",
    tone === "danger" && interactive && "hover:bg-destructive/10"
  )
  const body = (
    <>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className={cn("block font-mono text-base leading-5", tone === "danger" && "text-destructive")}>{value}</span>
        <span className="block truncate text-[11px] leading-4 text-muted-foreground">{label}</span>
      </span>
    </>
  )

  if (href) {
    return <a href={href} className={className}>{body}</a>
  }
  if (onClick) {
    return <button type="button" onClick={onClick} className={className}>{body}</button>
  }
  return <div className={className}>{body}</div>
}
