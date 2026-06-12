const DISMISSED_RUNS_STORAGE_PREFIX = "github-command-center:dismissed-runs:v2"
const DISMISSED_RUNS_LIMIT = 300

// Keys are namespaced per dashboard source (session/public/demo): run ids are
// only unique within a source, so a shared key could dismiss unrelated runs.
function storageKey(sourceKey: string) {
  return `${DISMISSED_RUNS_STORAGE_PREFIX}:${sourceKey}`
}

export function loadDismissedRuns(sourceKey: string): Set<number> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(storageKey(sourceKey))
    const parsed = raw ? JSON.parse(raw) as unknown : []
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is number => typeof value === "number"))
  } catch {
    return new Set()
  }
}

export function saveDismissedRuns(sourceKey: string, ids: Set<number>) {
  try {
    window.localStorage.setItem(storageKey(sourceKey), JSON.stringify([...ids].slice(-DISMISSED_RUNS_LIMIT)))
  } catch {
    // Dismissals are best-effort; failing to persist only affects the next reload.
  }
}
