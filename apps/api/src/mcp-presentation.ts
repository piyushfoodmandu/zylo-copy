import type {
  McpPresentation,
  McpToolName
} from '@arro/contracts'
import {
  formatMoney as formatContractMoney
} from '@arro/contracts'

type JsonRecord = Record<string, unknown>

const asRecord = (value: unknown): JsonRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined

const asRecords = (value: unknown): JsonRecord[] => Array.isArray(value)
  ? value.reduce<JsonRecord[]>((records, entry) => {
      const record = asRecord(entry)
      if (record) records.push(record)
      return records
    }, [])
  : []

const asString = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  ? value.trim()
  : undefined

const first = <T>(values: T[]) => values[0]

const formatMoney = (value: unknown) => {
  const money = asRecord(value)
  const amountMinor = typeof money?.amountMinor === 'number' && Number.isSafeInteger(money.amountMinor)
    ? money.amountMinor
    : undefined
  const currency = asString(money?.currency)
  if (amountMinor === undefined || !currency) return undefined
  return formatContractMoney({ amountMinor, currency })
}

const labelForTool = (toolName: McpToolName) => toolName
  .split('_')
  .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
  .join(' ')

const dedupe = <T>(values: T[], keyFor: (value: T) => string) => {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const value of values) {
    const key = keyFor(value)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(value)
  }
  return unique
}

const sourceLabelFrom = (value: unknown): McpPresentation['sourceLabels'][number] | undefined => {
  const sourceLabel = asRecord(value)
  const sourceId = asString(sourceLabel?.sourceId)
  const sourceName = asString(sourceLabel?.sourceName)
  const factType = asString(sourceLabel?.factType)
  if (!sourceId || !sourceName || !factType) return undefined

  return {
    sourceId,
    sourceName,
    factType,
    ...(asString(sourceLabel?.freshnessClass) ? { freshnessClass: asString(sourceLabel?.freshnessClass)! } : {}),
    ...(asString(sourceLabel?.bindingStatus) ? { bindingStatus: asString(sourceLabel?.bindingStatus)! } : {}),
    ...(asString(sourceLabel?.fetchedAt) ? { fetchedAt: asString(sourceLabel?.fetchedAt)! } : {}),
    ...(asString(sourceLabel?.expiresAt) ? { expiresAt: asString(sourceLabel?.expiresAt)! } : {})
  }
}

const sourceLabelsFromResponse = (response: JsonRecord): McpPresentation['sourceLabels'] => {
  const labels = [
    ...asRecords(response.items).map((item) => sourceLabelFrom(item.sourceLabel)),
    sourceLabelFrom(asRecord(response.product)?.sourceLabel),
    sourceLabelFrom(asRecord(response.cart)?.sourceLabel),
    sourceLabelFrom(asRecord(response.attempt)?.sourceLabel),
    sourceLabelFrom(asRecord(response.handoff)?.sourceLabel),
    ...asRecords(response.sources).map((source) => sourceLabelFrom(source.sourceLabel)),
    ...asRecords(response.assessments).map((assessment) => sourceLabelFrom(assessment.sourceLabel)),
    ...asRecords(response.candidateAssessments).map((assessment) => sourceLabelFrom(assessment.sourceLabel))
  ].filter((label): label is McpPresentation['sourceLabels'][number] => Boolean(label))

  return dedupe(labels, (label) =>
    `${label.sourceId}:${label.factType}:${label.fetchedAt ?? ''}`
  ).slice(0, 12)
}

const actionsFromPolicy = (response: JsonRecord): McpPresentation['allowedNextActions'] => {
  const actionPolicy = asRecord(response.actionPolicy)
  return asRecords(actionPolicy?.allowedNextActions).map((action) => ({
    action: asString(action.action) ?? 'unknown',
    label: asString(action.label) ?? 'Next action',
    ...(asString(action.authority) ? { authority: asString(action.authority)! } : {}),
    ...(asString(action.reason) ? { reason: asString(action.reason)! } : {})
  })).slice(0, 8)
}

const messageTexts = (response: JsonRecord) => [
  ...asRecords(response.messages),
  ...asRecords(response.findings),
  ...asRecords(asRecord(response.product)?.warnings),
  ...asRecords(asRecord(response.cart)?.warnings),
  ...asRecords(response.caveats),
  ...asRecords(response.evidenceGaps)
].map((message) => asString(message.text)).filter((text): text is string => Boolean(text))

const warningTexts = (response: JsonRecord) => [
  ...asRecords(response.messages),
  ...asRecords(response.findings),
  ...asRecords(asRecord(response.product)?.warnings),
  ...asRecords(asRecord(response.cart)?.warnings),
  ...asRecords(response.caveats),
  ...asRecords(response.evidenceGaps)
]
  .filter((message) => asString(message.severity) === 'warning' || asString(message.severity) === 'error')
  .map((message) => asString(message.text))
  .filter((text): text is string => Boolean(text))
  .slice(0, 12)

const addFact = (
  facts: McpPresentation['facts'],
  label: string,
  value: unknown,
  sourceId?: string
) => {
  const text = asString(value)
  if (!text) return
  facts.push({
    label,
    value: text,
    ...(sourceId ? { sourceId } : {})
  })
}

const sellerFactValue = (seller: JsonRecord | undefined) => {
  const name = asString(seller?.name)
  const domain = asString(seller?.domain)
  if (name && domain && name.toLowerCase() !== domain.toLowerCase()) return `${name} (${domain})`
  return name ?? domain
}

const productFacts = (product: JsonRecord | undefined): McpPresentation['facts'] => {
  const facts: McpPresentation['facts'] = []
  if (!product) return facts

  const sourceId = asString(asRecord(product.sourceLabel)?.sourceId)
  addFact(facts, 'Product', product.title, sourceId)
  addFact(facts, 'Brand', product.brand, sourceId)
  addFact(facts, 'Price', formatMoney(product.price), sourceId)
  addFact(facts, 'Availability', product.availability, sourceId)
  addFact(facts, 'Condition', product.condition, sourceId)
  addFact(facts, 'Seller', sellerFactValue(asRecord(product.seller)), sourceId)
  return facts
}

const checkoutActionFrom = (response: JsonRecord): McpPresentation['primaryAction'] => {
  const attempt = asRecord(response.attempt)
  const cartHandoff = asRecord(asRecord(response.cart)?.handoff)
  const checkout = asRecord(response.checkout)
  const primaryAction = asRecord(response.primaryAction)
  const continueUrl =
    asString(response.continueUrl) ??
    asString(attempt?.continueUrl) ??
    asString(cartHandoff?.url) ??
    asString(checkout?.continue_url) ??
    asString(primaryAction?.url)
  if (!continueUrl) return undefined

  return {
    action: asString(primaryAction?.action) ?? 'continue_checkout',
    label: asString(primaryAction?.label) ?? 'Continue on merchant',
    authority: 'allowed',
    reason: 'Arro returned a source-bound merchant continuation instead of direct completion. Verify final price, shipping, taxes, returns, and payment details before paying.',
    url: continueUrl
  }
}

const handoffActionFrom = (product: JsonRecord | undefined): McpPresentation['primaryAction'] => {
  const handoff = asRecord(product?.handoff)
  const url = asString(handoff?.url)
  if (!url) return undefined
  const handoffType = asString(handoff?.type)

  return {
    action: 'open_merchant_page',
    label: handoffType === 'variant_checkout'
      ? 'Open merchant variant'
      : 'Open merchant page',
    authority: 'limited',
    reason: 'Arro found a source-labeled merchant handoff. Verify variant, shipping, taxes, final price, returns, and seller trust on the merchant page before paying.',
    url
  }
}

const toneFor = (toolName: McpToolName, httpStatus: number, response: JsonRecord): McpPresentation['tone'] => {
  if (httpStatus >= 400 || asRecord(response.error)) return 'blocked'
  const state = asString(response.state) ?? asString(asRecord(response.actionPolicy)?.state)
  if (state === 'no_buy' || state === 'blocked' || state === 'failed' || state === 'denied') return 'blocked'
  if (state === 'unavailable' || state === 'needs_review' || state === 'limited') return 'warning'
  if (state === 'completed') return 'success'
  return 'info'
}

const titleFor = (toolName: McpToolName, response: JsonRecord) => {
  const error = asRecord(response.error)
  if (error) return `Arro blocked ${labelForTool(toolName)}`

  if (toolName === 'search_products') {
    const topItem = first(asRecords(response.items))
    return asString(topItem?.title) ?? 'Arro product search'
  }

  if (toolName === 'get_product_detail') {
    return asString(asRecord(response.product)?.title) ?? 'Arro product detail'
  }

  if (toolName === 'compare_products') {
    const strongest = asRecords(response.assessments).find((assessment) =>
      assessment.comparisonState === 'stronger'
    )
    return asString(strongest?.title) ?? 'Arro product comparison'
  }

  if (toolName === 'sanity_check_product') {
    return `Arro sanity check: ${asString(response.state) ?? 'reviewed'}`
  }

  if (toolName === 'get_source_state') {
    return `Arro source state: ${asString(response.state) ?? 'unknown'}`
  }

  return labelForTool(toolName)
}

const subtitleFor = (toolName: McpToolName, response: JsonRecord) => {
  if (asRecord(response.error)) return asString(asRecord(response.error)?.message)
  if (toolName === 'search_products') {
    const count = asRecords(response.items).length
    const sourceMode = asString(response.sourceMode)
    return `${count} source-labeled result${count === 1 ? '' : 's'}${sourceMode ? ` from ${sourceMode}` : ''}.`
  }

  const firstMessage = first(messageTexts(response))
  return firstMessage
}

const factsFor = (toolName: McpToolName, response: JsonRecord): McpPresentation['facts'] => {
  if (toolName === 'search_products') {
    return productFacts(first(asRecords(response.items))).slice(0, 6)
  }

  if (toolName === 'get_product_detail') {
    const product = asRecord(response.product)
    const facts = productFacts(product)
    addFact(facts, 'Media', asRecords(product?.media).length)
    addFact(facts, 'Variants', asRecords(product?.variants).length)
    return facts.slice(0, 8)
  }

  if (toolName === 'compare_products') {
    const facts: McpPresentation['facts'] = []
    for (const assessment of asRecords(response.assessments).slice(0, 3)) {
      addFact(
        facts,
        asString(assessment.comparisonState) ?? 'Option',
        [
          asString(assessment.title),
          formatMoney(assessment.price),
          asString(assessment.availability)
        ].filter(Boolean).join(' | '),
        asString(asRecord(assessment.sourceLabel)?.sourceId)
      )
    }
    return facts
  }

  if (toolName === 'sanity_check_product') {
    const facts: McpPresentation['facts'] = []
    const evidence = asRecord(response.evidence)
    addFact(facts, 'State', response.state)
    addFact(facts, 'Candidates', evidence?.candidateCount)
    addFact(facts, 'Source labels', evidence?.sourceLabelCount)
    addFact(facts, 'Identifiers', evidence?.identifierCount)
    return facts
  }

  if (toolName === 'get_source_state') {
    const facts: McpPresentation['facts'] = []
    addFact(facts, 'State', response.state)
    addFact(facts, 'Source mode', response.sourceMode)
    addFact(facts, 'Matched sources', asRecords(response.sources).length)
    return facts
  }

  return []
}

const authorityLimitsFor = (
  toolName: McpToolName,
  response: JsonRecord,
  sourceLabels: McpPresentation['sourceLabels']
) => {
  const limits: string[] = []
  const actionPolicy = asRecord(response.actionPolicy)
  const policyState = asString(actionPolicy?.state)
  if (policyState) limits.push(`ActionPolicy state: ${policyState}.`)

  if (response.sourceMode === 'connected_sources' || sourceLabels.some((label) => label.bindingStatus === 'advisory')) {
    limits.push('Connected or advisory facts do not create merchant, checkout, payment, or source authority.')
  }

  if (toolName !== 'confirm_purchase' && !actionsFromPolicy(response).some((action) => action.action === 'confirm_purchase')) {
    limits.push('Checkout completion is not authorized by this result.')
  }

  return dedupe(limits, (limit) => limit).slice(0, 8)
}

export const buildMcpPresentation = ({
  toolName,
  httpStatus,
  response
}: {
  toolName: McpToolName
  httpStatus: number
  response: unknown
}): McpPresentation => {
  const responseRecord = asRecord(response) ?? {}
  const sourceLabels = sourceLabelsFromResponse(responseRecord)
  const allowedNextActions = actionsFromPolicy(responseRecord)
  const product = asRecord(responseRecord.product) ?? first(asRecords(responseRecord.items))
  const primaryAction =
    checkoutActionFrom(responseRecord) ??
    handoffActionFrom(product) ??
    first(allowedNextActions)
  const receipt = asRecord(responseRecord.receipt)
  const subtitle = subtitleFor(toolName, responseRecord)

  return {
    presentationVersion: 'arro-mcp-presentation/v0.1',
    surfaceHint: 'commerce_card',
    title: titleFor(toolName, responseRecord),
    ...(subtitle ? { subtitle } : {}),
    status: asString(responseRecord.state) ?? asString(responseRecord.status) ?? String(httpStatus),
    tone: toneFor(toolName, httpStatus, responseRecord),
    facts: factsFor(toolName, responseRecord),
    sourceLabels,
    warnings: warningTexts(responseRecord),
    authorityLimits: authorityLimitsFor(toolName, responseRecord, sourceLabels),
    allowedNextActions,
    ...(primaryAction ? { primaryAction } : {}),
    ...(asString(receipt?.receiptId) ? { receiptId: asString(receipt?.receiptId)! } : {}),
    ...(toolName === 'prepare_purchase' ||
      toolName === 'update_purchase' ||
      toolName === 'confirm_purchase' ||
      toolName === 'get_purchase' ||
      toolName === 'cancel_purchase'
      ? { checkoutState: asString(responseRecord.checkoutStatus) ?? asString(responseRecord.state) ?? 'unknown' }
      : {})
  }
}

const line = (label: string, value: string) => `- ${label}: ${value}`

export const renderMcpPresentationText = ({
  presentation,
  requestId
}: {
  presentation: McpPresentation
  requestId: string
}) => {
  const lines = [
    `Arro: ${presentation.title}`,
    presentation.subtitle ? presentation.subtitle : undefined,
    line('Status', presentation.status),
    line('Request ID', requestId)
  ].filter((value): value is string => Boolean(value))

  if (presentation.facts.length > 0) {
    lines.push('', 'Facts:')
    for (const fact of presentation.facts.slice(0, 6)) {
      lines.push(line(fact.label, fact.value))
    }
  }

  if (presentation.sourceLabels.length > 0) {
    lines.push('', 'Sources:')
    for (const source of presentation.sourceLabels.slice(0, 4)) {
      const freshness = [
        source.freshnessClass,
        source.bindingStatus,
        source.expiresAt ? `expires ${source.expiresAt}` : undefined
      ].filter(Boolean).join(', ')
      lines.push(line(source.sourceName, `${source.factType}${freshness ? ` (${freshness})` : ''}`))
    }
  }

  if (presentation.warnings.length > 0) {
    lines.push('', 'Warnings:')
    for (const warning of presentation.warnings.slice(0, 4)) lines.push(`- ${warning}`)
  }

  if (presentation.authorityLimits.length > 0) {
    lines.push('', 'Authority:')
    for (const limit of presentation.authorityLimits.slice(0, 4)) lines.push(`- ${limit}`)
  }

  if (presentation.allowedNextActions.length > 0) {
    lines.push('', 'Allowed next actions:')
    for (const action of presentation.allowedNextActions.slice(0, 4)) {
      lines.push(line(action.label, `${action.action}${action.authority ? ` (${action.authority})` : ''}`))
    }
  }

  if (presentation.primaryAction) {
    const actionParts = [
      `${presentation.primaryAction.action}${presentation.primaryAction.authority ? ` (authority: ${presentation.primaryAction.authority})` : ''}`,
      presentation.primaryAction.url
    ].filter(Boolean).join(' | ')
    lines.push('', 'Primary action:')
    lines.push(line(presentation.primaryAction.label, actionParts))
    if (presentation.primaryAction.reason) lines.push(line('Why', presentation.primaryAction.reason))
  }

  if (presentation.receiptId) lines.push('', line('DecisionReceipt', presentation.receiptId))
  if (presentation.checkoutState) lines.push(line('Checkout', presentation.checkoutState))

  return lines.join('\n')
}
