/** Keyboard-only escape from repeated site navigation. */
export const SkipLink = () => (
  <a
    href="#main-content"
    className="absolute left-4 top-2 z-[100] -translate-y-16 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-white focus:translate-y-0"
  >
    Skip to main content
  </a>
)
