import { describe, it, expect } from 'vitest'
import { connectStdio, connectHttp } from '../../src/transport/index.js'

describe('Transport Index', () => {
  it('should export connectStdio', () => {
    expect(connectStdio).toBeDefined()
    expect(typeof connectStdio).toBe('function')
  })

  it('should export connectHttp', () => {
    expect(connectHttp).toBeDefined()
    expect(typeof connectHttp).toBe('function')
  })
})
