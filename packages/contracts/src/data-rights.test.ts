import { TypeCompiler } from '@sinclair/typebox/compiler'
import { describe, expect, it } from 'vitest'
import {
  DataRightsCorrectionRequestSchema,
  DataRightsDeletionRequestSchema,
  DataRightsExportRequestSchema
} from './data-rights.ts'

const exportValidator = TypeCompiler.Compile(DataRightsExportRequestSchema)
const correctionValidator = TypeCompiler.Compile(DataRightsCorrectionRequestSchema)
const deletionValidator = TypeCompiler.Compile(DataRightsDeletionRequestSchema)

describe('data-rights contracts', () => {
  it('accepts scoped export, correction, and deletion requests without raw account identity fields', () => {
    expect(exportValidator.Check({
      integrationId: 'direct-http',
      externalSubjectRef: 'opaque-subject-ref',
      include: ['ucp_checkout_sessions', 'ucp_payment_results', 'ucp_orders', 'data_rights_events']
    })).toBe(true)

    expect(correctionValidator.Check({
      integrationId: 'direct-http',
      externalSubjectRef: 'opaque-subject-ref',
      target: {
        kind: 'purchase',
        recordId: 'ucptx_1'
      },
      correction: {
        field: 'intent.summary',
        statement: 'The submitted size preference was inaccurate.'
      }
    })).toBe(true)

    expect(deletionValidator.Check({
      integrationId: 'direct-http',
      externalSubjectRef: 'opaque-subject-ref',
      recordKinds: ['ucp_checkout_sessions', 'ucp_payment_results', 'ucp_orders'],
      reason: 'user_request'
    })).toBe(true)
  })

  it('rejects broad deletion targets outside the supported durable record families', () => {
    expect(deletionValidator.Check({
      integrationId: 'direct-http',
      externalSubjectRef: 'opaque-subject-ref',
      recordKinds: ['commerce_memory_records']
    })).toBe(false)
  })
})
