import { describe, it, expect, vi } from 'vitest'
import { getUser, formatUser } from '../../src/tools/users.js'
import { v2 } from '@datadog/datadog-api-client'

describe('getUser', () => {
  const mockApi = {
    getUser: vi.fn()
  } as unknown as v2.UsersApi

  it('should get user by ID', async () => {
    const mockResponse = {
      data: {
        id: 'user-123',
        attributes: {
          email: 'user@example.com',
          name: 'Test User',
          status: 'Active',
          title: 'Engineer',
          verified: true,
          disabled: false,
          createdAt: new Date('2024-01-15T12:00:00Z'),
          modifiedAt: new Date('2024-01-16T14:30:00Z')
        },
        relationships: {
          roles: {
            data: [{ id: 'role-1' }, { id: 'role-2' }]
          },
          org: {
            data: { id: 'org-123' }
          }
        }
      }
    }

    mockApi.getUser = vi.fn().mockResolvedValue(mockResponse)

    const result = await getUser(mockApi, 'user-123')

    expect(result.user.id).toBe('user-123')
    expect(result.user.email).toBe('user@example.com')
    expect(result.user.name).toBe('Test User')
    expect(mockApi.getUser).toHaveBeenCalledWith({ userId: 'user-123' })
  })

  it('should throw error when user not found', async () => {
    const mockResponse = {
      data: null
    }

    mockApi.getUser = vi.fn().mockResolvedValue(mockResponse)

    await expect(getUser(mockApi, 'nonexistent')).rejects.toThrow('User nonexistent not found')
  })

  it('should throw error when data is undefined', async () => {
    const mockResponse = {}

    mockApi.getUser = vi.fn().mockResolvedValue(mockResponse)

    await expect(getUser(mockApi, 'undefined-user')).rejects.toThrow(
      'User undefined-user not found'
    )
  })
})

describe('formatUser', () => {
  it('should format complete user data', () => {
    const user: v2.User = {
      id: 'user-456',
      attributes: {
        email: 'admin@example.com',
        name: 'Admin User',
        status: 'Active',
        title: 'Senior Engineer',
        verified: true,
        disabled: false,
        createdAt: new Date('2024-01-10T10:00:00Z'),
        modifiedAt: new Date('2024-01-20T15:00:00Z')
      },
      relationships: {
        roles: {
          data: [{ id: 'admin-role' }, { id: 'user-role' }]
        },
        org: {
          data: { id: 'org-456' }
        }
      }
    }

    const result = formatUser(user)

    expect(result).toEqual({
      id: 'user-456',
      email: 'admin@example.com',
      name: 'Admin User',
      status: 'Active',
      title: 'Senior Engineer',
      verified: true,
      disabled: false,
      createdAt: '2024-01-10T10:00:00.000Z',
      modifiedAt: '2024-01-20T15:00:00.000Z',
      relationships: {
        roles: ['admin-role', 'user-role'],
        org: 'org-456'
      }
    })
  })

  it('should handle missing attributes', () => {
    const user: v2.User = {
      id: 'user-minimal'
    }

    const result = formatUser(user)

    expect(result).toEqual({
      id: 'user-minimal',
      email: '',
      name: '',
      status: '',
      title: null,
      verified: false,
      disabled: false,
      createdAt: '',
      modifiedAt: '',
      relationships: {
        roles: [],
        org: null
      }
    })
  })

  it('should handle missing relationships', () => {
    const user: v2.User = {
      id: 'user-no-rel',
      attributes: {
        email: 'test@example.com'
      }
    }

    const result = formatUser(user)

    expect(result.relationships).toEqual({
      roles: [],
      org: null
    })
  })

  it('should handle disabled user', () => {
    const user: v2.User = {
      id: 'user-disabled',
      attributes: {
        email: 'disabled@example.com',
        disabled: true,
        verified: false
      }
    }

    const result = formatUser(user)

    expect(result.disabled).toBe(true)
    expect(result.verified).toBe(false)
  })

  it('should handle user without title', () => {
    const user: v2.User = {
      id: 'user-no-title',
      attributes: {
        email: 'notitle@example.com',
        name: 'No Title'
      }
    }

    const result = formatUser(user)

    expect(result.title).toBe(null)
  })

  it('should handle empty roles array', () => {
    const user: v2.User = {
      id: 'user-no-roles',
      attributes: {
        email: 'noroles@example.com'
      },
      relationships: {
        roles: {
          data: []
        }
      }
    }

    const result = formatUser(user)

    expect(result.relationships.roles).toEqual([])
  })

  it('should handle missing org relationship', () => {
    const user: v2.User = {
      id: 'user-no-org',
      attributes: {
        email: 'noorg@example.com'
      },
      relationships: {
        org: {
          data: undefined
        }
      }
    }

    const result = formatUser(user)

    expect(result.relationships.org).toBe(null)
  })
})
