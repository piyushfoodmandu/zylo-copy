import type { CatalogProductGroup } from './product-groups'

/**
 * Ranked on how many people reviewed the product at its shop. It is the one
 * popularity signal the sources actually return; Arro has no click data of its
 * own and will not pretend a search seed is a trend.
 */
export const mostReviewed = (groups: CatalogProductGroup[], limit = 10) =>
  groups
    .filter((group) => (group.product.rating?.count ?? 0) >= 25 && (group.product.rating?.value ?? 0) >= 4)
    .sort((left, right) => (right.product.rating!.count) - (left.product.rating!.count))
    .slice(0, limit)

/**
 * Highest rated, with a review floor so a single five-star review cannot top
 * the list. Distinct from `mostReviewed`: one answers "what do most people
 * buy", this one answers "what do the people who bought it think".
 */
export const topRated = (groups: CatalogProductGroup[], limit = 10) =>
  groups
    .filter((group) => (group.product.rating?.count ?? 0) >= 40)
    .sort((left, right) =>
      (right.product.rating!.value - left.product.rating!.value) ||
      (right.product.rating!.count - left.product.rating!.count))
    .slice(0, limit)

/**
 * Arro deliberately ships no "top deals" rail.
 *
 * A price-comparison site can only claim a deal from one of two things: a price
 * it saw earlier, or the same product priced differently at two shops today.
 * Arro stores no price history, and this catalogue almost never returns a
 * product clustered across sellers — probing the fourteen most-reviewed
 * products returned a single seller for every one of them, and no detail at all
 * for eight. A rail built on that renders zero or one product and reads as
 * broken, and inventing a discount percentage would be a claim about a past
 * price that no source backs.
 *
 * Where a spread does exist it is shown exactly where it is true: the product
 * page lists every shop's offer, and a search result carrying more than one
 * shop says so on the card.
 */
