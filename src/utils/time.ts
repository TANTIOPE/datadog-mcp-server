/**
 * Get Unix timestamp from hours ago
 */
export function hoursAgo(hours: number): number {
  return Math.floor(Date.now() / 1000) - hours * 3600
}

/**
 * Get Unix timestamp from days ago
 */
export function daysAgo(days: number): number {
  return Math.floor(Date.now() / 1000) - days * 86400
}

/**
 * Get current Unix timestamp
 */
export function now(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Get start of a day (midnight) N days ago
 */
function startOfDayAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(0, 0, 0, 0)
  return date
}

/**
 * Parse time string to Unix timestamp
 *
 * Supported formats:
 * - ISO 8601: "2024-01-15T11:45:23Z"
 * - Relative simple: "30s", "15m", "2h", "7d"
 * - Relative with time: "3d@11:45:23", "3d@11:45", "1d@14:30:00"
 * - Keywords with time: "today@09:30", "yesterday@14:00:00"
 * - Unix timestamp: 1702656000 or "1702656000"
 *
 * Examples for LLMs:
 * - "3d@11:45:23" = 3 days ago at 11:45:23
 * - "1d@14:30" = yesterday at 14:30:00
 * - "today@09:00" = today at 09:00:00
 * - "2h" = 2 hours ago from now
 */
export function parseTime(input: string | number | undefined, defaultValue: number): number {
  if (input === undefined) {
    return defaultValue
  }

  if (typeof input === 'number') {
    return input
  }

  const trimmed = input.trim()

  // Simple relative time: 30s, 15m, 2h, 7d
  const simpleRelativeMatch = trimmed.match(/^(\d+)([smhd])$/)
  if (simpleRelativeMatch) {
    const value = Number.parseInt(simpleRelativeMatch[1] ?? '0', 10)
    const unit = simpleRelativeMatch[2]
    const nowTs = now()
    switch (unit) {
      case 's':
        return nowTs - value
      case 'm':
        return nowTs - value * 60
      case 'h':
        return nowTs - value * 3600
      case 'd':
        return nowTs - value * 86400
      default:
        return defaultValue
    }
  }

  // Relative time with specific time: 3d@11:45:23 or 3d@11:45
  const relativeWithTimeMatch = trimmed.match(/^(\d+)([dh])[@\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (relativeWithTimeMatch) {
    const value = Number.parseInt(relativeWithTimeMatch[1] ?? '0', 10)
    const unit = relativeWithTimeMatch[2]
    const hours = Number.parseInt(relativeWithTimeMatch[3] ?? '0', 10)
    const minutes = Number.parseInt(relativeWithTimeMatch[4] ?? '0', 10)
    const seconds = Number.parseInt(relativeWithTimeMatch[5] ?? '0', 10)

    if (unit === 'd') {
      const date = startOfDayAgo(value)
      date.setHours(hours, minutes, seconds, 0)
      return Math.floor(date.getTime() / 1000)
    }
    // For hours, we go back N hours then set to specific minute/second
    // This is less common but supported
    const date = new Date()
    date.setHours(date.getHours() - value)
    date.setMinutes(minutes, seconds, 0)
    return Math.floor(date.getTime() / 1000)
  }

  // Keywords: today@09:30, yesterday@14:00:00
  const keywordMatch = trimmed.match(/^(today|yesterday)[@\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/i)
  if (keywordMatch) {
    const keyword = keywordMatch[1]?.toLowerCase()
    const hours = Number.parseInt(keywordMatch[2] ?? '0', 10)
    const minutes = Number.parseInt(keywordMatch[3] ?? '0', 10)
    const seconds = Number.parseInt(keywordMatch[4] ?? '0', 10)

    const daysAgo = keyword === 'yesterday' ? 1 : 0
    const date = startOfDayAgo(daysAgo)
    date.setHours(hours, minutes, seconds, 0)
    return Math.floor(date.getTime() / 1000)
  }

  // ISO 8601 date
  const date = new Date(trimmed)
  if (!Number.isNaN(date.getTime())) {
    return Math.floor(date.getTime() / 1000)
  }

  // Unix timestamp as string
  const ts = Number.parseInt(trimmed, 10)
  if (!Number.isNaN(ts)) {
    return ts
  }

  return defaultValue
}

/**
 * Ensure from < to for time range queries
 * If from >= to, adjusts to to be from + minRangeSeconds
 *
 * @param from - Start timestamp (Unix seconds)
 * @param to - End timestamp (Unix seconds)
 * @param minRangeSeconds - Minimum range in seconds (default: 60 = 1 minute)
 * @returns Tuple of [adjustedFrom, adjustedTo] where from < to
 */
export function ensureValidTimeRange(
  from: number,
  to: number,
  minRangeSeconds: number = 60
): [number, number] {
  // If from > to, swap them (user probably made a mistake)
  if (from > to) {
    ;[from, to] = [to, from]
  }

  // If from == to (or very close), add minimum buffer to 'to'
  if (to - from < minRangeSeconds) {
    to = from + minRangeSeconds
  }

  return [from, to]
}

/**
 * Parse duration string to nanoseconds (for Datadog APM queries)
 *
 * Supported formats:
 * - "100ns" = 100 nanoseconds
 * - "50us" or "50µs" = 50 microseconds
 * - "500ms" = 500 milliseconds
 * - "2s" = 2 seconds
 * - "1.5s" = 1.5 seconds
 * - "5m" = 5 minutes
 * - "1h" = 1 hour
 * - Raw number = nanoseconds
 *
 * Examples for LLMs:
 * - "1s" = 1,000,000,000 ns (find spans >1 second)
 * - "500ms" = 500,000,000 ns (find spans >500ms)
 * - "5s" = 5,000,000,000 ns (find slow database calls)
 */
export function parseDurationToNs(input: string | number | undefined): number | undefined {
  if (input === undefined) {
    return undefined
  }

  if (typeof input === 'number') {
    return input
  }

  const trimmed = input.trim().toLowerCase()

  // Match: number + optional decimal + unit
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(ns|µs|us|ms|s|m|h|d|w)?$/)
  if (!match) {
    // Try parsing as raw number (assume nanoseconds)
    const raw = Number.parseInt(trimmed, 10)
    return Number.isNaN(raw) ? undefined : raw
  }

  const value = Number.parseFloat(match[1] ?? '0')
  const unit = match[2] ?? 'ns'

  const multipliers: Record<string, number> = {
    ns: 1,
    µs: 1000,
    us: 1000,
    ms: 1000000,
    s: 1000000000,
    m: 60000000000,
    h: 3600000000000,
    d: 86400000000000,
    w: 604800000000000
  }

  return Math.floor(value * (multipliers[unit] ?? 1))
}

/**
 * Format nanoseconds to human-readable duration
 */
export function formatDurationNs(ns: number): string {
  if (ns < 1000) return `${ns}ns`
  if (ns < 1000000) return `${(ns / 1000).toFixed(1)}µs`
  if (ns < 1000000000) return `${(ns / 1000000).toFixed(1)}ms`
  if (ns < 60000000000) return `${(ns / 1000000000).toFixed(2)}s`
  return `${(ns / 60000000000).toFixed(2)}m`
}
