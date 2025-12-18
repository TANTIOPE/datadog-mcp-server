import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  hoursAgo,
  daysAgo,
  now,
  parseTime,
  ensureValidTimeRange,
  parseDurationToNs,
  formatDurationNs
} from '../../src/utils/time.js'

describe('Time Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('now', () => {
    it('should return current Unix timestamp in seconds', () => {
      const mockDate = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(mockDate)

      const result = now()
      const expected = Math.floor(mockDate.getTime() / 1000)

      expect(result).toBe(expected)
    })
  })

  describe('hoursAgo', () => {
    it('should calculate Unix timestamp from hours ago', () => {
      const mockDate = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(mockDate)

      const result = hoursAgo(2)
      const expected = Math.floor(mockDate.getTime() / 1000) - 2 * 3600

      expect(result).toBe(expected)
    })

    it('should handle 0 hours', () => {
      const mockDate = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(mockDate)

      const result = hoursAgo(0)
      const expected = Math.floor(mockDate.getTime() / 1000)

      expect(result).toBe(expected)
    })

    it('should handle 24 hours (1 day)', () => {
      const mockDate = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(mockDate)

      const result = hoursAgo(24)
      const expected = Math.floor(mockDate.getTime() / 1000) - 86400

      expect(result).toBe(expected)
    })
  })

  describe('daysAgo', () => {
    it('should calculate Unix timestamp from days ago', () => {
      const mockDate = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(mockDate)

      const result = daysAgo(7)
      const expected = Math.floor(mockDate.getTime() / 1000) - 7 * 86400

      expect(result).toBe(expected)
    })

    it('should handle 0 days', () => {
      const mockDate = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(mockDate)

      const result = daysAgo(0)
      const expected = Math.floor(mockDate.getTime() / 1000)

      expect(result).toBe(expected)
    })
  })

  describe('parseTime', () => {
    beforeEach(() => {
      const mockDate = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(mockDate)
    })

    it('should return default value for undefined input', () => {
      const result = parseTime(undefined, 12345)
      expect(result).toBe(12345)
    })

    it('should return number input as-is', () => {
      const result = parseTime(1705320000, 0)
      expect(result).toBe(1705320000)
    })

    it('should parse Unix timestamp as string', () => {
      const result = parseTime('1705320000', 0)
      expect(result).toBe(1705320000)
    })

    it('should parse ISO 8601 date', () => {
      const result = parseTime('2024-01-15T11:45:23Z', 0)
      const expected = Math.floor(new Date('2024-01-15T11:45:23Z').getTime() / 1000)
      expect(result).toBe(expected)
    })

    describe('simple relative time', () => {
      it('should parse seconds: "30s"', () => {
        const nowTs = now()
        const result = parseTime('30s', 0)
        expect(result).toBe(nowTs - 30)
      })

      it('should parse minutes: "15m"', () => {
        const nowTs = now()
        const result = parseTime('15m', 0)
        expect(result).toBe(nowTs - 15 * 60)
      })

      it('should parse hours: "2h"', () => {
        const nowTs = now()
        const result = parseTime('2h', 0)
        expect(result).toBe(nowTs - 2 * 3600)
      })

      it('should parse days: "7d"', () => {
        const nowTs = now()
        const result = parseTime('7d', 0)
        expect(result).toBe(nowTs - 7 * 86400)
      })
    })

    describe('relative time with specific time', () => {
      it('should parse "3d@11:45:23" (3 days ago at 11:45:23)', () => {
        vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
        const result = parseTime('3d@11:45:23', 0)

        // Parse result back to Date to check time components
        const resultDate = new Date(result * 1000)
        expect(resultDate.getHours()).toBe(11)
        expect(resultDate.getMinutes()).toBe(45)
        expect(resultDate.getSeconds()).toBe(23)

        // Verify it's roughly 3 days ago (within a few minutes)
        const threeDaysAgo = daysAgo(3)
        expect(Math.abs(result - threeDaysAgo)).toBeLessThan(13 * 3600) // Within 13 hours (accounts for time difference)
      })

      it('should parse "1d@14:30" (1 day ago at 14:30:00)', () => {
        vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
        const result = parseTime('1d@14:30', 0)

        // Parse result back to Date to check time components
        const resultDate = new Date(result * 1000)
        expect(resultDate.getHours()).toBe(14)
        expect(resultDate.getMinutes()).toBe(30)
        expect(resultDate.getSeconds()).toBe(0)

        // Verify it's roughly 1 day ago
        const oneDayAgo = daysAgo(1)
        expect(Math.abs(result - oneDayAgo)).toBeLessThan(13 * 3600)
      })

      it('should parse with space separator "3d 11:45"', () => {
        vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
        const result = parseTime('3d 11:45', 0)

        const resultDate = new Date(result * 1000)
        expect(resultDate.getHours()).toBe(11)
        expect(resultDate.getMinutes()).toBe(45)
        expect(resultDate.getSeconds()).toBe(0)
      })
    })

    describe('keyword time formats', () => {
      it('should parse "today@09:30"', () => {
        vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
        const result = parseTime('today@09:30', 0)

        // Verify time components
        const resultDate = new Date(result * 1000)
        expect(resultDate.getHours()).toBe(9)
        expect(resultDate.getMinutes()).toBe(30)
        expect(resultDate.getSeconds()).toBe(0)

        // Verify it's today (within 24 hours of now)
        const nowTs = now()
        expect(Math.abs(result - nowTs)).toBeLessThan(24 * 3600)
      })

      it('should parse "yesterday@14:00:00"', () => {
        vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
        const result = parseTime('yesterday@14:00:00', 0)

        // Verify time components
        const resultDate = new Date(result * 1000)
        expect(resultDate.getHours()).toBe(14)
        expect(resultDate.getMinutes()).toBe(0)
        expect(resultDate.getSeconds()).toBe(0)

        // Verify it's roughly 1 day ago
        const oneDayAgo = daysAgo(1)
        expect(Math.abs(result - oneDayAgo)).toBeLessThan(13 * 3600)
      })

      it('should be case-insensitive', () => {
        vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
        const result = parseTime('TODAY@09:30', 0)

        const resultDate = new Date(result * 1000)
        expect(resultDate.getHours()).toBe(9)
        expect(resultDate.getMinutes()).toBe(30)
      })
    })

    it('should return default value for invalid input', () => {
      const result = parseTime('invalid-time', 99999)
      expect(result).toBe(99999)
    })
  })

  describe('ensureValidTimeRange', () => {
    it('should return unchanged range when from < to', () => {
      const [from, to] = ensureValidTimeRange(1000, 2000)
      expect(from).toBe(1000)
      expect(to).toBe(2000)
    })

    it('should swap when from > to', () => {
      const [from, to] = ensureValidTimeRange(2000, 1000)
      expect(from).toBe(1000)
      expect(to).toBe(2000)
    })

    it('should add minimum buffer when from == to', () => {
      const [from, to] = ensureValidTimeRange(1000, 1000, 60)
      expect(from).toBe(1000)
      expect(to).toBe(1060)
    })

    it('should add minimum buffer when range is too small', () => {
      const [from, to] = ensureValidTimeRange(1000, 1030, 60)
      expect(from).toBe(1000)
      expect(to).toBe(1060)
    })

    it('should use default minimum range of 60 seconds', () => {
      const [from, to] = ensureValidTimeRange(1000, 1000)
      expect(from).toBe(1000)
      expect(to).toBe(1060)
    })

    it('should use custom minimum range', () => {
      const [from, to] = ensureValidTimeRange(1000, 1000, 300)
      expect(from).toBe(1000)
      expect(to).toBe(1300)
    })
  })

  describe('parseDurationToNs', () => {
    it('should return undefined for undefined input', () => {
      const result = parseDurationToNs(undefined)
      expect(result).toBeUndefined()
    })

    it('should return number input as-is (nanoseconds)', () => {
      const result = parseDurationToNs(1000000000)
      expect(result).toBe(1000000000)
    })

    it('should parse nanoseconds: "100ns"', () => {
      const result = parseDurationToNs('100ns')
      expect(result).toBe(100)
    })

    it('should parse microseconds: "50us"', () => {
      const result = parseDurationToNs('50us')
      expect(result).toBe(50000)
    })

    it('should parse microseconds with µ symbol: "50µs"', () => {
      const result = parseDurationToNs('50µs')
      expect(result).toBe(50000)
    })

    it('should parse milliseconds: "500ms"', () => {
      const result = parseDurationToNs('500ms')
      expect(result).toBe(500000000)
    })

    it('should parse seconds: "2s"', () => {
      const result = parseDurationToNs('2s')
      expect(result).toBe(2000000000)
    })

    it('should parse decimal seconds: "1.5s"', () => {
      const result = parseDurationToNs('1.5s')
      expect(result).toBe(1500000000)
    })

    it('should parse minutes: "5m"', () => {
      const result = parseDurationToNs('5m')
      expect(result).toBe(300000000000)
    })

    it('should parse hours: "1h"', () => {
      const result = parseDurationToNs('1h')
      expect(result).toBe(3600000000000)
    })

    it('should parse days: "2d"', () => {
      const result = parseDurationToNs('2d')
      expect(result).toBe(172800000000000)
    })

    it('should parse weeks: "1w"', () => {
      const result = parseDurationToNs('1w')
      expect(result).toBe(604800000000000)
    })

    it('should handle raw number string (assumes nanoseconds)', () => {
      const result = parseDurationToNs('1000000')
      expect(result).toBe(1000000)
    })

    it('should return undefined for invalid input', () => {
      const result = parseDurationToNs('invalid')
      expect(result).toBeUndefined()
    })

    it('should be case-insensitive', () => {
      const result = parseDurationToNs('500MS')
      expect(result).toBe(500000000)
    })

    it('should trim whitespace', () => {
      const result = parseDurationToNs('  2s  ')
      expect(result).toBe(2000000000)
    })
  })

  describe('formatDurationNs', () => {
    it('should format nanoseconds (<1000ns)', () => {
      expect(formatDurationNs(500)).toBe('500ns')
      expect(formatDurationNs(999)).toBe('999ns')
    })

    it('should format microseconds (<1ms)', () => {
      expect(formatDurationNs(1500)).toBe('1.5µs')
      expect(formatDurationNs(50000)).toBe('50.0µs')
      expect(formatDurationNs(999999)).toBe('1000.0µs')
    })

    it('should format milliseconds (<1s)', () => {
      expect(formatDurationNs(1500000)).toBe('1.5ms')
      expect(formatDurationNs(50000000)).toBe('50.0ms')
      expect(formatDurationNs(999999999)).toBe('1000.0ms')
    })

    it('should format seconds (<1m)', () => {
      expect(formatDurationNs(1500000000)).toBe('1.50s')
      expect(formatDurationNs(10000000000)).toBe('10.00s')
      expect(formatDurationNs(59999999999)).toBe('60.00s')
    })

    it('should format minutes (>=1m)', () => {
      expect(formatDurationNs(60000000000)).toBe('1.00m')
      expect(formatDurationNs(90000000000)).toBe('1.50m')
      expect(formatDurationNs(300000000000)).toBe('5.00m')
    })
  })
})
