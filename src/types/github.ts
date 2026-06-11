export type DashboardWarning = {
  area: string
  message: string
  fix?: string
}

export type Viewer = {
  login: string
  name: string | null
  avatarUrl: string
  profileUrl: string
}

export type RepoSummary = {
  id: number
  name: string
  fullName: string
  owner: string
  description: string | null
  url: string
  language: string | null
  visibility: "public" | "private" | "internal"
  isPrivate: boolean
  isFork: boolean
  isArchived: boolean
  stars: number
  forks: number
  sizeKb: number
  defaultBranch: string | null
  pushedAt: string | null
  updatedAt: string | null
  openIssues: number | null
  openPullRequests: number | null
  checkState: string | null
  latestCommit: CommitSummary | null
  latestPullRequest: IssueSummary | null
  latestRun: WorkflowRunSummary | null
}

export type CommitSummary = {
  repo: string
  sha: string
  shortSha: string
  message: string
  author: string | null
  date: string
  url: string
}

export type IssueSummary = {
  id: number
  number: number
  repo: string
  title: string
  state: string
  url: string
  updatedAt: string
  createdAt: string
  author: string | null
  labels: string[]
  isPullRequest: boolean
}

export type WorkflowRunSummary = {
  id: number
  repo: string
  name: string
  event: string
  status: string
  conclusion: string | null
  branch: string | null
  createdAt: string
  updatedAt: string
  runStartedAt: string | null
  durationSeconds: number | null
  url: string
}

export type BillingSkuSummary = {
  sku: string
  quantity: number
  unitType: string | null
  grossAmount: number
  netAmount: number
}

export type BillingUnitSummary = {
  unitType: string
  quantity: number
}

export type BillingRepoSummary = {
  repo: string
  quantity: number
  grossAmount: number
  netAmount: number
}

export type BillingSummary = {
  available: boolean
  year: number
  month: number
  grossAmount: number
  discountAmount: number
  netAmount: number
  unitTotals: BillingUnitSummary[]
  skus: BillingSkuSummary[]
  repositories: BillingRepoSummary[]
  message?: string
  fix?: string
}

export type DashboardPayload = {
  generatedAt: string
  detailLevel: "quick" | "full"
  scanLimit: number
  viewer: Viewer
  repos: RepoSummary[]
  recentCommits: CommitSummary[]
  pullRequests: IssueSummary[]
  issues: IssueSummary[]
  ciRuns: WorkflowRunSummary[]
  billing: BillingSummary
  warnings: DashboardWarning[]
}
