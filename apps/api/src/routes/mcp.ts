import type { AnyElysia } from 'elysia'
import type { McpHandler } from '../mcp-handler.ts'

type RegisterMcpRouteOptions = {
  handleMcp: McpHandler
}

export const registerMcpRoute = (
  app: AnyElysia,
  { handleMcp }: RegisterMcpRouteOptions
) => {
  app
    .post('/v1/mcp', async ({ body, request, requestId, correlationId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(() =>
        handleMcp({
          body,
          request,
          requestId,
          correlationId,
          set,
          requestTimeoutGuard
        })
      )
    )
    .get('/v1/mcp', ({ set, requestId }) => {
      set.status = 405
      set.headers.allow = 'POST'
      return {
        error: {
          code: 'method_not_allowed',
          message: 'Arro MCP uses HTTP POST for JSON-RPC messages.',
          requestId
        }
      }
    })
}
