import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { BillingSummary, DashboardWarning } from "@/types/github"
import { OperationalRail } from "./OperationalRail"

describe("OperationalRail", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders three warnings with no overflow disclosure", () => {
    renderOperationalRail(makeWarnings(3))

    expect(screen.getByText("Warning message 1")).toBeTruthy()
    expect(screen.getByText("Warning message 2")).toBeTruthy()
    expect(screen.getByText("Warning message 3")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /show \d+ more warnings?/i })).toBeNull()
  })

  it("renders the first three warnings plus an overflow disclosure", () => {
    renderOperationalRail(makeWarnings(5))

    expect(screen.getByText("Warning message 1")).toBeTruthy()
    expect(screen.getByText("Warning message 2")).toBeTruthy()
    expect(screen.getByText("Warning message 3")).toBeTruthy()
    expect(screen.queryByText("Warning message 4")).toBeNull()
    expect(screen.queryByText("Warning message 5")).toBeNull()
    expect(screen.getByRole("button", { name: "Show 2 more warnings" })).toBeTruthy()
  })

  it("expands to reveal all hidden warnings", () => {
    renderOperationalRail(makeWarnings(5))

    fireEvent.click(screen.getByRole("button", { name: "Show 2 more warnings" }))

    expect(screen.getByText("Warning message 1")).toBeTruthy()
    expect(screen.getByText("Warning message 2")).toBeTruthy()
    expect(screen.getByText("Warning message 3")).toBeTruthy()
    expect(screen.getByText("Warning message 4")).toBeTruthy()
    expect(screen.getByText("Warning message 5")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Show fewer warnings" })).toBeTruthy()
  })

  it("updates the visible warning list and overflow count when dismissing", () => {
    renderOperationalRail(makeWarnings(5))

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Area 1 warning" }))

    expect(screen.queryByText("Warning message 1")).toBeNull()
    expect(screen.getByText("Warning message 2")).toBeTruthy()
    expect(screen.getByText("Warning message 3")).toBeTruthy()
    expect(screen.getByText("Warning message 4")).toBeTruthy()
    expect(screen.queryByText("Warning message 5")).toBeNull()
    expect(screen.getByRole("button", { name: "Show 1 more warning" })).toBeTruthy()
  })

  it("hides the warning panel when every warning is dismissed", () => {
    renderOperationalRail(makeWarnings(1))

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Area 1 warning" }))

    expect(screen.queryByText("Partial data")).toBeNull()
  })
})

function renderOperationalRail(warnings: DashboardWarning[]) {
  return render(
    <OperationalRail
      billing={billing}
      detailLevel="full"
      runs={[]}
      warnings={warnings}
      dismissedRunIds={new Set()}
      onDismissRun={() => {}}
      onRestoreRuns={() => {}}
    />
  )
}

function makeWarnings(count: number): DashboardWarning[] {
  return Array.from({ length: count }, (_, index) => ({
    area: `Area ${index + 1}`,
    message: `Warning message ${index + 1}`,
  }))
}

const billing: BillingSummary = {
  available: true,
  year: 2026,
  month: 6,
  grossAmount: 0,
  discountAmount: 0,
  netAmount: 0,
  unitTotals: [],
  skus: [],
  repositories: [],
}
