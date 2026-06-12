import { useState } from "react"
import { AlertTriangleIcon, CircleDollarSignIcon, ExternalLinkIcon, ShieldAlertIcon, XIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { formatBillingQuantity, formatDuration, formatMoney, formatMonth, formatNumber, formatRelative, shortRepoName } from "@/lib/format"
import { isGithubStatusFailure } from "@/lib/github-status"
import type { BillingSummary, DashboardWarning, WorkflowRunSummary } from "@/types/github"
import { StatusBadge } from "./StatusBadge"

export function OperationalRail({
  billing,
  detailLevel,
  runs,
  warnings,
  dismissedRunIds,
  onDismissRun,
  onRestoreRuns,
}: {
  billing: BillingSummary
  detailLevel: "quick" | "full"
  runs: WorkflowRunSummary[]
  warnings: DashboardWarning[]
  dismissedRunIds: Set<number>
  onDismissRun: (id: number) => void
  onRestoreRuns: () => void
}) {
  const failingRuns = runs.filter((run) => isGithubStatusFailure(run.conclusion ?? run.status))

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
      <WarningPanel warnings={warnings} />
      <CiCard
        runs={failingRuns}
        isUpdating={detailLevel === "quick"}
        dismissedRunIds={dismissedRunIds}
        onDismissRun={onDismissRun}
        onRestoreRuns={onRestoreRuns}
      />
      <BillingCard billing={billing} />
    </aside>
  )
}


function WarningPanel({ warnings }: { warnings: DashboardWarning[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState(false)
  const visible = warnings.filter((warning) => !dismissed.has(warningKey(warning)))
  const displayed = expanded ? visible : visible.slice(0, 3)
  const overflowCount = Math.max(0, visible.length - 3)

  if (visible.length === 0) return null

  return (
    <Alert>
      <AlertTriangleIcon aria-hidden="true" />
      <AlertTitle>Partial data</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-2">
          {displayed.map((warning) => (
            <div key={warningKey(warning)} className="group relative pr-6">
              <span className="font-medium">{warning.area}: </span>
              <span>{warning.message}</span>
              {warning.fix ? <code className="mt-1 block rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">{warning.fix}</code> : null}
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-0 right-0 text-muted-foreground hover:text-foreground"
                onClick={() => setDismissed((current) => new Set(current).add(warningKey(warning)))}
              >
                <XIcon className="size-3" aria-hidden="true" />
                <span className="sr-only">Dismiss {warning.area} warning</span>
              </Button>
            </div>
          ))}
          {overflowCount > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              className="w-fit self-start px-1.5 text-xs text-muted-foreground"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded
                ? "Show fewer warnings"
                : `Show ${overflowCount} more ${overflowCount === 1 ? "warning" : "warnings"}`}
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  )
}

function warningKey(warning: DashboardWarning) {
  return `${warning.area}:${warning.message}`
}

function billingUnitLabel(unitType: string | null): string {
  if (unitType === "Minutes") return "Runner minutes"
  if (unitType === "GigabyteHours") return "Storage GB-hours"
  return unitType ?? "Units"
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
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-xl leading-none">{formatMoney(billing.netAmount)}</span>
                <span className="text-xs text-muted-foreground">billed</span>
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-mono">{formatMoney(billing.grossAmount)}</span> gross
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Progress value={coveredPercent} />
              <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                <span>Covered by plan</span>
                <span className="font-mono">{formatMoney(billing.discountAmount)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 border-t pt-2 text-xs">
              {billing.unitTotals.map((unit) => (
                <div key={unit.unitType} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{billingUnitLabel(unit.unitType)}</span>
                  <span className="font-mono whitespace-nowrap">{formatNumber(unit.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1 border-t pt-2 text-xs">
              {billing.skus.slice(0, 3).map((sku) => (
                <div key={sku.sku} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <span className="min-w-0 truncate text-muted-foreground">{sku.sku}</span>
                  <span className="font-mono whitespace-nowrap text-[11px] text-muted-foreground">{formatBillingQuantity(sku.quantity, sku.unitType)}</span>
                  <span className="font-mono whitespace-nowrap">{formatMoney(sku.grossAmount)}</span>
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

function CiCard({
  runs,
  isUpdating,
  dismissedRunIds,
  onDismissRun,
  onRestoreRuns,
}: {
  runs: WorkflowRunSummary[]
  isUpdating: boolean
  dismissedRunIds: Set<number>
  onDismissRun: (id: number) => void
  onRestoreRuns: () => void
}) {
  const visibleRuns = runs.filter((run) => !dismissedRunIds.has(run.id))
  const hiddenCount = runs.length - visibleRuns.length
  const [expanded, setExpanded] = useState(false)
  const displayedRuns = expanded ? visibleRuns : visibleRuns.slice(0, 4)
  const overflowCount = visibleRuns.length - displayedRuns.length

  return (
    <Card id="ci" className="min-h-0 shrink-0 gap-0 rounded-lg py-0 shadow-sm shadow-foreground/[0.02] lg:max-h-[34vh]" size="sm">
      <CardHeader className="min-h-10 border-b px-3 py-2 [.border-b]:pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm leading-tight">Workflow Failures</CardTitle>
            <CardDescription className="text-xs">
              {isUpdating
                ? "Workflow details updating"
                : visibleRuns.length
                  ? `${visibleRuns.length} recent non-green runs`
                  : hiddenCount
                    ? "All failures dismissed"
                    : "No failing runs in scanned repos"}
            </CardDescription>
          </div>
          {hiddenCount > 0 && !isUpdating ? (
            <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" onClick={onRestoreRuns}>
              Show {hiddenCount} hidden
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-col gap-1 overflow-y-auto px-2 py-2 [scrollbar-gutter:stable]">
        {isUpdating ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-2 text-sm text-muted-foreground">
            <ShieldAlertIcon className="size-4" aria-hidden="true" />
            Pulling workflow runs in the background.
          </div>
        ) : visibleRuns.length ? (
          <>
          {displayedRuns.map((run) => (
            <div key={run.id} className="group relative">
              <a href={run.url} target="_blank" rel="noreferrer" className="flex flex-col gap-0.5 rounded-md px-1.5 py-1 pr-7 outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
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
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                onClick={() => onDismissRun(run.id)}
              >
                <XIcon className="size-3" aria-hidden="true" />
                <span className="sr-only">Dismiss {run.name} failure</span>
              </Button>
            </div>
          ))}
          {overflowCount > 0 || expanded ? (
            <Button
              variant="ghost"
              size="xs"
              className="w-fit self-start px-1.5 text-xs text-muted-foreground"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded
                ? "Show fewer runs"
                : `Show ${overflowCount} more ${overflowCount === 1 ? "run" : "runs"}`}
            </Button>
          ) : null}
          </>
        ) : (
          <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-2 text-sm text-muted-foreground">
            <ShieldAlertIcon className="size-4" aria-hidden="true" />
            {hiddenCount ? "Dismissed failures are hidden." : "Latest scanned workflows are green or unavailable."}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
