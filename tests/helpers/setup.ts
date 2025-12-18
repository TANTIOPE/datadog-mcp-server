/**
 * Vitest setup file
 * Runs before all tests
 */
import { beforeAll, afterAll, afterEach } from 'vitest'
import { server } from './msw.js'

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' })
})

// Reset handlers after each test
afterEach(() => {
  server.resetHandlers()
})

// Close server after all tests
afterAll(() => {
  server.close()
})
