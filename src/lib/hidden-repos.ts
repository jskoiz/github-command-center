const HIDDEN_REPOS_STORAGE_KEY = "github-command-center:hidden-repos"

export function loadHiddenRepos(): Set<number> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(HIDDEN_REPOS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is number => typeof value === "number"))
  } catch {
    return new Set()
  }
}

export function saveHiddenRepos(ids: Set<number>) {
  try {
    window.localStorage.setItem(HIDDEN_REPOS_STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // Hidden repos are best-effort; failing to persist only affects the next reload.
  }
}
