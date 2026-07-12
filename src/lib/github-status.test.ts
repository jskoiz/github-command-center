import { describe, expect, it } from "vitest"

import { classifyGithubStatus, isGithubStatusFailure } from "./github-status"

describe("classifyGithubStatus", () => {
  it("classifies known CI statuses consistently", () => {
    const cases = [
      { state: "success", value: "success", label: "passing", tone: "success", rollup: "success", failure: false, success: true },
      { state: "SUCCESS", value: "success", label: "passing", tone: "success", rollup: "success", failure: false, success: true },
      { state: "failure", value: "failure", label: "failing", tone: "danger", rollup: "failure", failure: true, success: false },
      { state: "timed_out", value: "timed_out", label: "timed out", tone: "danger", rollup: "failure", failure: true, success: false },
      { state: "cancelled", value: "cancelled", label: "cancelled", tone: "danger", rollup: "failure", failure: true, success: false },
      { state: "action_required", value: "action_required", label: "action required", tone: "danger", rollup: "failure", failure: true, success: false },
      { state: "error", value: "error", label: "error", tone: "danger", rollup: "failure", failure: true, success: false },
      { state: "ERROR", value: "error", label: "error", tone: "danger", rollup: "failure", failure: true, success: false },
      { state: "startup_failure", value: "startup_failure", label: "startup failure", tone: "danger", rollup: "failure", failure: true, success: false },
      { state: "queued", value: "queued", label: "queued", tone: "warning", rollup: "running", failure: false, success: false },
      { state: "requested", value: "requested", label: "queued", tone: "warning", rollup: "running", failure: false, success: false },
      { state: "waiting", value: "waiting", label: "waiting", tone: "warning", rollup: "running", failure: false, success: false },
      { state: "pending", value: "pending", label: "pending", tone: "warning", rollup: "running", failure: false, success: false },
      { state: "in_progress", value: "in_progress", label: "running", tone: "running", rollup: "running", failure: false, success: false },
      { state: "unknown", value: "unknown", label: "unknown", tone: "neutral", rollup: "none", failure: false, success: false },
      { state: null, value: null, label: "none", tone: "neutral", rollup: "none", failure: false, success: false },
      { state: undefined, value: null, label: "none", tone: "neutral", rollup: "none", failure: false, success: false },
    ] as const

    for (const item of cases) {
      expect(classifyGithubStatus(item.state)).toEqual({
        value: item.value,
        label: item.label,
        tone: item.tone,
        rollup: item.rollup,
      })
      expect(isGithubStatusFailure(item.state)).toBe(item.failure)
    }
  })

  it("humanizes unknown non-empty statuses as neutral labels", () => {
    expect(classifyGithubStatus("custom_status")).toEqual({
      value: "custom_status",
      label: "custom status",
      tone: "neutral",
      rollup: "none",
    })
  })
})
