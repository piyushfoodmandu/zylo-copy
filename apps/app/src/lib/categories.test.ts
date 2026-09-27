import { describe, expect, it } from 'vitest'
import { categoryForQuery, productBrowseTrail } from './categories'

describe('categoryForQuery', () => {
  it('prefers a specific child phrase over an earlier parent substring', () => {
    expect(categoryForQuery('CozyBand Wireless Headphones')?.label).toBe('Sound & TV')
  })

  it('still resolves exact top-level category queries', () => {
    expect(categoryForQuery('mobile phones')?.label).toBe('Phones')
  })

  it('uses the same specific hierarchy for visible and structured breadcrumbs', () => {
    expect(productBrowseTrail('CozyBand Wireless Headphones', ['Catalog']).map((item) => item.name))
      .toEqual(['Sound & TV', 'Headphones'])
  })
})
