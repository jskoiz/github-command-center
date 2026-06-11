import { describe, expect, it, vi } from "vitest"

import type { DashboardPayload } from "@/types/github"
import {
  clearDashboardCache,
  readDashboardCacheFromStorage,
  removeLegacyDashboardCache,
  writeDashboardCacheToStorage,
} from "./dashboard-cache"

const CACHE_KEY = "github-command-center:dashboard-cache:v3"
const LEGACY_CACHE_KEY = "github-command-center:dashboard-cache:v2"

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    values,
  }
}

function createPayload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    generatedAt: "2026-06-10T00:00:00.000Z",
    detailLevel: "full",
    scanLimit: 24,
    viewer: {
      login: "jskoiz",
      name: "saburo",
      avatarUrl: "https://example.com/avatar.png",
      profileUrl: "https://github.com/jskoiz",
    },
    repos: [],
    recentCommits: [],
    pullRequests: [],
    issues: [],
    ciRuns: [],
    billing: {
      available: true,
      year: 2026,
      month: 6,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
      unitTotals: [],
      skus: [],
      repositories: [],
    },
    warnings: [],
    ...overrides,
  }
}

describe("dashboard cache", () => {
  it("reads a valid full dashboard payload", () => {
    const payload = createPayload()
    const storage = createStorage({
      [CACHE_KEY]: JSON.stringify({ cachedAt: 1_000, payload }),
    })

    expect(readDashboardCacheFromStorage(storage)).toEqual({ cachedAt: 1_000, payload })
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it("rejects malformed JSON and removes it", () => {
    const storage = createStorage({ [CACHE_KEY]: "not-json" })

    expect(readDashboardCacheFromStorage(storage)).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith(CACHE_KEY)
  })

  it("rejects quick payloads", () => {
    const storage = createStorage({
      [CACHE_KEY]: JSON.stringify({
        cachedAt: 1_000,
        payload: createPayload({ detailLevel: "quick" }),
      }),
    })

    expect(readDashboardCacheFromStorage(storage)).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith(CACHE_KEY)
  })

  it("rejects payloads missing required arrays", () => {
    const payload = {
      ...createPayload(),
      repos: undefined,
    } as unknown
    const storage = createStorage({
      [CACHE_KEY]: JSON.stringify({ cachedAt: 1_000, payload }),
    })

    expect(readDashboardCacheFromStorage(storage)).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith(CACHE_KEY)
  })

  it("rejects invalid billing shape", () => {
    const storage = createStorage({
      [CACHE_KEY]: JSON.stringify({
        cachedAt: 1_000,
        payload: createPayload({
          billing: {
            ...createPayload().billing,
            grossAmount: Number.NaN,
          },
        }),
      }),
    })

    expect(readDashboardCacheFromStorage(storage)).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith(CACHE_KEY)
  })

  it("does not throw when cache writes fail", () => {
    const storage = createStorage()
    storage.setItem.mockImplementation(() => {
      throw new Error("quota exceeded")
    })

    expect(() => writeDashboardCacheToStorage(storage, createPayload())).not.toThrow()
  })

  it("does not persist quick payloads", () => {
    const storage = createStorage()

    writeDashboardCacheToStorage(storage, createPayload({ detailLevel: "quick" }))

    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it("clears the browser session cache", () => {
    window.sessionStorage.setItem(CACHE_KEY, "cached")

    clearDashboardCache()

    expect(window.sessionStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it("removes the legacy localStorage cache key", () => {
    const storage = createStorage({ [LEGACY_CACHE_KEY]: "stale" })

    removeLegacyDashboardCache(storage)

    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_CACHE_KEY)
  })
})
