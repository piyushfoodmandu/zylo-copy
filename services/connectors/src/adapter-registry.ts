import {
  createUnavailableCatalogCartPrepareFetcher,
  createUnavailableCatalogFetcher,
  createUnavailableCatalogProductDetailFetcher,
  type CatalogCartPrepareFetcher,
  type CatalogProductDetailFetcher,
  type CatalogProductFetcher
} from './catalog-fetcher.ts'

export type CatalogAdapterTransport = 'rest' | 'mcp' | 'internal'

export type CatalogAdapterDescriptor = {
  adapterId: string
  businessId: string
  transport: CatalogAdapterTransport
  fetcher: CatalogProductFetcher
  detailFetcher?: CatalogProductDetailFetcher
  cartPrepareFetcher?: CatalogCartPrepareFetcher
}

export type CatalogAdapterRegistryOptions = {
  missingAdapterCode?: string
}

export class CatalogAdapterRegistryError extends Error {
  readonly code: 'duplicate_catalog_adapter_business'

  constructor(message: string) {
    super(message)
    this.name = 'CatalogAdapterRegistryError'
    this.code = 'duplicate_catalog_adapter_business'
  }
}

export const createCatalogAdapterDispatcher = (
  descriptors: CatalogAdapterDescriptor[],
  options: CatalogAdapterRegistryOptions = {}
): CatalogProductFetcher => {
  const adaptersByBusinessId = new Map<string, CatalogAdapterDescriptor>()

  for (const descriptor of descriptors) {
    if (adaptersByBusinessId.has(descriptor.businessId)) {
      throw new CatalogAdapterRegistryError(
        `Multiple catalog adapters are registered for business ${descriptor.businessId}.`
      )
    }

    adaptersByBusinessId.set(descriptor.businessId, descriptor)
  }

  const unavailableFetcher = createUnavailableCatalogFetcher(
    options.missingAdapterCode ?? 'approved_catalog_adapter_not_registered'
  )

  return async (request) => {
    const descriptor = adaptersByBusinessId.get(request.source.businessId)

    if (!descriptor) return unavailableFetcher(request)

    return descriptor.fetcher(request)
  }
}

export const createCatalogProductDetailAdapterDispatcher = (
  descriptors: CatalogAdapterDescriptor[],
  options: CatalogAdapterRegistryOptions = {}
): CatalogProductDetailFetcher => {
  const adaptersByBusinessId = new Map<string, CatalogAdapterDescriptor>()

  for (const descriptor of descriptors) {
    if (adaptersByBusinessId.has(descriptor.businessId)) {
      throw new CatalogAdapterRegistryError(
        `Multiple catalog adapters are registered for business ${descriptor.businessId}.`
      )
    }

    adaptersByBusinessId.set(descriptor.businessId, descriptor)
  }

  const unavailableFetcher = createUnavailableCatalogProductDetailFetcher(
    options.missingAdapterCode ?? 'catalog_product_detail_adapter_not_registered'
  )

  return async (request) => {
    const descriptor = adaptersByBusinessId.get(request.source.businessId)

    if (!descriptor?.detailFetcher) return unavailableFetcher(request)

    return descriptor.detailFetcher(request)
  }
}

export const createCatalogCartPrepareAdapterDispatcher = (
  descriptors: CatalogAdapterDescriptor[],
  options: CatalogAdapterRegistryOptions = {}
): CatalogCartPrepareFetcher => {
  const adaptersByBusinessId = new Map<string, CatalogAdapterDescriptor>()

  for (const descriptor of descriptors) {
    if (adaptersByBusinessId.has(descriptor.businessId)) {
      throw new CatalogAdapterRegistryError(
        `Multiple catalog adapters are registered for business ${descriptor.businessId}.`
      )
    }

    adaptersByBusinessId.set(descriptor.businessId, descriptor)
  }

  const unavailableFetcher = createUnavailableCatalogCartPrepareFetcher(
    options.missingAdapterCode ?? 'catalog_cart_prepare_adapter_not_registered'
  )

  return async (request) => {
    const descriptor = adaptersByBusinessId.get(request.source.businessId)

    if (!descriptor?.cartPrepareFetcher) return unavailableFetcher(request)

    return descriptor.cartPrepareFetcher(request)
  }
}