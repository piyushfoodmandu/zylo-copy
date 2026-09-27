import { handleURLCallback } from '@stripe/stripe-react-native'
import * as Linking from 'expo-linking'
import { useEffect } from 'react'

export function StripeRedirectHandler() {
  useEffect(() => {
    const handle = (url: string | null) => {
      if (url) void handleURLCallback(url)
    }
    void Linking.getInitialURL().then(handle)
    const subscription = Linking.addEventListener('url', ({ url }) => handle(url))
    return () => subscription.remove()
  }, [])

  return null
}
