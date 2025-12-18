/**
 * Unit tests for the tags tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { tags as tagFixtures } from '../helpers/fixtures.js'

describe('Tags Tool', () => {
  let api: v1.TagsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.TagsApi(config)
  })

  describe('listHostTags', () => {
    it('should list all host tags successfully', async () => {
      server.use(
        http.get(endpoints.listHostTags, () => {
          return jsonResponse(tagFixtures.list)
        })
      )

      const response = await api.listHostTags({})

      expect(response.tags).toBeDefined()
      expect(response.tags?.['host-001']).toEqual(['env:production', 'role:web', 'team:platform'])
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listHostTags, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listHostTags({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listHostTags, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.listHostTags({})).rejects.toMatchObject({
        code: 403
      })
    })
  })

  describe('getHostTags', () => {
    it('should get tags for a specific host', async () => {
      server.use(
        http.get(endpoints.getHostTags('host-001'), () => {
          return jsonResponse(tagFixtures.hostTags)
        })
      )

      const response = await api.getHostTags({ hostName: 'host-001' })

      expect(response.tags).toEqual(['env:production', 'role:web', 'team:platform'])
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getHostTags('nonexistent'), () => {
          return errorResponse(404, 'Host not found')
        })
      )

      await expect(api.getHostTags({ hostName: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('createHostTags', () => {
    it('should create tags for a host', async () => {
      server.use(
        http.post(endpoints.createHostTags('new-host'), () => {
          return jsonResponse({
            host: 'new-host',
            tags: ['env:staging', 'service:api']
          })
        })
      )

      const response = await api.createHostTags({
        hostName: 'new-host',
        body: {
          host: 'new-host',
          tags: ['env:staging', 'service:api']
        }
      })

      expect(response.tags).toEqual(['env:staging', 'service:api'])
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.createHostTags('new-host'), () => {
          return errorResponse(400, 'Invalid tag format')
        })
      )

      await expect(api.createHostTags({
        hostName: 'new-host',
        body: { tags: ['invalid'] }
      })).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('updateHostTags', () => {
    it('should update tags for a host', async () => {
      server.use(
        http.put(endpoints.updateHostTags('host-001'), () => {
          return jsonResponse({
            host: 'host-001',
            tags: ['env:production', 'role:web', 'team:platform', 'version:v2']
          })
        })
      )

      const response = await api.updateHostTags({
        hostName: 'host-001',
        body: {
          host: 'host-001',
          tags: ['env:production', 'role:web', 'team:platform', 'version:v2']
        }
      })

      expect(response.tags).toContain('version:v2')
    })
  })

  describe('deleteHostTags', () => {
    it('should delete tags for a host', async () => {
      server.use(
        http.delete(endpoints.deleteHostTags('host-001'), () => {
          return jsonResponse({})
        })
      )

      await expect(api.deleteHostTags({ hostName: 'host-001' })).resolves.not.toThrow()
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.delete(endpoints.deleteHostTags('nonexistent'), () => {
          return errorResponse(404, 'Host not found')
        })
      )

      await expect(api.deleteHostTags({ hostName: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
