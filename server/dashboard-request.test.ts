// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  DashboardRequestError,
  parseDashboardRequest,
} from "./dashboard-request.ts"

describe("parseDashboardRequest", () => {
  it("parses hosted private and public dashboard requests", () => {
    expect(parseDashboardRequest(
      new URL("http://localhost/api/dashboard?quick=1&scanLimit=8"),
      "/api/dashboard"
    )).toEqual({
      username: null,
      options: { force: false, quick: true, scanLimit: 8 },
    })

    expect(parseDashboardRequest(
      new URL("http://localhost/api/dashboard/jskoiz?refresh=1&scanLimit=60"),
      "/api/dashboard"
    )).toEqual({
      username: "jskoiz",
      options: { force: true, quick: false, scanLimit: 60 },
    })
  })

  it("parses paths after the Vite middleware mount", () => {
    expect(parseDashboardRequest(new URL("http://localhost/"), "")).toEqual({
      username: null,
      options: { force: false, quick: false, scanLimit: 24 },
    })
    expect(parseDashboardRequest(new URL("http://localhost/jskoiz?scanLimit=12"), "")).toEqual({
      username: "jskoiz",
      options: { force: false, quick: false, scanLimit: 12 },
    })
  })

  it.each([
    "/api/dashboard/-invalid",
    "/api/dashboard/invalid-",
    "/api/dashboard/not%2Fa%2Flogin",
    "/api/dashboard/%",
    "/api/dashboard/one/two",
  ])("rejects invalid public dashboard path %s", (pathname) => {
    expect(() => parseDashboardRequest(
      new URL(`http://localhost${pathname}`),
      "/api/dashboard"
    )).toThrow(DashboardRequestError)
  })

  it.each(["", "7", "61", "8.5", "Infinity", "not-a-number"])(
    "rejects invalid scanLimit %s",
    (scanLimit) => {
      expect(() => parseDashboardRequest(
        new URL(`http://localhost/api/dashboard?scanLimit=${encodeURIComponent(scanLimit)}`),
        "/api/dashboard"
      )).toThrow("scanLimit must be an integer from 8 to 60.")
    }
  )
})
