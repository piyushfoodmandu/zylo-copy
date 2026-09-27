import { useEffect } from 'react'
import { Platform } from 'react-native'

/**
 * `generateMetadata` runs on the server, so the title is right on a cold load
 * and then frozen for the rest of the session. Every client-side navigation
 * afterwards leaves the tab, the history entry and the screen-reader page
 * announcement describing the page the visitor left.
 *
 * This only writes the title, never the rest of the head: canonical links,
 * robots directives and structured data are the server's business, and nothing
 * a crawler reads should depend on a client effect having run.
 */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !title) return
    if (document.title === title) return
    document.title = title
  }, [title])
}
