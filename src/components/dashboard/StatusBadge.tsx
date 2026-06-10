import { Badge } from "@/components/ui/badge"
import { CheckCircle2Icon, CircleDotIcon, Clock3Icon, LoaderCircleIcon, XCircleIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type StatusTone = "success" | "danger" | "warning" | "running" | "neutral"

const STATUS_LABELS: Record<string, string> = {
  SUCCESS: "passing",
  success: "passing",
  FAILURE: "failing",
  failure: "failing",
  TIMED_OUT: "timed out",
  timed_out: "timed out",
  CANCELLED: "cancelled",
  cancelled: "cancelled",
  ACTION_REQUIRED: "action required",
  action_required: "action required",
  IN_PROGRESS: "running",
  in_progress: "running",
  QUEUED: "queued",
  queued: "queued",
  REQUESTED: "queued",
  requested: "queued",
  WAITING: "waiting",
  waiting: "waiting",
  PENDING: "pending",
  pending: "pending",
  completed: "completed",
}

export function StatusBadge({
  state,
  fallback = "none",
  compact = false,
  className,
}: {
  state: string | null | undefined
  fallback?: string
  compact?: boolean
  className?: string
}) {
  const label = state ? STATUS_LABELS[state] ?? state.toLowerCase().replaceAll("_", " ") : fallback
  const tone = getTone(state)

  if (compact) {
    return (
      <Badge
        variant={tone === "danger" ? "destructive" : "outline"}
        aria-label={label}
        title={label}
        className={cn("h-6 w-6 rounded-full px-0", toneClassName(tone), className)}
      >
        {renderCompactIcon(tone)}
        <span className="sr-only">{label}</span>
      </Badge>
    )
  }

  return (
    <Badge
      variant={tone === "danger" ? "destructive" : "outline"}
      className={cn(toneClassName(tone), className)}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </Badge>
  )
}

function getTone(state: string | null | undefined): StatusTone {
  const normalized = state?.toLowerCase()
  if (!normalized) return "neutral"
  if (normalized === "success") return "success"
  if (["failure", "timed_out", "cancelled", "action_required"].includes(normalized)) return "danger"
  if (["queued", "requested", "waiting", "pending"].includes(normalized)) return "warning"
  if (normalized === "in_progress") return "running"
  return "neutral"
}

function toneClassName(tone: StatusTone): string {
  if (tone === "success") return "border-status-success/25 bg-status-success/10 text-status-success"
  if (tone === "danger") return "border-destructive/25"
  if (tone === "warning") return "border-status-warning/25 bg-status-warning/10 text-status-warning"
  if (tone === "running") return "border-status-info/25 bg-status-info/10 text-status-info"
  return "text-muted-foreground"
}

function renderCompactIcon(tone: StatusTone) {
  if (tone === "success") return <CheckCircle2Icon className="size-4" aria-hidden="true" />
  if (tone === "danger") return <XCircleIcon className="size-4" aria-hidden="true" />
  if (tone === "warning") return <Clock3Icon className="size-4" aria-hidden="true" />
  if (tone === "running") return <LoaderCircleIcon className="size-4" aria-hidden="true" />
  return <CircleDotIcon className="size-4" aria-hidden="true" />
}
