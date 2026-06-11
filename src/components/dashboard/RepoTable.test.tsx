import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { RepoSummary } from "@/types/github"
import { RepoTable, type RepoSort } from "./RepoTable"

describe("RepoTable", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it("resizes columns from the header separator", () => {
    const { container } = renderRepoTable()
    const pullRequestsHeader = getHeader(container, "openPullRequests")

    expect(pullRequestsHeader.style.width).toBe("72px")

    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize PRs column" }), {
      key: "ArrowRight",
    })

    expect(pullRequestsHeader.style.width).toBe("96px")
  })

  it("reorders columns from the header drag grip", () => {
    const { container } = renderRepoTable()
    const pullRequestsGrip = screen.getByLabelText("Drag PRs column")
    const commitHeader = getHeader(container, "lastCommit")
    const dataTransfer = createDataTransfer()

    mockHeaderRect(commitHeader, { left: 0, width: 100 })
    expect(getHeaderOrder(container).slice(0, 4)).toEqual(["repo", "openPullRequests", "openIssues", "lastCommit"])

    fireEvent.dragStart(pullRequestsGrip, { dataTransfer })
    fireEvent.dragOver(commitHeader, { clientX: 25, dataTransfer })
    fireEvent.drop(commitHeader, { clientX: 25, dataTransfer })

    expect(getHeaderOrder(container).slice(0, 4)).toEqual(["repo", "openIssues", "openPullRequests", "lastCommit"])
  })

  it("combines pull request details with CI status by default", () => {
    const { container } = renderRepoTable()

    expect(getHeaderOrder(container)).toContain("lastPullRequest")
    expect(getHeaderOrder(container)).not.toContain("ci")
    expect(screen.getByText("PR / CI")).toBeTruthy()
    expect(screen.getByLabelText("passing")).toBeTruthy()
    expect(screen.getByText("Tighten table density")).toBeTruthy()
  })
})

function renderRepoTable() {
  const sort: RepoSort = { key: "pushedAt", direction: "desc" }

  return render(
    <RepoTable
      repos={[makeRepo()]}
      totalCount={1}
      filteredCount={1}
      pageIndex={0}
      pageSize={15}
      sort={sort}
      viewerLogin="jskoiz"
      onPageChange={() => {}}
      onPageSizeChange={() => {}}
      onSort={() => {}}
    />
  )
}

function getHeader(container: HTMLElement, key: string) {
  const header = container.querySelector<HTMLTableCellElement>(`th[data-column-key="${key}"]`)
  if (!header) throw new Error(`Missing ${key} column header`)
  return header
}

function getHeaderOrder(container: HTMLElement) {
  return [...container.querySelectorAll("th[data-column-key]")]
    .map((header) => header.getAttribute("data-column-key"))
}

function createDataTransfer() {
  const entries = new Map<string, string>()
  return {
    dropEffect: "move",
    effectAllowed: "move",
    getData: (type: string) => entries.get(type) ?? "",
    setData: (type: string, value: string) => entries.set(type, value),
  }
}

function mockHeaderRect(element: HTMLElement, { left, width }: { left: number; width: number }) {
  element.getBoundingClientRect = () => ({
    bottom: 28,
    height: 28,
    left,
    right: left + width,
    top: 0,
    width,
    x: left,
    y: 0,
    toJSON: () => ({}),
  })
}

function makeRepo(): RepoSummary {
  return {
    id: 1,
    name: "github-command-center",
    fullName: "jskoiz/github-command-center",
    owner: "jskoiz",
    description: null,
    url: "https://github.com/jskoiz/github-command-center",
    language: "TypeScript",
    visibility: "private",
    isPrivate: true,
    isFork: false,
    isArchived: false,
    stars: 1,
    forks: 0,
    sizeKb: 2048,
    defaultBranch: "main",
    pushedAt: "2026-06-10T00:00:00Z",
    updatedAt: "2026-06-10T00:00:00Z",
    openIssues: 0,
    openPullRequests: 0,
    checkState: "success",
    latestCommit: null,
    latestPullRequest: {
      id: 10,
      number: 12,
      repo: "jskoiz/github-command-center",
      title: "Tighten table density",
      state: "closed",
      url: "https://github.com/jskoiz/github-command-center/pull/12",
      updatedAt: "2026-06-10T00:00:00Z",
      createdAt: "2026-06-09T00:00:00Z",
      author: "jskoiz",
      labels: [],
      isPullRequest: true,
    },
    latestRun: null,
  }
}
