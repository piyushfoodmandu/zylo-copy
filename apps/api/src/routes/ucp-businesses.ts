import type { AnyElysia } from 'elysia'
import {
  buildTargetBusinessMatrix
} from '@arro/connectors'
import type { TargetBusinessRecord } from '@arro/contracts'

type UcpBusinessesRouteOptions = {
  loadTargetBusinessRecords: () => Promise<TargetBusinessRecord[]>
}

export const registerUcpBusinessesRoute = <App extends AnyElysia>(
  app: App,
  { loadTargetBusinessRecords }: UcpBusinessesRouteOptions
) =>
  app.get('/v1/ucp/businesses', async ({ requestId, correlationId }) => {
    const records = await loadTargetBusinessRecords()

    return buildTargetBusinessMatrix({ requestId, correlationId, records })
  })
