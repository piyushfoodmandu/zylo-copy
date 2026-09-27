import { createElement } from 'react'
import { cssEase } from '../lib/motion'

/**
 * A handful of things the browser does natively and React Native styling has no
 * vocabulary for: keyframes, hover, focus rings, scroll snapping, scrollbar
 * suppression, off-screen render skipping, and the reduced-motion override that
 * has to win over every animation on the page.
 *
 * These are declarations, not an escape hatch for layout. Anything expressible
 * as a Tailwind class stays one, so a single composition still renders on both
 * platforms.
 */
const sheet = `
:root { --arro-ease: ${cssEase}; }

/* A light sweep across the placeholder tint, composited by the browser. A full
   grid of skeletons therefore costs no main-thread work at all. */
@keyframes arro-shimmer {
  from { background-position: 150% 0; }
  to { background-position: -50% 0; }
}

.arro-shimmer {
  background-image: linear-gradient(90deg, transparent 18%, rgba(255,255,255,0.78) 50%, transparent 82%);
  background-size: 200% 100%;
  background-repeat: no-repeat;
  animation: arro-shimmer 1.5s linear infinite;
}

/* One soft brand wash behind the hero. Native renders a clean white hero; the
   web gets the depth, because a gradient is one declaration here and a whole
   dependency there. */
.arro-hero {
  background:
    radial-gradient(90% 120% at 8% -20%, var(--color-arro-50) 0%, transparent 55%),
    radial-gradient(70% 90% at 100% 0%, var(--color-fill-soft) 0%, transparent 60%);
}

/* Elevation for the two surfaces that should feel like objects: the search
   field and anything floating over content. */
.arro-raise { box-shadow: 0 1px 2px rgba(11,10,18,0.04), 0 12px 32px -20px rgba(11,10,18,0.28); }

/* Hover is a desktop affordance. Scoping it to a fine, hover-capable pointer
   stops a touch device from latching the lifted state after a tap. */
@media (hover: hover) and (pointer: fine) {
  /* A product card does not jump, tilt or cast a shadow on hover. The image
     settles closer and the title picks up a rule — enough to say "this is the
     one you are pointing at" without the grid rearranging itself under the
     cursor. A shadow on a borderless tile just makes it look detached. */
  .arro-product img { transition: transform 420ms var(--arro-ease); }
  .arro-product:hover img { transform: scale(1.035); }
  .arro-product:hover h2 { text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }

  /* Bordered tiles answer with their edge, not their position. */
  .arro-card { transition: border-color 160ms var(--arro-ease), background-color 160ms var(--arro-ease); }
  .arro-card:hover { border-color: var(--color-line-strong); }

  .arro-underline {
    background-image: linear-gradient(currentColor, currentColor);
    background-size: 0 1.5px;
    background-position: 0 100%;
    background-repeat: no-repeat;
    transition: background-size 200ms var(--arro-ease);
  }
  .arro-underline:hover { background-size: 100% 1.5px; }
}

/* A filter column that stays put while its results scroll past. */
.arro-sticky { position: sticky; top: 16px; align-self: flex-start; }

/* Rails scroll by swipe, arrow button or keyboard. Once a rail has a visible
   position indicator, the scrollbar is only noise.

   Snapping is declared on the scrolling element and alignment on the cells.
   Putting scroll-snap-type on the content wrapper instead is inert, because
   the wrapper is not the thing that scrolls. */
.arro-rail { scrollbar-width: none; -ms-overflow-style: none; overscroll-behavior-x: contain; }
.arro-rail::-webkit-scrollbar { display: none; }
.arro-snap { scroll-snap-type: x mandatory; }
.arro-snap-items > * { scroll-snap-align: start; }

/* Skips layout and paint for a section until it approaches the viewport. It is
   deliberately rare: content-visibility also removes the section from rendered
   text extraction, so it belongs only on device-local content no crawler or
   answer engine should be quoting anyway. */
.arro-defer { content-visibility: auto; contain-intrinsic-size: auto 420px; }

/* React Native Web strips the browser's focus ring, which silently makes the
   whole app keyboard-hostile. This puts it back for keyboard users only. */
:focus-visible {
  outline: 2px solid var(--color-arro-600);
  outline-offset: 2px;
}

/* The ring has to follow the control it is on. A blanket 4px radius drew a
   near-rectangular box around a pill-shaped search field, which reads as a
   rendering fault rather than a focus state. Inheriting the element's own
   radius makes the ring the shape of the thing it is marking. */
:focus-visible { border-radius: inherit; }

/* A text field's ring belongs on the field, not on the input inside it: the
   input is a transparent box inset from the rounded border, so a ring around it
   is a rectangle floating inside a pill. */
.arro-field input:focus-visible, .arro-field textarea:focus-visible { outline: none; }
.arro-field:focus-within {
  outline: 2px solid var(--color-arro-600);
  outline-offset: 2px;
  border-radius: 9999px;
}
::selection { background: var(--color-arro-100); color: var(--color-ink-950); }

html { scroll-behavior: smooth; }

/* Wins over everything above. Someone who asked their operating system for less
   motion gets a still page, not a politely shortened animation. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`

export const WebStyles = () => createElement('style', { dangerouslySetInnerHTML: { __html: sheet } })
