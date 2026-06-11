import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StatusBadge } from "./StatusBadge"

describe("StatusBadge", () => {
  it("renders success and failure labels", () => {
    render(
      <div>
        <StatusBadge state="success" />
        <StatusBadge state="failure" />
      </div>
    )

    expect(screen.getByText("passing")).toBeTruthy()
    expect(screen.getByText("failing")).toBeTruthy()
  })

  it("renders running, warning, and fallback labels", () => {
    render(
      <div>
        <StatusBadge state="in_progress" />
        <StatusBadge state="queued" />
        <StatusBadge state={null} />
      </div>
    )

    expect(screen.getByText("running")).toBeTruthy()
    expect(screen.getByText("queued")).toBeTruthy()
    expect(screen.getByText("none")).toBeTruthy()
  })

  it("uses the compact aria label for icon-only badges", () => {
    render(<StatusBadge compact state="cancelled" />)

    expect(screen.getByLabelText("cancelled")).toBeTruthy()
  })
})
