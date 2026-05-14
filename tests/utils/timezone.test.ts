import { describe, it, expect } from 'vitest'
import {
  validateIanaZone,
  formatLocal,
  bucketHourOfDay,
  bucketDayOfWeek,
  bucketDayOfMonth
} from '../../src/utils/timezone.js'

describe('Timezone Utilities', () => {
  describe('validateIanaZone', () => {
    it('accepts UTC', () => {
      expect(() => validateIanaZone('UTC')).not.toThrow()
    })

    it('accepts Europe/Paris', () => {
      expect(() => validateIanaZone('Europe/Paris')).not.toThrow()
    })

    it('accepts America/New_York', () => {
      expect(() => validateIanaZone('America/New_York')).not.toThrow()
    })

    it('rejects empty string with EINVALID_TIMEZONE', () => {
      expect(() => validateIanaZone('')).toThrow(/EINVALID_TIMEZONE/)
    })

    it('rejects non-string with EINVALID_TIMEZONE', () => {
      // @ts-expect-error — testing runtime guard against non-string input
      expect(() => validateIanaZone(123)).toThrow(/EINVALID_TIMEZONE/)
    })

    it('rejects unknown zone with EINVALID_TIMEZONE', () => {
      expect(() => validateIanaZone('NotARealZone')).toThrow(/EINVALID_TIMEZONE/)
    })

    it('rejects broken EST5EDT-broken with EINVALID_TIMEZONE', () => {
      expect(() => validateIanaZone('EST5EDT-broken')).toThrow(/EINVALID_TIMEZONE/)
    })

    it('includes up to 3 suggestions for near-miss zones', () => {
      let thrown: Error | undefined
      try {
        validateIanaZone('Europe/Pari')
      } catch (err) {
        thrown = err as Error
      }
      expect(thrown).toBeDefined()
      expect(thrown?.message).toMatch(/EINVALID_TIMEZONE/)
      // Should suggest Europe/Paris
      expect(thrown?.message).toMatch(/Europe\/Paris/)
      // Extract the suggestion list — everything after "Did you mean: ".
      const suggestionMatch = thrown?.message.match(/Did you mean: (.+?)\?/)
      expect(suggestionMatch).not.toBeNull()
      const suggestions = (suggestionMatch?.[1] ?? '').split(',').map((s) => s.trim())
      expect(suggestions.length).toBeLessThanOrEqual(3)
      expect(suggestions.length).toBeGreaterThan(0)
    })

    it('does not throw a generic Error message — uses EINVALID_TIMEZONE prefix', () => {
      try {
        validateIanaZone('xyz')
      } catch (err) {
        expect((err as Error).message.startsWith('EINVALID_TIMEZONE')).toBe(true)
      }
    })
  })

  describe('formatLocal', () => {
    it('returns ISO 8601 with offset for Europe/Paris in summer (CEST = +02:00)', () => {
      // 2026-05-14T07:15:00Z → 09:15 in Paris (CEST)
      const ms = Date.UTC(2026, 4, 14, 7, 15, 0)
      expect(formatLocal(ms, 'Europe/Paris')).toBe('2026-05-14T09:15:00+02:00')
    })

    it('returns ISO 8601 with offset for Europe/Paris in winter (CET = +01:00)', () => {
      // 2026-01-14T07:15:00Z → 08:15 in Paris (CET)
      const ms = Date.UTC(2026, 0, 14, 7, 15, 0)
      expect(formatLocal(ms, 'Europe/Paris')).toBe('2026-01-14T08:15:00+01:00')
    })

    it('returns ISO 8601 with Z for UTC zone', () => {
      const ms = Date.UTC(2026, 4, 14, 7, 15, 0)
      const out = formatLocal(ms, 'UTC')
      // Either Z or +00:00 is acceptable ISO 8601; we choose Z for UTC.
      expect(out).toBe('2026-05-14T07:15:00Z')
    })

    it('returns ISO 8601 with negative offset for America/New_York in summer (EDT = -04:00)', () => {
      // 2026-07-14T16:15:00Z → 12:15 in NY (EDT)
      const ms = Date.UTC(2026, 6, 14, 16, 15, 0)
      expect(formatLocal(ms, 'America/New_York')).toBe('2026-07-14T12:15:00-04:00')
    })

    it('throws EINVALID_TIMEZONE for invalid zone', () => {
      const ms = Date.UTC(2026, 4, 14, 7, 15, 0)
      expect(() => formatLocal(ms, 'NotARealZone')).toThrow(/EINVALID_TIMEZONE/)
    })
  })

  describe('bucketHourOfDay', () => {
    it('returns 0..23 inclusive', () => {
      const ms = Date.UTC(2026, 4, 14, 0, 0, 0)
      const hour = bucketHourOfDay(ms, 'UTC')
      expect(hour).toBeGreaterThanOrEqual(0)
      expect(hour).toBeLessThanOrEqual(23)
    })

    it('returns hour 3 for 2026-03-29T01:30:00Z in Europe/Paris (DST spring-forward)', () => {
      const ms = Date.parse('2026-03-29T01:30:00Z')
      // At 01:00 UTC on 2026-03-29 in Paris, clocks jump from 02:00 to 03:00.
      // So 01:30 UTC = 03:30 local (CEST = +02:00).
      expect(bucketHourOfDay(ms, 'Europe/Paris')).toBe(3)
    })

    it('returns hour 2 for 2026-10-25T01:30:00Z in Europe/Paris (DST fall-back)', () => {
      const ms = Date.parse('2026-10-25T01:30:00Z')
      // At 01:00 UTC on 2026-10-25 in Paris, clocks fall back from 03:00 to 02:00.
      // So 01:30 UTC = 02:30 local (CET = +01:00), bucketed as hour 2.
      expect(bucketHourOfDay(ms, 'Europe/Paris')).toBe(2)
    })

    it('returns 7 for 2026-05-14T07:15:00Z in UTC', () => {
      const ms = Date.parse('2026-05-14T07:15:00Z')
      expect(bucketHourOfDay(ms, 'UTC')).toBe(7)
    })

    it('returns 9 for 2026-05-14T07:15:00Z in Europe/Paris (CEST)', () => {
      const ms = Date.parse('2026-05-14T07:15:00Z')
      expect(bucketHourOfDay(ms, 'Europe/Paris')).toBe(9)
    })

    it('throws EINVALID_TIMEZONE for invalid zone', () => {
      const ms = Date.parse('2026-05-14T07:15:00Z')
      expect(() => bucketHourOfDay(ms, 'NotARealZone')).toThrow(/EINVALID_TIMEZONE/)
    })
  })

  describe('bucketDayOfWeek', () => {
    it('returns 4 (Thursday) for 2026-05-14T12:00:00Z in UTC (per design: 0=Sunday..6=Saturday)', () => {
      const ms = Date.parse('2026-05-14T12:00:00Z')
      // 2026-05-14 is a Thursday → 4 (0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat)
      expect(bucketDayOfWeek(ms, 'UTC')).toBe(4)
    })

    it('returns 0 (Sunday) for a Sunday', () => {
      // 2026-05-17 is a Sunday
      const ms = Date.parse('2026-05-17T12:00:00Z')
      expect(bucketDayOfWeek(ms, 'UTC')).toBe(0)
    })

    it('crosses day boundary at midnight in target zone (Paris-late vs UTC-early)', () => {
      // 2026-05-14T23:30:00Z = 2026-05-15T01:30 Paris (Friday) but Thursday in UTC
      const ms = Date.parse('2026-05-14T23:30:00Z')
      expect(bucketDayOfWeek(ms, 'UTC')).toBe(4) // Thursday
      expect(bucketDayOfWeek(ms, 'Europe/Paris')).toBe(5) // Friday
    })

    it('crosses day boundary in other direction (NY-late vs UTC-early)', () => {
      // 2026-05-14T03:00:00Z = 2026-05-13T23:00 NY (Wednesday) but Thursday UTC
      const ms = Date.parse('2026-05-14T03:00:00Z')
      expect(bucketDayOfWeek(ms, 'UTC')).toBe(4) // Thursday
      expect(bucketDayOfWeek(ms, 'America/New_York')).toBe(3) // Wednesday
    })

    it('throws EINVALID_TIMEZONE for invalid zone', () => {
      const ms = Date.parse('2026-05-14T07:15:00Z')
      expect(() => bucketDayOfWeek(ms, 'NotARealZone')).toThrow(/EINVALID_TIMEZONE/)
    })
  })

  describe('bucketDayOfMonth', () => {
    it('returns 14 for 2026-05-14T12:00:00Z in UTC', () => {
      const ms = Date.parse('2026-05-14T12:00:00Z')
      expect(bucketDayOfMonth(ms, 'UTC')).toBe(14)
    })

    it('crosses day boundary at midnight in Europe/Paris (UTC late-night → next day Paris)', () => {
      // 2026-05-14T23:30:00Z = 01:30 Paris on 2026-05-15
      const ms = Date.parse('2026-05-14T23:30:00Z')
      expect(bucketDayOfMonth(ms, 'UTC')).toBe(14)
      expect(bucketDayOfMonth(ms, 'Europe/Paris')).toBe(15)
    })

    it('crosses day boundary in America/New_York (UTC early-morning → previous day NY)', () => {
      // 2026-05-14T03:00:00Z = 23:00 NY on 2026-05-13
      const ms = Date.parse('2026-05-14T03:00:00Z')
      expect(bucketDayOfMonth(ms, 'UTC')).toBe(14)
      expect(bucketDayOfMonth(ms, 'America/New_York')).toBe(13)
    })

    it('returns 1 for the first of a month in target zone', () => {
      // 2026-05-31T23:30Z = 01:30 Paris on 2026-06-01
      const ms = Date.parse('2026-05-31T23:30:00Z')
      expect(bucketDayOfMonth(ms, 'Europe/Paris')).toBe(1)
    })

    it('throws EINVALID_TIMEZONE for invalid zone', () => {
      const ms = Date.parse('2026-05-14T07:15:00Z')
      expect(() => bucketDayOfMonth(ms, 'NotARealZone')).toThrow(/EINVALID_TIMEZONE/)
    })
  })
})
