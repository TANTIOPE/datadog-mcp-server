/**
 * Unit tests for the notebooks tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { notebooks as notebookFixtures } from '../helpers/fixtures.js'

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

      const response = await api.listNotebooks({})

      expect(response.data).toHaveLength(2)
      expect(response.data?.[0].attributes?.name).toBe('Incident Runbook')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listNotebooks, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listNotebooks({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listNotebooks, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.listNotebooks({})).rejects.toMatchObject({
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

      const response = await api.getNotebook({ notebookId: 1001 })

      expect(response.data?.id).toBe(1001)
      expect(response.data?.attributes?.name).toBe('Incident Runbook')
      expect(response.data?.attributes?.status).toBe('published')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getNotebook(99999), () => {
          return errorResponse(404, 'Notebook not found')
        })
      )

      await expect(api.getNotebook({ notebookId: 99999 })).rejects.toMatchObject({
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

      const response = await api.createNotebook({
        body: {
          data: {
            type: 'notebooks',
            attributes: {
              name: 'New Notebook',
              cells: [],
              time: {
                liveSpan: '1h'
              }
            }
          }
        }
      })

      expect(response.data?.attributes?.name).toBe('New Notebook')
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.createNotebook, () => {
          return errorResponse(400, 'Invalid notebook data')
        })
      )

      await expect(api.createNotebook({
        body: {
          data: {
            type: 'notebooks',
            attributes: {
              name: '',
              cells: [],
              time: { liveSpan: '1h' }
            }
          }
        }
      })).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('updateNotebook', () => {
    it('should update an existing notebook', async () => {
      server.use(
        http.put(endpoints.updateNotebook(1001), () => {
          return jsonResponse(notebookFixtures.updated)
        })
      )

      const response = await api.updateNotebook({
        notebookId: 1001,
        body: {
          data: {
            type: 'notebooks',
            attributes: {
              name: 'Updated Notebook',
              cells: [],
              time: { liveSpan: '1h' }
            }
          }
        }
      })

      expect(response.data?.attributes?.name).toBe('Updated Notebook')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.put(endpoints.updateNotebook(99999), () => {
          return errorResponse(404, 'Notebook not found')
        })
      )

      await expect(api.updateNotebook({
        notebookId: 99999,
        body: {
          data: {
            type: 'notebooks',
            attributes: {
              name: 'Test',
              cells: [],
              time: { liveSpan: '1h' }
            }
          }
        }
      })).rejects.toMatchObject({
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

      await expect(api.deleteNotebook({ notebookId: 1001 })).resolves.not.toThrow()
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.delete(endpoints.deleteNotebook(99999), () => {
          return errorResponse(404, 'Notebook not found')
        })
      )

      await expect(api.deleteNotebook({ notebookId: 99999 })).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
