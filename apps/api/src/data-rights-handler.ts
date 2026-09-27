import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  DataRightsCorrectionRequestSchema,
  DataRightsDeletionRequestSchema,
  DataRightsExportRequestSchema,
  type ApiError,
  type DataRightsCorrectionRequest,
  type DataRightsDeletionRequest,
  type DataRightsExportRequest
} from '@arro/contracts'
import {
  DataRightsStoreError,
  type DataRightsStore
} from './data-rights-service.ts'

const dataRightsExportRequestValidator = TypeCompiler.Compile(DataRightsExportRequestSchema)
const dataRightsCorrectionRequestValidator = TypeCompiler.Compile(DataRightsCorrectionRequestSchema)
const dataRightsDeletionRequestValidator = TypeCompiler.Compile(DataRightsDeletionRequestSchema)

type DataRightsHandlerOptions = {
  body: unknown
  requestId: string
  correlationId: string
  set: { status?: number | string }
}

type CreateDataRightsHandlerOptions = {
  store?: DataRightsStore
  apiError: (code: string, message: string, requestId: string) => ApiError
}

export type DataRightsHandler = (options: DataRightsHandlerOptions) => Promise<unknown>

const storeUnavailable = (
  requestId: string,
  apiError: CreateDataRightsHandlerOptions['apiError']
) => apiError(
  'data_rights_store_unavailable',
  'Data-rights storage is not configured.',
  requestId
)

const storeErrorBody = (
  error: DataRightsStoreError,
  requestId: string,
  apiError: CreateDataRightsHandlerOptions['apiError']
) => apiError(error.issue.code, error.issue.message, requestId)

export const createDataRightsAccessHandler = ({
  store,
  apiError
}: CreateDataRightsHandlerOptions): DataRightsHandler => async ({
  body,
  requestId,
  correlationId,
  set
}) => {
  if (!dataRightsExportRequestValidator.Check(body)) {
    set.status = 422
    return apiError('validation_failed', 'The request did not match the API contract.', requestId)
  }
  if (!store) {
    set.status = 503
    return storeUnavailable(requestId, apiError)
  }

  try {
    return await store.accessRecords(body as DataRightsExportRequest, { requestId, correlationId })
  } catch (error) {
    if (error instanceof DataRightsStoreError) {
      set.status = error.issue.status
      return storeErrorBody(error, requestId, apiError)
    }

    throw error
  }
}

export const createDataRightsExportHandler = ({
  store,
  apiError
}: CreateDataRightsHandlerOptions): DataRightsHandler => async ({
  body,
  requestId,
  correlationId,
  set
}) => {
  if (!dataRightsExportRequestValidator.Check(body)) {
    set.status = 422
    return apiError('validation_failed', 'The request did not match the API contract.', requestId)
  }
  if (!store) {
    set.status = 503
    return storeUnavailable(requestId, apiError)
  }

  try {
    return await store.exportRecords(body as DataRightsExportRequest, { requestId, correlationId })
  } catch (error) {
    if (error instanceof DataRightsStoreError) {
      set.status = error.issue.status
      return storeErrorBody(error, requestId, apiError)
    }

    throw error
  }
}

export const createDataRightsCorrectionHandler = ({
  store,
  apiError
}: CreateDataRightsHandlerOptions): DataRightsHandler => async ({
  body,
  requestId,
  correlationId,
  set
}) => {
  if (!dataRightsCorrectionRequestValidator.Check(body)) {
    set.status = 422
    return apiError('validation_failed', 'The request did not match the API contract.', requestId)
  }
  if (!store) {
    set.status = 503
    return storeUnavailable(requestId, apiError)
  }

  const result = await store.recordCorrection(body as DataRightsCorrectionRequest, {
    requestId,
    correlationId
  })
  if (result.recorded) return result.response

  const firstIssue = result.issues[0]
  set.status = firstIssue?.status ?? 500
  return apiError(
    firstIssue?.code ?? 'data_rights_correction_failed',
    firstIssue?.message ?? 'Data-rights correction could not be recorded.',
    requestId
  )
}

export const createDataRightsDeletionHandler = ({
  store,
  apiError
}: CreateDataRightsHandlerOptions): DataRightsHandler => async ({
  body,
  requestId,
  correlationId,
  set
}) => {
  if (!dataRightsDeletionRequestValidator.Check(body)) {
    set.status = 422
    return apiError('validation_failed', 'The request did not match the API contract.', requestId)
  }
  if (!store) {
    set.status = 503
    return storeUnavailable(requestId, apiError)
  }

  try {
    return await store.deleteRecords(body as DataRightsDeletionRequest, { requestId, correlationId })
  } catch (error) {
    if (error instanceof DataRightsStoreError) {
      set.status = error.issue.status
      return storeErrorBody(error, requestId, apiError)
    }

    throw error
  }
}
