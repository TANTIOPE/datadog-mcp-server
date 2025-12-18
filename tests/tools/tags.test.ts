/**
 * Unit tests for the tags tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { tags as tagFixtures } from '../helpers/fixtures.js'
import {
  listAllTags,
  getHostTags,
  addHostTags,
  updateHostTags,
  deleteHostTags
} from '../../src/tools/tags.js'

describe('Tags Tool', () => {
  let api: v1.TagsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.TagsApi(config)
  })

  describe('listAllTags', () => {
    it('should list all host tags successfully', async () => {
      server.use(
        http.get(endpoints.listHostTags, () => {
          return jsonResponse(tagFixtures.list)
        })
      )

      const result = await listAllTags(api)

      expect(result.hosts).toBeDefined()
      expect(result.hosts['host-001']).toEqual(['env:production', 'role:web', 'team:platform'])
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listHostTags, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listAllTags(api)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listHostTags, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listAllTags(api)).rejects.toMatchObject({
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

      const result = await getHostTags(api, 'host-001')

      expect(result.tags).toEqual(['env:production', 'role:web', 'team:platform'])
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getHostTags('nonexistent'), () => {
          return errorResponse(404, 'Host not found')
        })
      )

      await expect(getHostTags(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('addHostTags', () => {
    it('should create tags for a host', async () => {
      server.use(
        http.post(endpoints.createHostTags('new-host'), () => {
          return jsonResponse({
            host: 'new-host',
            tags: ['env:staging', 'service:api']
          })
        })
      )

      const result = await addHostTags(api, 'new-host', ['env:staging', 'service:api'])

      expect(result.success).toBe(true)
      expect(result.tags).toEqual(['env:staging', 'service:api'])
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.createHostTags('new-host'), () => {
          return errorResponse(400, 'Invalid tag format')
        })
      )

      await expect(addHostTags(api, 'new-host', ['invalid'])).rejects.toMatchObject({
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

      const result = await updateHostTags(api, 'host-001', [
        'env:production',
        'role:web',
        'team:platform',
        'version:v2'
      ])

      expect(result.success).toBe(true)
      expect(result.tags).toContain('version:v2')
    })
  })

  describe('deleteHostTags', () => {
    it('should delete tags for a host', async () => {
      server.use(
        http.delete(endpoints.deleteHostTags('host-001'), () => {
          return jsonResponse({})
        })
      )

      const result = await deleteHostTags(api, 'host-001')

      expect(result.success).toBe(true)
      expect(result.message).toContain('host-001')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.delete(endpoints.deleteHostTags('nonexistent'), () => {
          return errorResponse(404, 'Host not found')
        })
      )

      await expect(deleteHostTags(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
