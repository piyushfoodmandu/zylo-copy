import type { AnyElysia } from 'elysia'
import type { AgentDiagnosticsHandler } from '../agent-diagnostics-handler.ts'

type RegisterAgentDiagnosticsRouteOptions = {
  handleAgentDiagnostics: AgentDiagnosticsHandler
}

export const registerAgentDiagnosticsRoute = (
  app: AnyElysia,
  { handleAgentDiagnostics }: RegisterAgentDiagnosticsRouteOptions
) => {
  app.post('/v1/agent/diagnostics', async ({ body, requestId, correlationId, set }) =>
    handleAgentDiagnostics({
      body,
      requestId,
      correlationId,
      set
    })
  )
}
