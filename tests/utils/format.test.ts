import { describe, it, expect } from 'vitest'
import { formatResponse, toolResult } from '../../src/utils/format.js'

describe('Format Utilities', () => {
  describe('formatResponse', () => {
    it('should format simple string as JSON', () => {
      const result = formatResponse('test string')

      expect(result).toEqual([
        {
          type: 'text',
          text: '"test string"'
        }
      ])
    })

    it('should format number as JSON', () => {
      const result = formatResponse(42)

      expect(result).toEqual([
        {
          type: 'text',
          text: '42'
        }
      ])
    })

    it('should format boolean as JSON', () => {
      const result = formatResponse(true)

      expect(result).toEqual([
        {
          type: 'text',
          text: 'true'
        }
      ])
    })

    it('should format null as JSON', () => {
      const result = formatResponse(null)

      expect(result).toEqual([
        {
          type: 'text',
          text: 'null'
        }
      ])
    })

    it('should format undefined as null (JSON.stringify fallback)', () => {
      const result = formatResponse(undefined)

      // JSON.stringify(undefined) returns undefined, so we fallback to 'null'
      expect(result).toEqual([
        {
          type: 'text',
          text: 'null'
        }
      ])
    })

    it('should format simple object with pretty-print', () => {
      const data = { key: 'value', number: 123 }
      const result = formatResponse(data)

      expect(result).toEqual([
        {
          type: 'text',
          text: '{\n  "key": "value",\n  "number": 123\n}'
        }
      ])
    })

    it('should format nested object with pretty-print', () => {
      const data = {
        user: {
          name: 'John',
          age: 30,
          tags: ['admin', 'user']
        },
        active: true
      }

      const result = formatResponse(data)

      expect(result[0]?.type).toBe('text')
      expect(result[0]?.text).toContain('"user"')
      expect(result[0]?.text).toContain('"name": "John"')
      expect(result[0]?.text).toContain('"tags"')
      expect(result[0]?.text).toContain('"admin"')
      expect(result[0]?.text).toContain('"active": true')
    })

    it('should format array', () => {
      const data = [1, 2, 3, 'four']
      const result = formatResponse(data)

      expect(result).toEqual([
        {
          type: 'text',
          text: '[\n  1,\n  2,\n  3,\n  "four"\n]'
        }
      ])
    })

    it('should format empty object', () => {
      const result = formatResponse({})

      expect(result).toEqual([
        {
          type: 'text',
          text: '{}'
        }
      ])
    })

    it('should format empty array', () => {
      const result = formatResponse([])

      expect(result).toEqual([
        {
          type: 'text',
          text: '[]'
        }
      ])
    })

    it('should handle objects with special characters in strings', () => {
      const data = {
        message: 'Line 1\nLine 2\tTabbed',
        quote: 'He said "hello"'
      }

      const result = formatResponse(data)

      expect(result[0]?.text).toContain('\\n')
      expect(result[0]?.text).toContain('\\t')
      expect(result[0]?.text).toContain('\\"hello\\"')
    })

    it('should format Date objects', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const result = formatResponse({ timestamp: date })

      expect(result[0]?.text).toContain('2024-01-15T12:00:00.000Z')
    })

    it('should handle circular references gracefully', () => {
      const obj: Record<string, unknown> = { name: 'test' }
      obj.self = obj // Create circular reference

      // JSON.stringify throws on circular refs
      expect(() => formatResponse(obj)).toThrow()
    })
  })

  describe('toolResult', () => {
    it('should wrap simple data in content structure', () => {
      const result = toolResult('test')

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: '"test"'
          }
        ]
      })
    })

    it('should wrap object in content structure', () => {
      const data = { status: 'ok', count: 42 }
      const result = toolResult(data)

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: '{\n  "status": "ok",\n  "count": 42\n}'
          }
        ]
      })
    })

    it('should wrap array in content structure', () => {
      const data = [1, 2, 3]
      const result = toolResult(data)

      expect(result).toHaveProperty('content')
      expect(result.content).toHaveLength(1)
      expect(result.content[0]?.type).toBe('text')
      expect(result.content[0]?.text).toContain('[')
    })

    it('should wrap null in content structure', () => {
      const result = toolResult(null)

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'null'
          }
        ]
      })
    })

    it('should wrap complex nested data', () => {
      const data = {
        monitors: [
          { id: 1, name: 'Monitor 1' },
          { id: 2, name: 'Monitor 2' }
        ],
        total: 2
      }

      const result = toolResult(data)

      expect(result.content[0]?.text).toContain('"monitors"')
      expect(result.content[0]?.text).toContain('"id": 1')
      expect(result.content[0]?.text).toContain('"total": 2')
    })

    it('should preserve type information', () => {
      const result = toolResult({ key: 'value' })

      // Verify the structure matches MCP tool result format
      expect(result).toHaveProperty('content')
      expect(Array.isArray(result.content)).toBe(true)
      expect(result.content[0]).toHaveProperty('type', 'text')
      expect(result.content[0]).toHaveProperty('text')
    })
  })
})
