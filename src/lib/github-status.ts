export type GithubStatusTone = "success" | "danger" | "warning" | "running" | "neutral"
export type GithubStatusRollup = "success" | "failure" | "running" | "none"
export type GithubStatusInput = string | null | undefined

export type GithubStatusClassification = {
  value: string | null
  label: string
  tone: GithubStatusTone
  rollup: GithubStatusRollup
}

const FAILURE_STATUSES = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "error",
  "startup_failure",
])

const WARNING_STATUSES = new Set([
  "queued",
  "requested",
  "waiting",
  "pending",
])

const STATUS_LABELS: Record<string, string> = {
  success: "passing",
  failure: "failing",
  timed_out: "timed out",
  cancelled: "cancelled",
  action_required: "action required",
  error: "error",
  startup_failure: "startup failure",
  in_progress: "running",
  queued: "queued",
  requested: "queued",
  waiting: "waiting",
  pending: "pending",
}

export function classifyGithubStatus(
  state: GithubStatusInput,
  fallback = "none"
): GithubStatusClassification {
  const value = normalizeGithubStatus(state)
  if (!value) {
    return {
      value: null,
      label: fallback,
      tone: "neutral",
      rollup: "none",
    }
  }

  const label = STATUS_LABELS[value] ?? humanizeGithubStatus(value)

  if (value === "success") {
    return {
      value,
      label,
      tone: "success",
      rollup: "success",
    }
  }

  if (FAILURE_STATUSES.has(value)) {
    return {
      value,
      label,
      tone: "danger",
      rollup: "failure",
    }
  }

  if (WARNING_STATUSES.has(value)) {
    return {
      value,
      label,
      tone: "warning",
      rollup: "running",
    }
  }

  if (value === "in_progress") {
    return {
      value,
      label,
      tone: "running",
      rollup: "running",
    }
  }

  return {
    value,
    label,
    tone: "neutral",
    rollup: "none",
  }
}

export function isGithubStatusFailure(state: GithubStatusInput): boolean {
  return classifyGithubStatus(state).rollup === "failure"
}

export type RepoCiStatusInput = {
  latestRun: { status: string; conclusion: string | null } | null
  checkState: string | null
}

// Single source of truth for a repo's CI state: the latest workflow run wins,
// falling back to the commit check rollup. The attention strip, repo badges,
// and the CI filter must classify identically or counts and lists diverge.
export function repoCiStatusInput(repo: RepoCiStatusInput): GithubStatusInput {
  return repo.latestRun?.conclusion ?? repo.latestRun?.status ?? repo.checkState
}

export function repoCiRollup(repo: RepoCiStatusInput): GithubStatusRollup {
  return classifyGithubStatus(repoCiStatusInput(repo)).rollup
}

function normalizeGithubStatus(state: GithubStatusInput): string | null {
  const value = state?.trim().toLowerCase()
  return value ? value : null
}

function humanizeGithubStatus(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ")
}
