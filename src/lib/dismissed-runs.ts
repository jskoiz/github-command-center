const DISMISSED_RUNS_STORAGE_KEY = "github-command-center:dismissed-runs"
const DISMISSED_RUNS_LIMIT = 300

export function loadDismissedRuns(): Set<number> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(DISMISSED_RUNS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is number => typeof value === "number"))
  } catch {
    return new Set()
  }
}

export function saveDismissedRuns(ids: Set<number>) {
  try {
    window.localStorage.setItem(DISMISSED_RUNS_STORAGE_KEY, JSON.stringify([...ids].slice(-DISMISSED_RUNS_LIMIT)))
  } catch {
    // Dismissals are best-effort; failing to persist only affects the next reload.
  }
}
