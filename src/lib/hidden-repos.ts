const HIDDEN_REPOS_STORAGE_PREFIX = "github-command-center:hidden-repos:v2"

// Keys are namespaced per dashboard source (session/public/demo): repo ids are
// only unique within a source, so a shared key could hide unrelated repos.
function storageKey(sourceKey: string) {
  return `${HIDDEN_REPOS_STORAGE_PREFIX}:${sourceKey}`
}

export function loadHiddenRepos(sourceKey: string): Set<number> {
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

export function saveHiddenRepos(sourceKey: string, ids: Set<number>) {
  try {
    window.localStorage.setItem(storageKey(sourceKey), JSON.stringify([...ids]))
  } catch {
    // Hidden repos are best-effort; failing to persist only affects the next reload.
  }
}
