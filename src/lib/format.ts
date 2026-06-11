const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
const numberFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 0 })
const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const moneyFormatter = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
})
const dateTimeFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})
const monthFormatter = new Intl.DateTimeFormat("en", {
  month: "long",
  year: "numeric",
})

export function formatRelative(value: string | null): string {
  if (!value) return "never"

  const diffSeconds = Math.round((Date.parse(value) - Date.now()) / 1000)
  const absSeconds = Math.abs(diffSeconds)

  if (absSeconds < 60) return "just now"
  if (absSeconds < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), "minute")
  if (absSeconds < 86_400) return relativeFormatter.format(Math.round(diffSeconds / 3600), "hour")
  if (absSeconds < 2_592_000) return relativeFormatter.format(Math.round(diffSeconds / 86_400), "day")
  if (absSeconds < 31_536_000) return relativeFormatter.format(Math.round(diffSeconds / 2_592_000), "month")
  return relativeFormatter.format(Math.round(diffSeconds / 31_536_000), "year")
}

export function formatDateTime(value: string | null): string {
  if (!value) return "Unknown"
  return dateTimeFormatter.format(new Date(value))
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return "-"
  return numberFormatter.format(value)
}

export function formatDecimal(value: number | null | undefined, maximumFractionDigits = 1): string {
  if (value == null) return "-"
  return new Intl.NumberFormat("en", { maximumFractionDigits }).format(value)
}

export function formatCompactNumber(value: number | null | undefined): string {
  if (value == null) return "-"
  return compactNumberFormatter.format(value)
}

export function formatMoney(value: number): string {
  return moneyFormatter.format(value)
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "-"
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes < 60) return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const minuteRemainder = minutes % 60
  return minuteRemainder ? `${hours}h ${minuteRemainder}m` : `${hours}h`
}

export function formatMonth(year: number, month: number): string {
  return monthFormatter.format(new Date(year, month - 1, 1))
}

export function formatBillingQuantity(quantity: number, unitType: string | null): string {
  const normalized = unitType ?? "Units"
  const label =
    normalized === "Minutes" ? "min" :
    normalized === "GigabyteHours" ? "GBh" :
    normalized
  const digits = quantity < 10 && !Number.isInteger(quantity) ? 2 : 0

  return `${formatDecimal(quantity, digits)} ${label}`
}

let viewerLoginPrefix: string | null = null

export function setViewerLogin(login: string | null) {
  viewerLoginPrefix = login
}

export function shortRepoName(fullName: string): string {
  if (!viewerLoginPrefix) return fullName
  return fullName.startsWith(`${viewerLoginPrefix}/`) ? fullName.slice(viewerLoginPrefix.length + 1) : fullName
}
