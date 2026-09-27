import type {
  AgentActionPolicy,
  CatalogProductSanityCheckCandidateAssessment,
  CatalogProductSanityCheckRequest,
  CatalogProductSanityCheckResponse,
  CatalogProductSanityCheckState,
  CatalogProductSearchInput,
  PlainStatusMessage
} from '@arro/contracts'

type ProductSanityCheckOptions = {
  requestId: string
  correlationId: string
  now?: Date
}

const message = (
  severity: PlainStatusMessage['severity'],
  code: string,
  text: string,
  nextAction?: string
): PlainStatusMessage => ({
  severity,
  code,
  text,
  ...(nextAction ? { nextAction } : {})
})

const parseSubmittedUrl = (value: string | undefined) => {
  if (!value) return undefined

  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(value.trim())
  const protocol = match?.[1]?.toLowerCase()
  const authority = match?.[2]
  if (!protocol || !authority) return undefined

  const hostWithPort = authority.split('@').pop() ?? authority
  const bracketedHostEnd = hostWithPort.startsWith('[')
    ? hostWithPort.indexOf(']')
    : -1
  if (hostWithPort.startsWith('[') && bracketedHostEnd <= 1) return undefined

  const host = (hostWithPort.startsWith('[')
    ? hostWithPort.slice(1, bracketedHostEnd)
    : hostWithPort.split(':')[0] ?? ''
  ).toLowerCase().replace(/^www\./, '')

  if (!host || host.includes(' ') || host.includes('/')) return undefined

  return { protocol, host }
}

const hostnameFor = (value: string | undefined) => {
  return parseSubmittedUrl(value)?.host
}

const submittedUrlState = (value: string | undefined) => {
  if (!value) return { host: undefined }

  const parsedUrl = parseSubmittedUrl(value)
  if (!parsedUrl) {
    return {
      host: undefined,
      issue: message(
        'error',
        'sanity_check_submitted_url_invalid',
        'The submitted product URL is not a valid URL.',
        'Ask for a valid source-backed product or merchant URL before making a purchase decision.'
      )
    }
  }

  if (parsedUrl.protocol !== 'https') {
    return {
      host: parsedUrl.host,
      issue: message(
        'warning',
        'sanity_check_non_https_url',
        'The submitted product URL is not HTTPS, so Arro cannot treat it as a safe purchase path.',
        'Do not continue checkout from this URL; use a source-backed HTTPS merchant path instead.'
      )
    }
  }

  return {
    host: parsedUrl.host
  }
}

const hostMatches = (left: string | undefined, right: string | undefined) => {
  if (!left || !right) return false

  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

const candidateHosts = (candidate: CatalogProductSearchInput) => [
  hostnameFor(candidate.productUrl),
  hostnameFor(candidate.handoff?.url),
  hostnameFor(candidate.seller?.url),
  candidate.seller?.domain?.toLowerCase().replace(/^www\./, '')
].filter((host): host is string => Boolean(host))

const candidateMatchesIdentifier = (
  candidate: CatalogProductSearchInput,
  request: CatalogProductSanityCheckRequest
) => {
  const identifiers = request.identifiers ?? []
  if (identifiers.length === 0) return false

  const candidateValues = [
    candidate.productId,
    candidate.variantId,
    candidate.title,
    candidate.productUrl
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase())

  return identifiers.some((identifier) => {
    const value = identifier.value.toLowerCase()
    return candidateValues.some((candidateValue) => candidateValue.includes(value))
  })
}

const claimSaysNew = (request: CatalogProductSanityCheckRequest) =>
  /\b(new|brand new|sealed|unopened)\b/i.test(request.visibleClaimText ?? '')

const claimSaysOfficialOrAuthentic = (request: CatalogProductSanityCheckRequest) =>
  /\b(official|authorized|authentic|genuine|original)\b/i.test(request.visibleClaimText ?? '')

const expiredSourceLabel = (candidate: CatalogProductSearchInput, now: Date) =>
  candidate.sourceLabel.expiresAt &&
  new Date(candidate.sourceLabel.expiresAt).getTime() <= now.getTime()

const assessCandidate = ({
  candidate,
  request,
  submittedHost,
  now
}: {
  candidate: CatalogProductSearchInput
  request: CatalogProductSanityCheckRequest
  submittedHost: string | undefined
  now: Date
}): CatalogProductSanityCheckCandidateAssessment => {
  const reasons: string[] = []
  let hasConflict = false
  let hasSupport = false
  const hosts = candidateHosts(candidate)

  if (submittedHost) {
    if (hosts.some((host) => hostMatches(host, submittedHost))) {
      hasSupport = true
      reasons.push('Submitted URL host matches the source-labeled candidate host.')
    } else if (hosts.length > 0) {
      hasConflict = true
      reasons.push('Submitted URL host does not match the source-labeled candidate host.')
    }
  }

  if (candidateMatchesIdentifier(candidate, request)) {
    hasSupport = true
    reasons.push('Submitted identifier appears in the candidate product, variant, title, or URL facts.')
  }

  if (claimSaysNew(request) && candidate.condition !== 'new') {
    hasConflict = true
    reasons.push('Visible claim says the item is new, but the candidate condition is not new.')
  }

  if (candidate.availability === 'out_of_stock') {
    hasConflict = true
    reasons.push('Source-labeled candidate is out of stock.')
  }

  if (candidate.sourceLabel.bindingStatus === 'stale' || expiredSourceLabel(candidate, now)) {
    reasons.push('Candidate source label is stale or expired.')
  }

  if (candidate.sourceLabel.bindingStatus === 'missing') {
    hasConflict = true
    reasons.push('Candidate source label is missing binding status.')
  }

  if (reasons.length === 0) {
    reasons.push('Candidate is source-labeled, but the submitted evidence is not enough to confirm the claim.')
  }

  return {
    businessId: candidate.businessId,
    productId: candidate.productId,
    ...(candidate.variantId ? { variantId: candidate.variantId } : {}),
    title: candidate.title,
    matchState: hasConflict ? 'conflicts' : hasSupport ? 'supports' : 'uncertain',
    reasons,
    sourceLabel: candidate.sourceLabel
  }
}

const sanityCheckActionPolicy = (
  state: CatalogProductSanityCheckState,
  supportedCandidateCount: number
): AgentActionPolicy => {
  if (state === 'supported') {
    return {
      state: 'safer_next_action',
      allowedNextActions: [
        {
          action: 'get_product_detail',
          label: 'Revalidate product detail',
          authority: 'limited',
          requiredActionScope: 'read:product_detail',
          reason: `${supportedCandidateCount} source-labeled candidate${supportedCandidateCount === 1 ? '' : 's'} support the submitted evidence, but detail must be revalidated before checkout-adjacent work.`
        },
        {
          action: 'prepare_purchase',
          label: 'Prepare selected purchase',
          authority: 'allowed',
          requiredActionScope: 'write:purchase',
          reason: 'After a shopper selects a supported source-labeled candidate, Arro can prepare the purchase through the compact UCP runtime.'
        }
      ]
    }
  }

  if (state === 'no_buy') {
    return {
      state: 'safer_next_action',
      allowedNextActions: [
        {
          action: 'stop',
          label: 'Do not buy from this evidence',
          authority: 'allowed',
          reason: 'The submitted evidence conflicts with source-labeled facts or fails basic safety checks.'
        },
        {
          action: 'search_products',
          label: 'Find a source-backed alternative',
          authority: 'limited',
          requiredActionScope: 'read:search',
          reason: 'The safer path is to search supported sources instead of continuing from unsafe or conflicting evidence.'
        },
        {
          action: 'wait',
          label: 'Do not proceed yet',
          authority: 'allowed',
          reason: 'The submitted evidence should not be used for purchase preparation.'
        }
      ]
    }
  }

  return {
    state: state === 'unsupported_evidence' ? 'unavailable' : 'limited',
    allowedNextActions: [
      {
        action: 'search_products',
        label: 'Search supported sources',
        authority: 'limited',
        requiredActionScope: 'read:search',
        reason: 'The supplied evidence is not enough for a confident source-backed sanity check.'
      },
      {
        action: 'wait',
        label: 'Wait for stronger evidence',
        authority: 'allowed',
        reason: 'The supplied evidence is not strong enough for purchase preparation.'
      }
    ]
  }
}

export const analyzeProductSanityCheck = (
  request: CatalogProductSanityCheckRequest,
  {
    requestId,
    correlationId,
    now = new Date()
  }: ProductSanityCheckOptions
): CatalogProductSanityCheckResponse => {
  const urlState = submittedUrlState(request.submittedUrl)
  const candidates = request.candidates ?? []
  const findings: PlainStatusMessage[] = []

  if (urlState.issue) findings.push(urlState.issue)

  const hasSubmittedEvidence = Boolean(
    request.submittedUrl ||
    (request.identifiers && request.identifiers.length > 0) ||
    request.visibleClaimText ||
    candidates.length > 0
  )

  if (!hasSubmittedEvidence) {
    findings.push(message(
      'warning',
      'sanity_check_evidence_required',
      'No product evidence was supplied for sanity checking.',
      'Provide a product URL, identifier, visible claim text, or source-labeled candidate set.'
    ))
  }

  if (claimSaysOfficialOrAuthentic(request) && candidates.length === 0) {
    findings.push(message(
      'warning',
      'sanity_check_authenticity_unverified',
      'The visible claim mentions official or authentic status, but no source-labeled candidate was supplied to verify it.',
      'Use source-backed product detail or trusted merchant evidence before acting on this claim.'
    ))
  }

  const candidateAssessments = candidates.map((candidate) =>
    assessCandidate({
      candidate,
      request,
      submittedHost: urlState.host,
      now
    })
  )
  const conflictCount = candidateAssessments.filter((assessment) =>
    assessment.matchState === 'conflicts'
  ).length
  const supportCount = candidateAssessments.filter((assessment) =>
    assessment.matchState === 'supports'
  ).length
  const staleCount = candidates.filter((candidate) =>
    candidate.sourceLabel.bindingStatus === 'stale' || expiredSourceLabel(candidate, now)
  ).length

  if (conflictCount > 0) {
    findings.push(message(
      'warning',
      'sanity_check_candidate_conflict',
      'One or more source-labeled candidates conflict with the submitted evidence.',
      'Do not continue checkout from this evidence; re-run search or product detail against supported sources.'
    ))
  }

  if (staleCount > 0) {
    findings.push(message(
      'warning',
      'sanity_check_stale_source_label',
      'One or more candidate source labels are stale or expired.',
      'Refresh source-backed product detail before using this evidence for a purchase decision.'
    ))
  }

  if (candidates.length > 0 && supportCount === 0 && conflictCount === 0) {
    findings.push(message(
      'info',
      'sanity_check_candidate_uncertain',
      'The submitted evidence did not conflict with candidates, but it also did not strongly match source-labeled facts.',
      'Ask for more specific source-backed product detail before checkout-adjacent work.'
    ))
  }

  if (findings.length === 0) {
    findings.push(message(
      'info',
      'sanity_check_supported',
      'Submitted evidence is consistent with the supplied source-labeled candidate facts.',
      'Revalidate product detail before any checkout-adjacent action.'
    ))
  }

  const state: CatalogProductSanityCheckState =
    !hasSubmittedEvidence
      ? 'unsupported_evidence'
      : urlState.issue?.code === 'sanity_check_submitted_url_invalid' ||
        urlState.issue?.code === 'sanity_check_non_https_url' ||
        conflictCount > 0
        ? 'no_buy'
        : candidates.length === 0 || staleCount > 0 || supportCount === 0
          ? 'needs_review'
          : 'supported'

  return {
    requestId,
    correlationId,
    state,
    evidence: {
      hasSubmittedUrl: Boolean(request.submittedUrl),
      ...(urlState.host ? { submittedUrlHost: urlState.host } : {}),
      identifierCount: request.identifiers?.length ?? 0,
      hasVisibleClaimText: Boolean(request.visibleClaimText),
      candidateCount: candidates.length,
      sourceLabelCount: candidates.filter((candidate) => candidate.sourceLabel).length
    },
    candidateAssessments,
    findings,
    actionPolicy: sanityCheckActionPolicy(state, supportCount),
    checkedAt: now.toISOString()
  }
}
