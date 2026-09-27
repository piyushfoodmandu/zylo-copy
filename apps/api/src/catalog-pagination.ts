const cursorPrefix = 'arro_c1.'
const maxCursorBytes = 6144
const maxSourceIdLength = 256
const maxSourceCursorLength = 4096

type CatalogContinuationPayload = {
  v: 1
  s: string
  c: string
}

export type CatalogContinuation = {
  sourceId: string
  sourceCursor: string
}

const isValidContinuation = (value: unknown): value is CatalogContinuationPayload => {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return payload.v === 1 &&
    typeof payload.s === 'string' && payload.s.length > 0 && payload.s.length <= maxSourceIdLength &&
    typeof payload.c === 'string' && payload.c.length > 0 && payload.c.length <= maxSourceCursorLength
}

export const encodeCatalogContinuation = ({
  sourceId,
  sourceCursor
}: CatalogContinuation): string => {
  if (!sourceId || sourceId.length > maxSourceIdLength) {
    throw new Error('catalog_pagination_source_invalid')
  }
  if (!sourceCursor || sourceCursor.length > maxSourceCursorLength) {
    throw new Error('catalog_pagination_source_cursor_invalid')
  }

  const encoded = Buffer.from(JSON.stringify({
    v: 1,
    s: sourceId,
    c: sourceCursor
  } satisfies CatalogContinuationPayload), 'utf8').toString('base64url')

  const cursor = `${cursorPrefix}${encoded}`
  if (Buffer.byteLength(cursor, 'utf8') > maxCursorBytes) {
    throw new Error('catalog_pagination_cursor_too_large')
  }
  return cursor
}

export const decodeCatalogContinuation = (cursor: string): CatalogContinuation => {
  if (!cursor.startsWith(cursorPrefix) || Buffer.byteLength(cursor, 'utf8') > maxCursorBytes) {
    throw new Error('catalog_pagination_cursor_invalid')
  }

  try {
    const decoded = Buffer.from(cursor.slice(cursorPrefix.length), 'base64url').toString('utf8')
    const payload = JSON.parse(decoded) as unknown
    if (!isValidContinuation(payload)) throw new Error('invalid')
    return { sourceId: payload.s, sourceCursor: payload.c }
  } catch {
    throw new Error('catalog_pagination_cursor_invalid')
  }
}
