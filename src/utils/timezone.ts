/**
 * Timezone utilities for IANA-zone-aware formatting and bucketing.
 *
 * Implements Requirements 3 and 4 (events-dx-improvements):
 *  - `validateIanaZone` — throws `EINVALID_TIMEZONE` with up to 3 near-match suggestions
 *  - `formatLocal` — ISO 8601 string with offset (DST-safe)
 *  - `bucketHourOfDay` / `bucketDayOfWeek` / `bucketDayOfMonth` — local bucketing
 *
 * All zone math goes through `Intl.DateTimeFormat`. No manual offset arithmetic
 * anywhere — DST transitions are handled by the runtime ICU database.
 */

const ERROR_PREFIX = 'EINVALID_TIMEZONE'

/**
 * Day-of-week numeric mapping used by `bucketDayOfWeek`.
 * Matches `Date.prototype.getDay` semantics: 0=Sunday..6=Saturday.
 * Design.md §65-70 fixes this convention.
 */
const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
}

/**
 * Throws if `tz` is not a valid IANA timezone identifier.
 *
 * The check delegates to `new Intl.DateTimeFormat(undefined, { timeZone: tz })`,
 * which throws a `RangeError` for unknown zones. On rejection we surface a
 * stable `EINVALID_TIMEZONE` error with up to 3 near-match suggestions taken
 * from `Intl.supportedValuesOf('timeZone')`.
 *
 * Accepts canonical zones like `UTC`, `Europe/Paris`, `America/New_York`.
 */
export function validateIanaZone(tz: string): void {
  if (typeof tz !== 'string' || tz.length === 0) {
    throw new Error(
      `${ERROR_PREFIX}: timezone must be a non-empty IANA identifier (e.g. "UTC", "Europe/Paris", "America/New_York")`
    )
  }

  try {
    // Intl.DateTimeFormat throws RangeError on invalid zone — single source of truth.
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return
  } catch {
    const suggestions = suggestZones(tz)
    const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : ''
    throw new Error(`${ERROR_PREFIX}: "${tz}" is not a valid IANA timezone.${suggestionText}`)
  }
}

/**
 * Return up to 3 IANA timezone identifiers most similar to `input`.
 *
 * Strategy:
 *  1. Case-insensitive substring matches (handles typos like "europe/pari" → "Europe/Paris").
 *  2. Levenshtein distance fallback for zones not caught by substring.
 *  3. Sort by ascending edit distance, take top 3.
 */
function suggestZones(input: string): string[] {
  let zones: readonly string[]
  try {
    zones = Intl.supportedValuesOf('timeZone')
  } catch {
    // Older runtimes without supportedValuesOf — surface no suggestions rather than crash.
    return []
  }

  const lower = input.toLowerCase()
  const scored = zones.map((zone) => ({
    zone,
    score: scoreZone(zone, lower)
  }))

  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, 3).map((s) => s.zone)
}

/**
 * Lower score = better match. Substring matches get a strong boost.
 */
function scoreZone(zone: string, lowerInput: string): number {
  const lowerZone = zone.toLowerCase()
  const baseDistance = levenshtein(lowerZone, lowerInput)
  if (lowerZone.includes(lowerInput) || lowerInput.includes(lowerZone)) {
    // Subtract a constant so substring matches always beat pure edit-distance matches.
    return baseDistance - 100
  }
  return baseDistance
}

/**
 * Iterative Levenshtein with O(min(a,b)) memory.
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Ensure `a` is the shorter string to bound row length.
  if (a.length > b.length) {
    const tmp = a
    a = b
    b = tmp
  }

  let previous = new Array<number>(a.length + 1)
  let current = new Array<number>(a.length + 1)
  for (let i = 0; i <= a.length; i++) previous[i] = i

  for (let j = 1; j <= b.length; j++) {
    current[0] = j
    const bChar = b.charCodeAt(j - 1)
    for (let i = 1; i <= a.length; i++) {
      const cost = a.charCodeAt(i - 1) === bChar ? 0 : 1
      const prevI = previous[i] ?? 0
      const currIMinus1 = current[i - 1] ?? 0
      const prevIMinus1 = previous[i - 1] ?? 0
      current[i] = Math.min(prevI + 1, currIMinus1 + 1, prevIMinus1 + cost)
    }
    const tmp = previous
    previous = current
    current = tmp
  }

  return previous[a.length] ?? 0
}

/**
 * Cached `Intl.DateTimeFormat` instances keyed by timezone.
 * Avoids rebuilding formatters on every call to bucket* / formatLocal.
 */
const partsFormatterCache = new Map<string, Intl.DateTimeFormat>()
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>()

function getPartsFormatter(tz: string): Intl.DateTimeFormat {
  const cached = partsFormatterCache.get(tz)
  if (cached) return cached
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23', // 0-23, avoids "24" edge case at midnight
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long'
  })
  partsFormatterCache.set(tz, fmt)
  return fmt
}

function getOffsetFormatter(tz: string): Intl.DateTimeFormat {
  const cached = offsetFormatterCache.get(tz)
  if (cached) return cached
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset'
  })
  offsetFormatterCache.set(tz, fmt)
  return fmt
}

type DateParts = {
  year: string
  month: string
  day: string
  hour: string
  minute: string
  second: string
  weekday: string
}

function getDateParts(epochMs: number, tz: string): DateParts {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = getPartsFormatter(tz).formatToParts(epochMs)
  } catch {
    // tz was rejected by Intl — surface the canonical error.
    throw new Error(`${ERROR_PREFIX}: "${tz}" is not a valid IANA timezone.`)
  }
  const out: DateParts = {
    year: '',
    month: '',
    day: '',
    hour: '',
    minute: '',
    second: '',
    weekday: ''
  }
  for (const part of parts) {
    if (part.type === 'year') out.year = part.value
    else if (part.type === 'month') out.month = part.value
    else if (part.type === 'day') out.day = part.value
    else if (part.type === 'hour') out.hour = part.value
    else if (part.type === 'minute') out.minute = part.value
    else if (part.type === 'second') out.second = part.value
    else if (part.type === 'weekday') out.weekday = part.value
  }
  return out
}

/**
 * Extract the offset for `epochMs` in `tz` as an ISO 8601 offset string
 * (`+HH:MM`, `-HH:MM`, or `Z` for zero offset on the `UTC` zone).
 *
 * Uses `timeZoneName: 'longOffset'` which always emits `GMT±HH:MM`.
 */
function getOffsetIso(epochMs: number, tz: string): string {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = getOffsetFormatter(tz).formatToParts(epochMs)
  } catch {
    throw new Error(`${ERROR_PREFIX}: "${tz}" is not a valid IANA timezone.`)
  }
  const offsetPart = parts.find((p) => p.type === 'timeZoneName')
  const raw = offsetPart?.value ?? ''
  // raw is e.g. "GMT+02:00", "GMT-04:00", or "GMT" (zero offset, observed on some runtimes).
  // Some runtimes emit "GMT+00:00" for UTC; some emit just "GMT".
  if (raw === 'GMT' || raw === 'GMT+00:00' || raw === 'GMT-00:00') {
    return 'Z'
  }
  if (raw.startsWith('GMT')) {
    return raw.slice(3) // "+02:00"
  }
  // Fallback: surface as-is. This branch should not occur on supported Node versions.
  return raw
}

/**
 * Format `epochMs` as an ISO 8601 string with offset, in the given timezone.
 *
 * Examples:
 *   formatLocal(Date.UTC(2026, 4, 14, 7, 15), 'Europe/Paris') → '2026-05-14T09:15:00+02:00'
 *   formatLocal(Date.UTC(2026, 4, 14, 7, 15), 'UTC')          → '2026-05-14T07:15:00Z'
 *
 * Throws `EINVALID_TIMEZONE` on invalid `tz`.
 */
export function formatLocal(epochMs: number, tz: string): string {
  validateIanaZone(tz)
  const parts = getDateParts(epochMs, tz)
  const offset = getOffsetIso(epochMs, tz)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`
}

/**
 * Return the hour-of-day bucket (0-23) for `epochMs` in `tz`.
 *
 * DST-safe via `Intl.DateTimeFormat` with `timeZone` option.
 * On DST spring-forward in Europe/Paris (2026-03-29 02:00 → 03:00 local),
 * an event at 01:30 UTC lands at 03:30 local → bucket 3.
 * On DST fall-back (2026-10-25 03:00 → 02:00 local), an event at 01:30 UTC
 * lands at 02:30 local → bucket 2.
 *
 * Throws `EINVALID_TIMEZONE` on invalid `tz`.
 */
export function bucketHourOfDay(epochMs: number, tz: string): number {
  validateIanaZone(tz)
  const parts = getDateParts(epochMs, tz)
  return Number(parts.hour)
}

/**
 * Return the day-of-week bucket for `epochMs` in `tz`.
 * 0=Sunday..6=Saturday — matches `Date.prototype.getDay` semantics
 * (see design.md §69), computed in the target zone.
 *
 * Throws `EINVALID_TIMEZONE` on invalid `tz`.
 */
export function bucketDayOfWeek(epochMs: number, tz: string): number {
  validateIanaZone(tz)
  const parts = getDateParts(epochMs, tz)
  const index = WEEKDAY_TO_INDEX[parts.weekday]
  if (index === undefined) {
    // Defensive: should never happen on Node 18+ with `weekday: 'long'` in en-US.
    throw new Error(`${ERROR_PREFIX}: could not resolve weekday for "${parts.weekday}" in "${tz}"`)
  }
  return index
}

/**
 * Return the day-of-month bucket (1-31) for `epochMs` in `tz`.
 *
 * Throws `EINVALID_TIMEZONE` on invalid `tz`.
 */
export function bucketDayOfMonth(epochMs: number, tz: string): number {
  validateIanaZone(tz)
  const parts = getDateParts(epochMs, tz)
  return Number(parts.day)
}
