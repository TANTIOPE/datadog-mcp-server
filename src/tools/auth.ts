/**
 * Authentication tool for validating Datadog API credentials
 */
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { DatadogClients } from '../config/datadog.js'
import { handleDatadogError } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'

const ActionSchema = z.enum(['validate'])

const InputSchema = {
  action: ActionSchema.describe(
    'Action to perform: validate - test if API key and App key are valid'
  )
}

export function registerAuthTool(server: McpServer, clients: DatadogClients): void {
  server.tool(
    'auth',
    'Validate Datadog API credentials. Use this to verify that the API key and App key are correctly configured before performing other operations.',
    InputSchema,
    async ({ action }) => {
      try {
        switch (action) {
          case 'validate':
            return toolResult(await validateCredentials(clients))
          default:
            throw new Error(`Unknown action: ${action}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}

async function validateCredentials(clients: DatadogClients) {
  // Step 1: Validate API key using the official Authentication API
  const apiKeyResult = await clients.auth.validate()

  if (!apiKeyResult.valid) {
    return {
      valid: false,
      apiKeyValid: false,
      appKeyValid: false,
      error: 'API key is invalid',
      suggestion: 'Check that your DD_API_KEY environment variable is correct'
    }
  }

  // Step 2: Validate App key by making a lightweight API call that requires it
  // The Authentication API only validates API key, so we need to test App key separately
  try {
    // Use a minimal call - list users with page size 1 requires both keys
    await clients.users.listUsers({ pageSize: 1 })

    return {
      valid: true,
      apiKeyValid: true,
      appKeyValid: true,
      message: 'Both API key and App key are valid and working',
      permissions: 'Credentials have sufficient permissions to access the Datadog API'
    }
  } catch (appKeyError) {
    // API key is valid but App key might be invalid or have insufficient permissions
    const errorMessage = appKeyError instanceof Error ? appKeyError.message : String(appKeyError)

    // Check if it's an auth error or just a permission issue
    const isAuthError =
      errorMessage.includes('401') ||
      errorMessage.includes('403') ||
      errorMessage.includes('Forbidden')

    return {
      valid: !isAuthError,
      apiKeyValid: true,
      appKeyValid: !isAuthError,
      warning: isAuthError
        ? 'App key may be invalid or have insufficient permissions'
        : 'API key is valid. App key validation inconclusive.',
      error: errorMessage,
      suggestion: isAuthError
        ? 'Check that your DD_APP_KEY environment variable is correct and has appropriate scopes'
        : 'Credentials appear valid but encountered an issue during validation'
    }
  }
}
