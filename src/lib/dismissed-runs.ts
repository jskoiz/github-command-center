const DISMISSED_RUNS_STORAGE_KEY_PREFIX = "github-command-center:dismissed-runs:v2"
const DISMISSED_RUNS_LIMIT = 300

export function loadDismissedRuns(scope: string): Set<number> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(storageKey(scope))
    const parsed = raw ? JSON.parse(raw) as unknown : []
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is number => typeof value === "number"))
  } catch {
    return new Set()
  }
}

export function saveDismissedRuns(scope: string, ids: Set<number>) {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify([...ids].slice(-DISMISSED_RUNS_LIMIT)))
  } catch {
    // Dismissals are best-effort; failing to persist only affects the next reload.
  }
}

function storageKey(scope: string) {
  return `${DISMISSED_RUNS_STORAGE_KEY_PREFIX}:${scope}`
}
