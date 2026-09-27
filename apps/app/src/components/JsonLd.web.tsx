import { createElement } from 'react'

/**
 * React Native has no `<script>`, but the web renderer is react-dom, so the tag
 * can be created directly. Keeping it in the route output also preserves it in
 * Expo's streaming SSR response, before a crawler executes any JavaScript.
 */
export const JsonLd = ({ data }: { data: unknown }) => createElement('script', {
  type: 'application/ld+json',
  dangerouslySetInnerHTML: { __html: JSON.stringify(data).replace(/</g, '\\u003c') }
})
