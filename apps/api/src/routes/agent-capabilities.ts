import type { AnyElysia } from 'elysia'
import { buildAgentCapabilityManifest } from '../agent-capabilities.ts'
import { config } from '../config.ts'

const manifestCacheControl = 'public, max-age=300'

export const registerAgentCapabilitiesRoutes = <App extends AnyElysia>(
  app: App
) =>
  app
    .get('/v1/agent/capabilities', ({ set }) => {
      set.headers['cache-control'] = manifestCacheControl
      return buildAgentCapabilityManifest(config.publicBaseUrl)
    })
    .get('/.well-known/arro-agent-capabilities', ({ set }) => {
      set.headers['cache-control'] = manifestCacheControl
      return buildAgentCapabilityManifest(config.publicBaseUrl)
    })
