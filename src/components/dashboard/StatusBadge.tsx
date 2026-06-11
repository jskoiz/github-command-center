import { Badge } from "@/components/ui/badge"
import { CheckCircle2Icon, CircleDotIcon, Clock3Icon, LoaderCircleIcon, XCircleIcon } from "lucide-react"

import { classifyGithubStatus, type GithubStatusTone } from "@/lib/github-status"
import { cn } from "@/lib/utils"

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
  const { label, tone } = classifyGithubStatus(state, fallback)

  if (compact) {
    return (
      <Badge
        variant={tone === "danger" ? "destructive" : "outline"}
        aria-label={label}
        title={label}
        className={cn("size-5 rounded-full px-0 [&>svg]:size-3.5", toneClassName(tone), className)}
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

function toneClassName(tone: GithubStatusTone): string {
  if (tone === "success") return "border-status-success/25 bg-status-success/10 text-status-success"
  if (tone === "danger") return "border-destructive/25"
  if (tone === "warning") return "border-status-warning/25 bg-status-warning/10 text-status-warning"
  if (tone === "running") return "border-status-info/25 bg-status-info/10 text-status-info"
  return "text-muted-foreground"
}

function renderCompactIcon(tone: GithubStatusTone) {
  if (tone === "success") return <CheckCircle2Icon className="size-4" aria-hidden="true" />
  if (tone === "danger") return <XCircleIcon className="size-4" aria-hidden="true" />
  if (tone === "warning") return <Clock3Icon className="size-4" aria-hidden="true" />
  if (tone === "running") return <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
  return <CircleDotIcon className="size-4" aria-hidden="true" />
}
