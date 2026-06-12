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
import { repoCiRollup } from "@/lib/github-status"
import { cn } from "@/lib/utils"
import type { BillingSummary, RepoSummary } from "@/types/github"

export function AttentionStrip({
  repos,
  billing,
  detailLevel,
  onShowFailing,
  onShowPullRequests,
  onShowIssues,
}: {
  repos: RepoSummary[]
  billing: BillingSummary
  detailLevel: "quick" | "full"
  onShowFailing: () => void
  onShowPullRequests: () => void
  onShowIssues: () => void
}) {
  const isUpdating = detailLevel === "quick"
  // Counted per repo with the same classification as the Failing filter this
  // card opens, so the number always matches the resulting list.
  const failingRepoCount = repos.filter((repo) => repoCiRollup(repo) === "failure").length
  const prCounts = summarizeKnownCounts(repos, (repo) => repo.openPullRequests)
  const issueCounts = summarizeKnownCounts(repos, (repo) => repo.openIssues)

  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
      {isUpdating ? (
        <AttentionCard
          icon={<LoaderCircleIcon className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />}
          value="..."
          label="checking workflows"
        />
      ) : failingRepoCount > 0 ? (
        <AttentionCard
          icon={<XCircleIcon className="size-4 text-destructive" aria-hidden="true" />}
          value={formatNumber(failingRepoCount)}
          label={`${failingRepoCount === 1 ? "repo" : "repos"} with failing CI`}
          tone="danger"
          onClick={onShowFailing}
        />
      ) : (
        <AttentionCard
          icon={<CheckCircle2Icon className="size-4 text-status-success" aria-hidden="true" />}
          value="0"
          label="repos with failing CI"
        />
      )}
      <AttentionCard
        icon={<GitPullRequestIcon className="size-4 text-status-info" aria-hidden="true" />}
        value={formatCountValue(prCounts)}
        label={formatCountLabel("open PRs", prCounts)}
        onClick={prCounts.total > 0 ? onShowPullRequests : undefined}
      />
      <AttentionCard
        icon={<CircleDotIcon className="size-4 text-status-success" aria-hidden="true" />}
        value={formatCountValue(issueCounts)}
        label={formatCountLabel("open issues", issueCounts)}
        onClick={issueCounts.total > 0 ? onShowIssues : undefined}
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

type KnownCountSummary = {
  total: number
  repoCount: number
  unknownCount: number
}

function summarizeKnownCounts(
  repos: RepoSummary[],
  getCount: (repo: RepoSummary) => number | null
): KnownCountSummary {
  return repos.reduce<KnownCountSummary>((summary, repo) => {
    const count = getCount(repo)
    if (count === null) {
      summary.unknownCount += 1
      return summary
    }

    summary.total += count
    if (count > 0) summary.repoCount += 1
    return summary
  }, {
    total: 0,
    repoCount: 0,
    unknownCount: 0,
  })
}

function formatCountValue(summary: KnownCountSummary) {
  return summary.total === 0 && summary.unknownCount > 0 ? "n/a" : formatNumber(summary.total)
}

function formatCountLabel(subject: string, summary: KnownCountSummary) {
  const repoLabel = `${summary.repoCount} ${summary.repoCount === 1 ? "repo" : "repos"}`
  if (summary.unknownCount === 0) return `${subject} · ${repoLabel}`

  const unknownLabel = `${summary.unknownCount} unknown`
  if (summary.total === 0 && summary.repoCount === 0) return `${subject} · ${unknownLabel}`
  return `${subject} · ${repoLabel} · ${unknownLabel}`
}
