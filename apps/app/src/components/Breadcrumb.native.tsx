export type Crumb = {
  name: string
  href?: string
}

/** Native stacks already provide the route title and back affordance. */
export function Breadcrumb(_props: { trail: Crumb[]; className?: string; hideCurrentOnCompact?: boolean }) {
  return null
}
