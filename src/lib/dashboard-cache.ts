import type { BillingSummary, DashboardPayload, Viewer } from "@/types/github"

const DASHBOARD_CACHE_KEY = "github-command-center:dashboard-cache:v3"
const LEGACY_DASHBOARD_CACHE_KEY = "github-command-center:dashboard-cache:v2"
export const DASHBOARD_CACHE_MAX_AGE_MS = 10 * 60 * 1000

export type DashboardCacheEntry = {
  cachedAt: number
  payload: DashboardPayload
}

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">

export function readDashboardCache(): DashboardCacheEntry | null {
  if (typeof window === "undefined") return null

  removeLegacyDashboardCache(window.localStorage)
  return readDashboardCacheFromStorage(window.sessionStorage)
}

export function writeDashboardCache(payload: DashboardPayload) {
  if (typeof window === "undefined" || payload.detailLevel !== "full") return

  writeDashboardCacheToStorage(window.sessionStorage, payload)
}

export function clearDashboardCache() {
  if (typeof window === "undefined") return

  try {
    window.sessionStorage.removeItem(DASHBOARD_CACHE_KEY)
  } catch {
    // Ignore storage access errors; cache cleanup must not block auth recovery.
  }
}

export function isDashboardCacheFresh(entry: DashboardCacheEntry) {
  return Date.now() - entry.cachedAt <= DASHBOARD_CACHE_MAX_AGE_MS
}

export function readDashboardCacheFromStorage(storage: StorageLike): DashboardCacheEntry | null {
  try {
    const raw = storage.getItem(DASHBOARD_CACHE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as unknown
    if (!isDashboardCacheEntry(parsed)) {
      storage.removeItem(DASHBOARD_CACHE_KEY)
      return null
    }

    return parsed
  } catch {
    storage.removeItem(DASHBOARD_CACHE_KEY)
    return null
  }
}

export function writeDashboardCacheToStorage(storage: StorageLike, payload: DashboardPayload) {
  if (payload.detailLevel !== "full") return

  try {
    storage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
      cachedAt: Date.now(),
      payload,
    }))
  } catch {
    // Dashboard payload caching is best-effort. A successful fetch should still render.
  }
}

export function removeLegacyDashboardCache(storage: StorageLike) {
  try {
    storage.removeItem(LEGACY_DASHBOARD_CACHE_KEY)
  } catch {
    // Ignore storage access errors; cache cleanup must not block startup.
  }
}

function isDashboardCacheEntry(value: unknown): value is DashboardCacheEntry {
  if (!isRecord(value)) return false
  if (!Number.isFinite(value.cachedAt)) return false
  return isDashboardPayload(value.payload)
}

function isDashboardPayload(value: unknown): value is DashboardPayload {
  if (!isRecord(value)) return false
  if (value.detailLevel !== "full") return false
  if (!Number.isFinite(value.scanLimit)) return false
  if (typeof value.generatedAt !== "string") return false
  if (!isViewer(value.viewer)) return false
  if (!isBillingSummary(value.billing)) return false
  return Array.isArray(value.repos)
    && Array.isArray(value.recentCommits)
    && Array.isArray(value.pullRequests)
    && Array.isArray(value.issues)
    && Array.isArray(value.ciRuns)
    && Array.isArray(value.warnings)
}

function isViewer(value: unknown): value is Viewer {
  return isRecord(value)
    && typeof value.login === "string"
    && (typeof value.name === "string" || value.name === null)
    && typeof value.avatarUrl === "string"
    && typeof value.profileUrl === "string"
}

function isBillingSummary(value: unknown): value is BillingSummary {
  return isRecord(value)
    && typeof value.available === "boolean"
    && Number.isFinite(value.year)
    && Number.isFinite(value.month)
    && Number.isFinite(value.grossAmount)
    && Number.isFinite(value.discountAmount)
    && Number.isFinite(value.netAmount)
    && Array.isArray(value.unitTotals)
    && Array.isArray(value.skus)
    && Array.isArray(value.repositories)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
