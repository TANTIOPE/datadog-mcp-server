import { describe, it, expect } from 'vitest'
import { formatNotebookSummary, formatNotebookDetail } from '../../src/tools/notebooks.js'
import { v1 } from '@datadog/datadog-api-client'

describe('formatNotebookSummary', () => {
  it('should format complete notebook summary', () => {
    const notebook: v1.NotebooksResponseData = {
      id: 12345,
      attributes: {
        name: 'Test Notebook',
        author: {
          handle: 'user@example.com',
          name: 'Test User'
        },
        status: 'published' as v1.NotebookStatus,
        cells: [
          { id: 'cell1', type: 'markdown' as v1.NotebookCellResourceType, attributes: {} },
          { id: 'cell2', type: 'timeseries' as v1.NotebookCellResourceType, attributes: {} }
        ],
        created: new Date('2024-01-15T12:00:00Z'),
        modified: new Date('2024-01-16T14:30:00Z'),
        metadata: {
          isTemplate: false,
          takeSnapshots: true
        }
      }
    }

    const result = formatNotebookSummary(notebook)

    expect(result).toEqual({
      id: 12345,
      name: 'Test Notebook',
      author: {
        handle: 'user@example.com',
        name: 'Test User'
      },
      status: 'published',
      cellCount: 2,
      created: '2024-01-15T12:00:00.000Z',
      modified: '2024-01-16T14:30:00.000Z',
      metadata: {
        isTemplate: false,
        takeSnapshots: true
      }
    })
  })

  it('should handle missing attributes', () => {
    const notebook: v1.NotebooksResponseData = { id: 123 }

    const result = formatNotebookSummary(notebook)

    expect(result).toEqual({
      id: 123,
      name: '',
      author: {
        handle: null,
        name: null
      },
      status: '',
      cellCount: 0,
      created: '',
      modified: '',
      metadata: {
        isTemplate: null,
        takeSnapshots: null
      }
    })
  })

  it('should handle missing author', () => {
    const notebook: v1.NotebooksResponseData = {
      id: 456,
      attributes: {
        name: 'No Author Notebook',
        status: 'published' as v1.NotebookStatus,
        cells: []
      }
    }

    const result = formatNotebookSummary(notebook)

    expect(result.author).toEqual({
      handle: null,
      name: null
    })
  })

  it('should handle empty cells array', () => {
    const notebook: v1.NotebooksResponseData = {
      id: 789,
      attributes: {
        name: 'Empty Notebook',
        cells: []
      }
    }

    const result = formatNotebookSummary(notebook)

    expect(result.cellCount).toBe(0)
  })

  it('should handle missing metadata', () => {
    const notebook: v1.NotebooksResponseData = {
      id: 999,
      attributes: {
        name: 'No Metadata'
      }
    }

    const result = formatNotebookSummary(notebook)

    expect(result.metadata).toEqual({
      isTemplate: null,
      takeSnapshots: null
    })
  })

  it('should handle missing dates', () => {
    const notebook: v1.NotebooksResponseData = {
      id: 111,
      attributes: {
        name: 'No Dates'
      }
    }

    const result = formatNotebookSummary(notebook)

    expect(result.created).toBe('')
    expect(result.modified).toBe('')
  })
})

describe('formatNotebookDetail', () => {
  it('should format complete notebook detail with cells', () => {
    const notebook: v1.NotebookResponseData = {
      id: 12345,
      attributes: {
        name: 'Detailed Notebook',
        author: {
          handle: 'user@example.com',
          name: 'Test User'
        },
        status: 'published' as v1.NotebookStatus,
        cells: [
          {
            id: 'markdown-1',
            type: 'markdown' as v1.NotebookCellResourceType,
            attributes: {
              definition: {
                type: 'markdown' as v1.NotebookMarkdownCellDefinitionType,
                text: '# Header'
              }
            }
          },
          {
            id: 'timeseries-1',
            type: 'timeseries' as v1.NotebookCellResourceType,
            attributes: {
              definition: {
                type: 'timeseries' as v1.NotebookTimeseriesCellDefinitionType,
                requests: []
              }
            }
          }
        ],
        created: new Date('2024-01-15T12:00:00Z'),
        modified: new Date('2024-01-16T14:30:00Z'),
        time: {
          liveSpan: '1h'
        } as unknown as v1.NotebookGlobalTime,
        metadata: {
          isTemplate: false,
          takeSnapshots: true
        }
      }
    }

    const result = formatNotebookDetail(notebook)

    expect(result.id).toBe(12345)
    expect(result.name).toBe('Detailed Notebook')
    expect(result.cellCount).toBe(2)
    expect(result.cells).toHaveLength(2)
    expect(result.cells[0]).toEqual({
      id: 'markdown-1',
      type: 'markdown',
      attributes: expect.any(Object)
    })
    expect(result.cells[1]).toEqual({
      id: 'timeseries-1',
      type: 'timeseries',
      attributes: expect.any(Object)
    })
    expect(result.time.liveSpan).toBe('1h')
  })

  it('should handle empty cells array', () => {
    const notebook: v1.NotebookResponseData = {
      id: 789,
      attributes: {
        name: 'Empty Notebook',
        cells: []
      }
    }

    const result = formatNotebookDetail(notebook)

    expect(result.cells).toEqual([])
    expect(result.cellCount).toBe(0)
  })

  it('should handle missing cells', () => {
    const notebook: v1.NotebookResponseData = {
      id: 888,
      attributes: {
        name: 'No Cells'
      }
    }

    const result = formatNotebookDetail(notebook)

    expect(result.cells).toEqual([])
    expect(result.cellCount).toBe(0)
  })

  it('should handle different cell types', () => {
    const notebook: v1.NotebookResponseData = {
      id: 555,
      attributes: {
        name: 'Mixed Cells',
        cells: [
          { id: 'md', type: 'markdown' as v1.NotebookCellResourceType, attributes: {} },
          { id: 'ts', type: 'timeseries' as v1.NotebookCellResourceType, attributes: {} },
          { id: 'tl', type: 'toplist' as v1.NotebookCellResourceType, attributes: {} },
          { id: 'hm', type: 'heatmap' as v1.NotebookCellResourceType, attributes: {} }
        ]
      }
    }

    const result = formatNotebookDetail(notebook)

    expect(result.cells).toHaveLength(4)
    expect(result.cells.map((c) => c.type)).toEqual([
      'markdown',
      'timeseries',
      'toplist',
      'heatmap'
    ])
  })

  it('should handle missing time configuration', () => {
    const notebook: v1.NotebookResponseData = {
      id: 666,
      attributes: {
        name: 'No Time'
      }
    }

    const result = formatNotebookDetail(notebook)

    expect(result.time.liveSpan).toBe(null)
  })

  it('should handle cell with missing id or type', () => {
    const notebook: v1.NotebookResponseData = {
      id: 777,
      attributes: {
        name: 'Malformed Cells',
        cells: [
          { id: undefined, type: undefined, attributes: {} } as unknown as v1.NotebookCellResponse
        ]
      }
    }

    const result = formatNotebookDetail(notebook)

    expect(result.cells[0]).toEqual({
      id: '',
      type: '',
      attributes: {}
    })
  })

  it('should preserve cell attributes', () => {
    const customAttributes = {
      definition: {
        type: 'markdown',
        text: 'Custom content'
      }
    }

    const notebook: v1.NotebookResponseData = {
      id: 999,
      attributes: {
        name: 'Custom Attributes',
        cells: [
          {
            id: 'custom',
            type: 'markdown' as v1.NotebookCellResourceType,
            attributes: customAttributes
          }
        ]
      }
    }

    const result = formatNotebookDetail(notebook)

    expect(result.cells[0]?.attributes).toEqual(customAttributes)
  })
})
