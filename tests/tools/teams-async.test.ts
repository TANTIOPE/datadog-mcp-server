import { describe, it, expect, vi } from 'vitest'
import { getTeam, getTeamMembers } from '../../src/tools/teams.js'
import { v2 } from '@datadog/datadog-api-client'

describe('getTeam', () => {
  const mockApi = {
    getTeam: vi.fn()
  } as unknown as v2.TeamsApi

  it('should get team by ID', async () => {
    const mockResponse = {
      data: {
        id: 'team-123',
        attributes: {
          handle: 'platform-team',
          name: 'Platform Team',
          description: 'Core platform team',
          userCount: 5,
          createdAt: new Date('2024-01-15T12:00:00Z'),
          modifiedAt: new Date('2024-01-16T14:30:00Z')
        }
      }
    }

    mockApi.getTeam = vi.fn().mockResolvedValue(mockResponse)

    const result = await getTeam(mockApi, 'team-123')

    expect(result.team.id).toBe('team-123')
    expect(result.team.handle).toBe('platform-team')
    expect(result.team.name).toBe('Platform Team')
    expect(mockApi.getTeam).toHaveBeenCalledWith({ teamId: 'team-123' })
  })

  it('should throw error when team not found', async () => {
    const mockResponse = {
      data: null
    }

    mockApi.getTeam = vi.fn().mockResolvedValue(mockResponse)

    await expect(getTeam(mockApi, 'nonexistent')).rejects.toThrow('Team nonexistent not found')
  })

  it('should throw error when data is undefined', async () => {
    const mockResponse = {}

    mockApi.getTeam = vi.fn().mockResolvedValue(mockResponse)

    await expect(getTeam(mockApi, 'undefined-team')).rejects.toThrow(
      'Team undefined-team not found'
    )
  })
})

describe('getTeamMembers', () => {
  const mockApi = {
    getTeamMemberships: vi.fn()
  } as unknown as v2.TeamsApi

  const limits = { defaultLimit: 50 }

  it('should get team members', async () => {
    const mockResponse = {
      data: [
        {
          id: 'member-1',
          attributes: {
            role: 'admin'
          },
          relationships: {
            user: {
              data: {
                id: 'user-1'
              }
            }
          }
        },
        {
          id: 'member-2',
          attributes: {
            role: 'member'
          },
          relationships: {
            user: {
              data: {
                id: 'user-2'
              }
            }
          }
        }
      ]
    }

    mockApi.getTeamMemberships = vi.fn().mockResolvedValue(mockResponse)

    const result = await getTeamMembers(mockApi, 'team-123', limits)

    expect(result.members).toHaveLength(2)
    expect(result.members[0]?.id).toBe('member-1')
    expect(result.members[0]?.attributes.role).toBe('admin')
    expect(result.members[0]?.relationships.userId).toBe('user-1')
    expect(result.meta.totalCount).toBe(2)
    expect(mockApi.getTeamMemberships).toHaveBeenCalledWith({
      teamId: 'team-123',
      pageSize: 50
    })
  })

  it('should handle empty team', async () => {
    const mockResponse = {
      data: []
    }

    mockApi.getTeamMemberships = vi.fn().mockResolvedValue(mockResponse)

    const result = await getTeamMembers(mockApi, 'empty-team', limits)

    expect(result.members).toHaveLength(0)
    expect(result.meta.totalCount).toBe(0)
  })

  it('should use defaultLimit when no params provided', async () => {
    const mockResponse = {
      data: []
    }

    mockApi.getTeamMemberships = vi.fn().mockResolvedValue(mockResponse)

    const customLimits = { defaultLimit: 25 }

    await getTeamMembers(mockApi, 'team-456', customLimits)

    expect(mockApi.getTeamMemberships).toHaveBeenCalledWith({
      teamId: 'team-456',
      pageSize: 25
    })
  })

  it('should handle null/undefined data', async () => {
    const mockResponse = {
      data: null
    }

    mockApi.getTeamMemberships = vi.fn().mockResolvedValue(mockResponse)

    const result = await getTeamMembers(mockApi, 'team-null', limits)

    expect(result.members).toHaveLength(0)
    expect(result.meta.totalCount).toBe(0)
  })
})
