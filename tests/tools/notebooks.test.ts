/**
 * Unit tests for the notebooks tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { notebooks as notebookFixtures } from '../helpers/fixtures.js'
import {
  listNotebooks,
  getNotebook,
  createNotebook,
  updateNotebook,
  deleteNotebook
} from '../../src/tools/notebooks.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

describe('Notebooks Tool', () => {
  let api: v1.NotebooksApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.NotebooksApi(config)
  })

  describe('listNotebooks', () => {
    it('should list notebooks successfully', async () => {
      server.use(
        http.get(endpoints.listNotebooks, () => {
          return jsonResponse(notebookFixtures.list)
        })
      )

      const result = await listNotebooks(api, {}, defaultLimits)

      expect(result.notebooks).toHaveLength(2)
      expect(result.notebooks[0].name).toBe('Incident Runbook')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listNotebooks, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listNotebooks(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listNotebooks, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listNotebooks(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 403
      })
    })
  })

  describe('getNotebook', () => {
    it('should get a single notebook by ID', async () => {
      server.use(
        http.get(endpoints.getNotebook(1001), () => {
          return jsonResponse(notebookFixtures.single)
        })
      )

      const result = await getNotebook(api, 1001)

      expect(result.notebook.id).toBe(1001)
      expect(result.notebook.name).toBe('Incident Runbook')
      expect(result.notebook.status).toBe('published')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getNotebook(99999), () => {
          return errorResponse(404, 'Notebook not found')
        })
      )

      await expect(getNotebook(api, 99999)).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('createNotebook', () => {
    it('should create a new notebook', async () => {
      server.use(
        http.post(endpoints.createNotebook, () => {
          return jsonResponse(notebookFixtures.created, 201)
        })
      )

      const result = await createNotebook(api, {
        name: 'New Notebook',
        cells: [],
        time: { liveSpan: '1h' }
      })

      expect(result.success).toBe(true)
      expect(result.notebook.name).toBe('New Notebook')
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.createNotebook, () => {
          return errorResponse(400, 'Invalid notebook data')
        })
      )

      await expect(
        createNotebook(api, {
          name: '',
          cells: [],
          time: { liveSpan: '1h' }
        })
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('updateNotebook', () => {
    it('should update an existing notebook', async () => {
      server.use(
        // updateNotebook first GETs the existing notebook
        http.get(endpoints.getNotebook(1001), () => {
          return jsonResponse(notebookFixtures.single)
        }),
        http.put(endpoints.updateNotebook(1001), () => {
          return jsonResponse(notebookFixtures.updated)
        })
      )

      const result = await updateNotebook(api, 1001, {
        name: 'Updated Notebook',
        cells: [],
        time: { liveSpan: '1h' }
      })

      expect(result.success).toBe(true)
      expect(result.notebook.name).toBe('Updated Notebook')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        // updateNotebook first GETs the existing notebook - return 404 here
        http.get(endpoints.getNotebook(99999), () => {
          return errorResponse(404, 'Notebook not found')
        })
      )

      await expect(
        updateNotebook(api, 99999, {
          name: 'Test',
          cells: [],
          time: { liveSpan: '1h' }
        })
      ).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('deleteNotebook', () => {
    it('should delete a notebook', async () => {
      server.use(
        http.delete(endpoints.deleteNotebook(1001), () => {
          return jsonResponse({}, 204)
        })
      )

      const result = await deleteNotebook(api, 1001)

      expect(result.success).toBe(true)
      expect(result.message).toContain('1001')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.delete(endpoints.deleteNotebook(99999), () => {
          return errorResponse(404, 'Notebook not found')
        })
      )

      await expect(deleteNotebook(api, 99999)).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
