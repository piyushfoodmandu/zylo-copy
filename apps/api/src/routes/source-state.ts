import type { AnyElysia } from 'elysia'
import type { SourceStateHandler } from '../source-state-handler.ts'

type RegisterSourceStateRouteOptions = {
  handleSourceState: SourceStateHandler
}

export const registerSourceStateRoute = (
  app: AnyElysia,
  { handleSourceState }: RegisterSourceStateRouteOptions
) => {
  app.post('/v1/source/state', async ({ body, requestId, correlationId, set, requestTimeoutGuard }) =>
    requestTimeoutGuard.run(() =>
      handleSourceState({
        body,
        requestId,
        correlationId,
        set,
        requestTimeoutGuard
      })
    )
  )
}
