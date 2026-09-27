import * as AuthSession from 'expo-auth-session'
import { Platform } from 'react-native'

export type IdentityProvider = 'google' | 'apple'

/**
 * Obtains an ID token from Google or Apple.
 *
 * Arro asks for `id_token` directly rather than an authorization code, because
 * the token is the only thing the API wants: it verifies the provider's
 * signature server-side and never needs a client secret, which is exactly what
 * a public client must not hold.
 *
 * Client IDs are public values and ship in the bundle like any other
 * `EXPO_PUBLIC_*` config. Until they are set, the provider is simply not
 * offered — the API reports the same thing from its own configuration, so the
 * button cannot appear against a server that would reject it.
 */
const clientIds: Record<IdentityProvider, string | undefined> = {
  google: Platform.select({
    web: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB,
    ios: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS,
    android: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID,
    default: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB
  }),
  apple: process.env.EXPO_PUBLIC_APPLE_CLIENT_ID
}

const discovery: Record<IdentityProvider, AuthSession.DiscoveryDocument> = {
  google: {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token'
  },
  apple: {
    authorizationEndpoint: 'https://appleid.apple.com/auth/authorize',
    tokenEndpoint: 'https://appleid.apple.com/auth/token'
  }
}

export const providerConfigured = (provider: IdentityProvider) => Boolean(clientIds[provider])

export class OauthCancelled extends Error {
  constructor() {
    super('Sign-in was cancelled.')
    this.name = 'OauthCancelled'
  }
}

export const requestIdentityToken = async (provider: IdentityProvider): Promise<string> => {
  const clientId = clientIds[provider]
  if (!clientId) throw new Error(`Sign in with ${provider} is not configured in this build.`)

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'arro' })
  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    // `id_token` alone: Arro wants identity, not access to the account.
    responseType: 'id_token',
    scopes: ['openid', 'email', 'profile'],
    // A nonce is what stops a token minted for somewhere else being replayed
    // here, and Apple requires `form_post` for the implicit flow.
    extraParams: provider === 'apple' ? { response_mode: 'form_post' } : {},
    usePKCE: false
  })

  const result = await request.promptAsync(discovery[provider])
  if (result.type === 'cancel' || result.type === 'dismiss') throw new OauthCancelled()
  if (result.type !== 'success') throw new Error(`Sign in with ${provider} did not complete.`)

  const idToken = (result.params as Record<string, string | undefined>).id_token
  if (!idToken) throw new Error('The provider did not return an identity token.')
  return idToken
}
