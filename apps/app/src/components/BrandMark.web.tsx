import { createElement } from 'react'

/**
 * Google's and Apple's own marks, not a lookalike from the icon set.
 *
 * A provider button is a promise about where the credentials go, and a compass
 * standing in for Google breaks that promise before the shopper clicks. Both
 * brands publish exact geometry and, in Google's case, exact colours — these are
 * those paths, which is also what their brand terms require.
 */
export function BrandMark({ name, size = 18, tone = '#ffffff' }: { name: 'google' | 'apple'; size?: number; tone?: string }) {
  const markup = name === 'google'
    ? '<path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 0 0 1.4 6.7l4 3.1c.9-2.8 3.5-5 6.6-5z"/>'
    : `<path fill="${tone}" d="M17.05 12.79c-.03-2.7 2.2-4 2.3-4.06-1.25-1.83-3.2-2.08-3.9-2.11-1.66-.17-3.24.98-4.08.98-.84 0-2.14-.96-3.52-.93-1.81.03-3.48 1.05-4.41 2.67-1.88 3.26-.48 8.09 1.35 10.73.9 1.29 1.96 2.74 3.35 2.69 1.35-.06 1.86-.87 3.49-.87 1.62 0 2.08.87 3.5.84 1.45-.02 2.36-1.31 3.24-2.61 1.02-1.5 1.44-2.95 1.46-3.02-.03-.02-2.8-1.07-2.83-4.26z"/><path fill="${tone}" d="M14.4 4.9c.74-.9 1.24-2.15 1.1-3.4-1.07.04-2.36.71-3.13 1.61-.69.79-1.29 2.06-1.13 3.28 1.2.09 2.42-.61 3.16-1.49z"/>`

  return createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    focusable: false,
    style: { flexShrink: 0 },
    dangerouslySetInnerHTML: { __html: markup }
  })
}
