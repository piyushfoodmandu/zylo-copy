import type { AnyElysia } from 'elysia'
import type { ProductSanityCheckHandler } from '../product-sanity-check-handler.ts'

type RegisterProductSanityCheckRouteOptions = {
  handleProductSanityCheck: ProductSanityCheckHandler
}

export const registerProductSanityCheckRoute = (
  app: AnyElysia,
  { handleProductSanityCheck }: RegisterProductSanityCheckRouteOptions
) => {
  app.post('/v1/product/sanity-check', async ({ body, requestId, correlationId, set, requestTimeoutGuard }) =>
    requestTimeoutGuard.run(() =>
      handleProductSanityCheck({
        body,
        requestId,
        correlationId,
        set
      })
    )
  )
}
