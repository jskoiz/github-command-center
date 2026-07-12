const HIDDEN_REPOS_STORAGE_KEY_PREFIX = "github-command-center:hidden-repos:v2"

export function loadHiddenRepos(scope: string): Set<number> {
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

export function saveHiddenRepos(scope: string, ids: Set<number>) {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify([...ids]))
  } catch {
    // Hidden repos are best-effort; failing to persist only affects the next reload.
  }
}

function storageKey(scope: string) {
  return `${HIDDEN_REPOS_STORAGE_KEY_PREFIX}:${scope}`
}
