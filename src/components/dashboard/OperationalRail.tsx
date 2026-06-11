import { AlertTriangleIcon, CircleDollarSignIcon, ExternalLinkIcon, ShieldAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { formatBillingQuantity, formatDuration, formatMoney, formatMonth, formatNumber, formatRelative, shortRepoName } from "@/lib/format"
import { isGithubStatusFailure, isGithubStatusSuccess } from "@/lib/github-status"
import type { BillingSummary, DashboardWarning, RepoSummary, WorkflowRunSummary } from "@/types/github"
import { StatusBadge } from "./StatusBadge"

export function OperationalRail({
  billing,
  detailLevel,
  runs,
  repos,
  warnings,
}: {
  billing: BillingSummary
  detailLevel: "quick" | "full"
  runs: WorkflowRunSummary[]
  repos: RepoSummary[]
  warnings: DashboardWarning[]
}) {
  const failingRuns = runs.filter((run) => isGithubStatusFailure(run.conclusion ?? run.status))

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
      <WarningPanel warnings={warnings} />
      <BillingCard billing={billing} />
      <CiCard runs={failingRuns} isUpdating={detailLevel === "quick"} />
      <CiSummaryCard runs={runs} repos={repos} isUpdating={detailLevel === "quick"} />
    </aside>
  )
}

function WarningPanel({ warnings }: { warnings: DashboardWarning[] }) {
  if (warnings.length === 0) return null

  return (
    <Alert>
      <AlertTriangleIcon aria-hidden="true" />
      <AlertTitle>Partial data</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-2">
          {warnings.slice(0, 3).map((warning) => (
            <div key={`${warning.area}-${warning.message}`}>
              <span className="font-medium">{warning.area}: </span>
              <span>{warning.message}</span>
              {warning.fix ? <code className="mt-1 block rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">{warning.fix}</code> : null}
            </div>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  )
}

function BillingCard({ billing }: { billing: BillingSummary }) {
  const coveredPercent = billing.grossAmount > 0
    ? Math.min(100, (billing.discountAmount / billing.grossAmount) * 100)
    : 0

  return (
    <Card id="costs" className="min-h-0 shrink-0 gap-0 rounded-lg py-0 shadow-sm shadow-foreground/[0.02] lg:max-h-[34vh]" size="sm">
      <CardHeader className="min-h-10 border-b px-3 py-2 [.border-b]:pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm leading-tight">GitHub Actions Billing</CardTitle>
            <CardDescription className="text-xs">{formatMonth(billing.year, billing.month)}</CardDescription>
          </div>
          <CircleDollarSignIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-3 py-2 [scrollbar-gutter:stable]">
        {billing.available ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Billed</div>
                <div className="font-mono text-lg leading-tight">{formatMoney(billing.netAmount)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Gross</div>
                <div className="font-mono text-lg leading-tight">{formatMoney(billing.grossAmount)}</div>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Progress value={coveredPercent} />
              <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                <span>Covered</span>
                <span className="font-mono">{formatMoney(billing.discountAmount)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {billing.unitTotals.map((unit) => (
                <div key={unit.unitType} className="grid grid-cols-[1fr_auto] gap-2">
                  <div className="text-xs text-muted-foreground">{unit.unitType}</div>
                  <div className="font-mono text-sm">{formatBillingQuantity(unit.quantity, unit.unitType)}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {billing.skus.slice(0, 3).map((sku) => (
                <div key={sku.sku} className="grid grid-cols-[1fr_auto] gap-3 rounded-md px-1.5 py-1 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-muted-foreground">{sku.sku}</span>
                    <span className="font-mono text-xs text-muted-foreground">{formatBillingQuantity(sku.quantity, sku.unitType)}</span>
                  </span>
                  <span className="font-mono">{formatMoney(sku.grossAmount)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <Badge variant="outline" className="w-fit text-muted-foreground">billing blocked</Badge>
            <p className="text-sm text-muted-foreground">{billing.message ?? "GitHub billing usage is unavailable."}</p>
            {billing.fix ? <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{billing.fix}</code> : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CiCard({ runs, isUpdating }: { runs: WorkflowRunSummary[]; isUpdating: boolean }) {
  return (
    <Card id="ci" className="min-h-0 shrink-0 gap-0 rounded-lg py-0 shadow-sm shadow-foreground/[0.02] lg:max-h-[34vh]" size="sm">
      <CardHeader className="min-h-10 border-b px-3 py-2 [.border-b]:pb-2">
        <CardTitle className="text-sm leading-tight">Workflow Failures</CardTitle>
        <CardDescription className="text-xs">
          {isUpdating ? "Workflow details updating" : runs.length ? `${runs.length} recent non-green runs` : "No failing runs in scanned repos"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-col gap-1 overflow-y-auto px-2 py-2 [scrollbar-gutter:stable]">
        {isUpdating ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-2 text-sm text-muted-foreground">
            <ShieldAlertIcon className="size-4" aria-hidden="true" />
            Pulling workflow runs in the background.
          </div>
        ) : runs.length ? (
          runs.slice(0, 4).map((run) => (
            <a key={run.id} href={run.url} target="_blank" rel="noreferrer" className="flex flex-col gap-0.5 rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{run.name}</span>
                <StatusBadge state={run.conclusion ?? run.status} />
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="truncate">{shortRepoName(run.repo)} · {formatDuration(run.durationSeconds)}</span>
                <span className="inline-flex items-center gap-1">
                  {formatRelative(run.createdAt)}
                  <ExternalLinkIcon className="size-3" aria-hidden="true" />
                </span>
              </div>
            </a>
          ))
        ) : (
          <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-2 text-sm text-muted-foreground">
            <ShieldAlertIcon className="size-4" aria-hidden="true" />
            Latest scanned workflows are green or unavailable.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CiSummaryCard({
  runs,
  repos,
  isUpdating,
}: {
  runs: WorkflowRunSummary[]
  repos: RepoSummary[]
  isUpdating: boolean
}) {
  const completedRuns = runs.filter((run) => run.status === "completed")
  const successfulRuns = completedRuns.filter((run) => isGithubStatusSuccess(run.conclusion))
  const failedRuns = completedRuns.filter((run) => isGithubStatusFailure(run.conclusion ?? run.status))
  const workflowRepos = new Set(runs.map((run) => run.repo))
  const successRate = completedRuns.length
    ? Math.round((successfulRuns.length / completedRuns.length) * 1000) / 10
    : 0

  return (
    <Card className="shrink-0 gap-0 rounded-lg py-0 shadow-sm shadow-foreground/[0.02]" size="sm">
      <CardHeader className="min-h-10 border-b px-3 py-2 [.border-b]:pb-2">
        <CardTitle className="text-sm leading-tight">CI Summary</CardTitle>
        <CardDescription className="text-xs">{isUpdating ? "Updating" : "Recent scanned runs"}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 px-3 py-2 text-sm">
        <SummaryRow label="Workflow repos" value={isUpdating ? "..." : formatNumber(workflowRepos.size)} />
        <SummaryRow label="Success rate" value={isUpdating ? "..." : `${successRate}%`} />
        <SummaryRow label="Total runs" value={isUpdating ? "..." : formatNumber(runs.length)} />
        <SummaryRow label="Failed runs" value={isUpdating ? "..." : formatNumber(failedRuns.length)} />
        <div className="border-t pt-2 text-xs text-muted-foreground">
          {formatNumber(repos.length)} repos tracked
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}
