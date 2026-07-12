export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

export type RateLimitOptions = {
  limit: number
  windowMs: number
  maxBuckets?: number
  now?: () => number
}

export type RateLimiter = {
  check(key: string): RateLimitResult
}

export type HostedRateLimiters = {
  auth: RateLimiter
  quickDashboard: RateLimiter
  fullDashboard: RateLimiter
  refreshDashboard: RateLimiter
  publicClientQuickDashboard: RateLimiter
  publicClientFullDashboard: RateLimiter
  publicClientRefreshDashboard: RateLimiter
}

type Bucket = {
  count: number
  resetAt: number
}

const MINUTE_MS = 60 * 1000
const DEFAULT_MAX_RATE_LIMIT_BUCKETS = 10_000

const HOSTED_RATE_LIMITS = {
  auth: { limit: 20, windowMs: 10 * MINUTE_MS },
  quickDashboard: { limit: 30, windowMs: MINUTE_MS },
  fullDashboard: { limit: 6, windowMs: MINUTE_MS },
  refreshDashboard: { limit: 3, windowMs: MINUTE_MS },
} as const

export const RATE_LIMIT_MESSAGE = "Too many requests. Try again later."

export function createRateLimiter({
  limit,
  windowMs,
  maxBuckets = DEFAULT_MAX_RATE_LIMIT_BUCKETS,
  now = Date.now,
}: RateLimitOptions): RateLimiter {
  if (!Number.isInteger(maxBuckets) || maxBuckets < 1) {
    throw new RangeError("maxBuckets must be a positive integer.")
  }

  const buckets = new Map<string, Bucket>()

  return {
    check(key) {
      const currentTime = now()
      let existing = buckets.get(key)
      if (existing && existing.resetAt <= currentTime) {
        buckets.delete(key)
        existing = undefined
      }
      if (!existing) {
        evictOldestBucketAtCapacity(buckets, maxBuckets)
        buckets.set(key, { count: 1, resetAt: currentTime + windowMs })
        return { allowed: true }
      }

      if (existing.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - currentTime) / 1000)),
        }
      }

      existing.count += 1
      return { allowed: true }
    },
  }
}

export function createHostedRateLimiters(): HostedRateLimiters {
  return {
    auth: createRateLimiter(HOSTED_RATE_LIMITS.auth),
    quickDashboard: createRateLimiter(HOSTED_RATE_LIMITS.quickDashboard),
    fullDashboard: createRateLimiter(HOSTED_RATE_LIMITS.fullDashboard),
    refreshDashboard: createRateLimiter(HOSTED_RATE_LIMITS.refreshDashboard),
    publicClientQuickDashboard: createRateLimiter(HOSTED_RATE_LIMITS.quickDashboard),
    publicClientFullDashboard: createRateLimiter(HOSTED_RATE_LIMITS.fullDashboard),
    publicClientRefreshDashboard: createRateLimiter(HOSTED_RATE_LIMITS.refreshDashboard),
  }
}

function evictOldestBucketAtCapacity(buckets: Map<string, Bucket>, maxBuckets: number) {
  if (buckets.size < maxBuckets) return
  const oldest = buckets.keys().next().value
  if (oldest !== undefined) buckets.delete(oldest)
}
