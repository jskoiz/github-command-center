export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

export type RateLimitOptions = {
  limit: number
  windowMs: number
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
  publicDashboard: RateLimiter
}

type Bucket = {
  count: number
  resetAt: number
}

const MINUTE_MS = 60 * 1000

export const HOSTED_RATE_LIMITS = {
  auth: { limit: 20, windowMs: 10 * MINUTE_MS },
  quickDashboard: { limit: 30, windowMs: MINUTE_MS },
  fullDashboard: { limit: 6, windowMs: MINUTE_MS },
  refreshDashboard: { limit: 3, windowMs: MINUTE_MS },
  // Per-IP across all usernames, so iterating usernames cannot mint fresh
  // per-username buckets indefinitely.
  publicDashboard: { limit: 30, windowMs: MINUTE_MS },
} as const

export const RATE_LIMIT_MESSAGE = "Too many requests. Try again later."

const CHECKS_PER_SWEEP = 500

export function createRateLimiter({ limit, windowMs, now = Date.now }: RateLimitOptions): RateLimiter {
  const buckets = new Map<string, Bucket>()
  let checksSinceSweep = 0

  return {
    check(key) {
      const currentTime = now()
      // Expired keys are reset lazily on access; the full sweep is O(buckets)
      // so it only runs periodically to reclaim memory from one-off keys.
      checksSinceSweep += 1
      if (checksSinceSweep >= CHECKS_PER_SWEEP) {
        checksSinceSweep = 0
        pruneExpiredBuckets(buckets, currentTime)
      }

      const existing = buckets.get(key)
      if (!existing || existing.resetAt <= currentTime) {
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
    publicDashboard: createRateLimiter(HOSTED_RATE_LIMITS.publicDashboard),
  }
}

function pruneExpiredBuckets(buckets: Map<string, Bucket>, now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}
