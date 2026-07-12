// @vitest-environment node

import { describe, expect, it } from "vitest"

import { createRateLimiter } from "./rate-limit.ts"

describe("createRateLimiter", () => {
  it("allows requests below the configured limit", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => 1_000 })

    expect(limiter.check("user:one")).toEqual({ allowed: true })
    expect(limiter.check("user:one")).toEqual({ allowed: true })
  })

  it("blocks requests after the configured limit", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 1_000 })

    expect(limiter.check("user:one")).toEqual({ allowed: true })
    expect(limiter.check("user:one")).toEqual({ allowed: false, retryAfterSeconds: 60 })
  })

  it("reports retry-after seconds from the remaining window", () => {
    let now = 10_000
    const limiter = createRateLimiter({ limit: 1, windowMs: 90_000, now: () => now })

    expect(limiter.check("user:one")).toEqual({ allowed: true })

    now = 55_001
    expect(limiter.check("user:one")).toEqual({ allowed: false, retryAfterSeconds: 45 })
  })

  it("resets buckets after the window expires", () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now })

    expect(limiter.check("user:one")).toEqual({ allowed: true })
    expect(limiter.check("user:one")).toEqual({ allowed: false, retryAfterSeconds: 1 })

    now = 1_000
    expect(limiter.check("user:one")).toEqual({ allowed: true })
  })

  it("tracks caller-provided keys independently", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 1_000 })

    expect(limiter.check("user:one")).toEqual({ allowed: true })
    expect(limiter.check("user:two")).toEqual({ allowed: true })
    expect(limiter.check("user:one")).toEqual({ allowed: false, retryAfterSeconds: 60 })
  })

  it("evicts the oldest bucket when a new key reaches capacity", () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      maxBuckets: 2,
      now: () => 1_000,
    })

    expect(limiter.check("user:one")).toEqual({ allowed: true })
    expect(limiter.check("user:two")).toEqual({ allowed: true })

    expect(limiter.check("user:three")).toEqual({ allowed: true })
    expect(limiter.check("user:two")).toEqual({ allowed: false, retryAfterSeconds: 60 })
    expect(limiter.check("user:one")).toEqual({ allowed: true })
  })

  it("resets an expired requested key without scanning unrelated buckets", () => {
    let now = 0
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1_000,
      maxBuckets: 2,
      now: () => now,
    })

    expect(limiter.check("user:one")).toEqual({ allowed: true })
    expect(limiter.check("user:two")).toEqual({ allowed: true })

    now = 1_000
    expect(limiter.check("user:one")).toEqual({ allowed: true })
    expect(limiter.check("user:one")).toEqual({ allowed: false, retryAfterSeconds: 1 })
    expect(limiter.check("user:two")).toEqual({ allowed: true })
  })

  it("rejects invalid bucket maximums", () => {
    expect(() => createRateLimiter({ limit: 1, windowMs: 1_000, maxBuckets: 0 })).toThrow(
      "maxBuckets must be a positive integer."
    )
  })
})
