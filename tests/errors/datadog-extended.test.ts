import { describe, it, expect } from 'vitest'
import { checkReadOnly, requireParam } from '../../src/errors/datadog.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'

describe('checkReadOnly', () => {
  describe('write actions blocked in read-only mode', () => {
    it('should block create action', () => {
      expect(() => checkReadOnly('create', true)).toThrow(McpError)
      expect(() => checkReadOnly('create', true)).toThrow('not allowed in read-only mode')
    })

    it('should block update action', () => {
      expect(() => checkReadOnly('update', true)).toThrow(McpError)
      expect(() => checkReadOnly('update', true)).toThrow('not allowed in read-only mode')
    })

    it('should block delete action', () => {
      expect(() => checkReadOnly('delete', true)).toThrow(McpError)
      expect(() => checkReadOnly('delete', true)).toThrow('not allowed in read-only mode')
    })

    it('should block mute action', () => {
      expect(() => checkReadOnly('mute', true)).toThrow(McpError)
      expect(() => checkReadOnly('mute', true)).toThrow('not allowed in read-only mode')
    })

    it('should block unmute action', () => {
      expect(() => checkReadOnly('unmute', true)).toThrow(McpError)
      expect(() => checkReadOnly('unmute', true)).toThrow('not allowed in read-only mode')
    })

    it('should block cancel action', () => {
      expect(() => checkReadOnly('cancel', true)).toThrow(McpError)
      expect(() => checkReadOnly('cancel', true)).toThrow('not allowed in read-only mode')
    })

    it('should block add action', () => {
      expect(() => checkReadOnly('add', true)).toThrow(McpError)
      expect(() => checkReadOnly('add', true)).toThrow('not allowed in read-only mode')
    })

    it('should block trigger action', () => {
      expect(() => checkReadOnly('trigger', true)).toThrow(McpError)
      expect(() => checkReadOnly('trigger', true)).toThrow('not allowed in read-only mode')
    })
  })

  describe('read actions allowed in read-only mode', () => {
    it('should allow list action', () => {
      expect(() => checkReadOnly('list', true)).not.toThrow()
    })

    it('should allow get action', () => {
      expect(() => checkReadOnly('get', true)).not.toThrow()
    })

    it('should allow search action', () => {
      expect(() => checkReadOnly('search', true)).not.toThrow()
    })
  })

  describe('all actions allowed when not in read-only mode', () => {
    it('should allow create action', () => {
      expect(() => checkReadOnly('create', false)).not.toThrow()
    })

    it('should allow update action', () => {
      expect(() => checkReadOnly('update', false)).not.toThrow()
    })

    it('should allow delete action', () => {
      expect(() => checkReadOnly('delete', false)).not.toThrow()
    })

    it('should allow list action', () => {
      expect(() => checkReadOnly('list', false)).not.toThrow()
    })
  })
})

describe('requireParam', () => {
  it('should throw on undefined', () => {
    expect(() => requireParam(undefined, 'id', 'get')).toThrow(McpError)
    expect(() => requireParam(undefined, 'id', 'get')).toThrow("Parameter 'id' is required")
  })

  it('should throw on null', () => {
    expect(() => requireParam(null, 'name', 'create')).toThrow(McpError)
    expect(() => requireParam(null, 'name', 'create')).toThrow("Parameter 'name' is required")
  })

  it('should throw on empty string', () => {
    expect(() => requireParam('', 'query', 'search')).toThrow(McpError)
    expect(() => requireParam('', 'query', 'search')).toThrow("Parameter 'query' is required")
  })

  it('should return value when valid string', () => {
    expect(requireParam('test', 'name', 'create')).toBe('test')
  })

  it('should return value when valid number', () => {
    expect(requireParam(123, 'id', 'get')).toBe(123)
  })

  it('should return value when valid object', () => {
    const obj = { key: 'value' }
    expect(requireParam(obj, 'config', 'update')).toBe(obj)
  })

  it('should return value when valid array', () => {
    const arr = [1, 2, 3]
    expect(requireParam(arr, 'items', 'create')).toBe(arr)
  })

  it('should return value when zero (not considered empty)', () => {
    expect(requireParam(0, 'count', 'update')).toBe(0)
  })

  it('should return value when false (not considered empty)', () => {
    expect(requireParam(false, 'enabled', 'update')).toBe(false)
  })
})
