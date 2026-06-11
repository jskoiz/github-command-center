import { describe, expect, it } from "vitest"

import { formatBillingQuantity, formatDuration, shortRepoName } from "./format"

describe("formatDuration", () => {
  it("formats missing and sub-minute durations", () => {
    expect(formatDuration(null)).toBe("-")
    expect(formatDuration(42)).toBe("42s")
  })

  it("formats minute and hour durations", () => {
    expect(formatDuration(120)).toBe("2m")
    expect(formatDuration(125)).toBe("2m 5s")
    expect(formatDuration(7_200)).toBe("2h")
    expect(formatDuration(7_260)).toBe("2h 1m")
  })
})

describe("formatBillingQuantity", () => {
  it("shortens known GitHub billing unit labels", () => {
    expect(formatBillingQuantity(12, "Minutes")).toBe("12 min")
    expect(formatBillingQuantity(12, "GigabyteHours")).toBe("12 GBh")
  })

  it("keeps precision for small decimal quantities", () => {
    expect(formatBillingQuantity(1.25, "Requests")).toBe("1.25 Requests")
  })
})

describe("shortRepoName", () => {
  it("removes the personal owner prefix used by the current dashboard", () => {
    expect(shortRepoName("jskoiz/github-command-center")).toBe("github-command-center")
  })

  it("keeps other owners visible", () => {
    expect(shortRepoName("octocat/hello-world")).toBe("octocat/hello-world")
  })
})
