import type { AnyElysia } from 'elysia'
import type { ProductCompareHandler } from '../product-compare-handler.ts'

type RegisterProductCompareRouteOptions = {
  handleProductCompare: ProductCompareHandler
}

export const registerProductCompareRoute = (
  app: AnyElysia,
  { handleProductCompare }: RegisterProductCompareRouteOptions
) => {
  app.post('/v1/product/compare', async ({ body, requestId, correlationId, set, requestTimeoutGuard }) =>
    requestTimeoutGuard.run(() =>
      handleProductCompare({
        body,
        requestId,
        correlationId,
        set
      })
    )
  )
}
