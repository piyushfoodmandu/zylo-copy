import { useCallback, useEffect, useState } from 'react'
import { Platform, Text, TextInput, View } from 'react-native'
import {
  loginAccount,
  readAuthProviders,
  registerAccount,
  signInWithIdentity,
  type AuthProviders
} from '../api/client'
import { OauthCancelled, providerConfigured, requestIdentityToken, type IdentityProvider } from '../lib/oauth'
import { shopperErrorText } from '../lib/shopper-copy'
import { color } from '../lib/theme'
import { useAccountStore } from '../store/useAccountStore'
import { BrandMark } from './BrandMark'
import { Icon } from './Icon'
import { Heading } from './semantic'
import { Button, Notice } from './ui'

type Mode = 'signin' | 'register'

/**
 * Signing in is optional and the copy says so. Arro works without an account;
 * what an account buys is a cart and a saved list that follow you to another
 * device, which is the only promise this form is allowed to make.
 *
 * The password field is a real password field — `secureTextEntry`, and on web
 * the autocomplete hints browsers and password managers need to offer to store
 * and fill it. Getting those wrong is how a sign-in form quietly trains people
 * to reuse a weak password.
 */
export function AuthPanel({ onSignedIn }: { onSignedIn?: () => void } = {}) {
  const signIn = useAccountStore((state) => state.signIn)
  /**
   * A device that has never held an account is looking at this panel because it
   * wants one. Defaulting to "Sign in" sent every first-time visitor into a
   * credential check that could only fail, and "we could not sign you in" reads
   * as a broken feature rather than "you do not have an account yet".
   */
  const seenAccount = useAccountStore((state) => Boolean(state.account))
  const [mode, setMode] = useState<Mode>(seenAccount ? 'signin' : 'register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [unknownAccount, setUnknownAccount] = useState(false)
  const [pendingProvider, setPendingProvider] = useState<IdentityProvider>()
  const [providers, setProviders] = useState<AuthProviders>()
  const [emailOpen, setEmailOpen] = useState(false)
  const [error, setError] = useState<string>()

  // Both sides have to agree a provider is live: the API holds the client IDs
  // it will verify against, the bundle holds the ones it can prompt with.
  useEffect(() => {
    let active = true
    void readAuthProviders()
      .then((value) => { if (active) setProviders(value) })
      .catch(() => { if (active) setProviders({ password: true, google: false, apple: false }) })
    return () => { active = false }
  }, [])

  const continueWith = useCallback(async (provider: IdentityProvider) => {
    if (pendingProvider) return
    // The button is always offered, so pressing one that has no key yet has to
    // explain itself rather than throw an OAuth error the shopper cannot read.
    if (!providerConfigured(provider) || !providers?.[provider]) {
      setError(`${provider === 'google' ? 'Google' : 'Apple'} sign-in is not switched on yet. Use your email for now.`)
      return
    }
    setPendingProvider(provider)
    setError(undefined)
    try {
      const idToken = await requestIdentityToken(provider)
      const { account, session } = await signInWithIdentity(provider, idToken)
      signIn(account, session)
      onSignedIn?.()
    } catch (caught) {
      if (!(caught instanceof OauthCancelled)) {
        setError(shopperErrorText(caught, `We could not finish signing in with ${provider}.`))
      }
    } finally {
      setPendingProvider(undefined)
    }
  }, [onSignedIn, pendingProvider, providers, signIn])

  const submit = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    setUnknownAccount(false)
    try {
      const { account, session } = mode === 'register'
        ? await registerAccount({ email, password })
        : await loginAccount({ email, password })
      signIn(account, session)
      onSignedIn?.()
      setPassword('')
    } catch (caught) {
      const code = (caught as { code?: string })?.code
      if (mode === 'signin' && code === 'account_credentials_invalid') {
        // The overwhelmingly likely cause is that no account exists yet, and the
        // recovery is one tap rather than a second guess at the password.
        setUnknownAccount(true)
        setError('That email and password do not match an account yet.')
      } else {
        setError(shopperErrorText(caught, mode === 'register'
          ? 'We could not create that account.'
          : 'We could not sign you in.'))
      }
    } finally {
      setBusy(false)
    }
  }, [busy, email, mode, password, signIn])

  const webPassword = Platform.OS === 'web'
    ? { autoComplete: mode === 'register' ? 'new-password' as const : 'current-password' as const }
    : {}

  return (
    // No card inside a card: the dialog already draws the surface, and the
    // second border made a simple form look like a settings screen.
    <View>
      {/* Both providers always show. Hiding a sign-in route until a key exists
          made the panel look like it offered nothing but a password box, and a
          shopper cannot tell a missing feature from a broken one. Pressing an
          unconfigured one says so plainly instead of failing silently. */}
      <View className="gap-2.5">
        <Button
          fullWidth
          size="lg"
          variant="outline"
          leading={<BrandMark name="google" size={18} />}
          loading={pendingProvider === 'google'}
          onPress={() => void continueWith('google')}
        >
          Continue with Google
        </Button>
        <Button
          fullWidth
          size="lg"
          variant="primary"
          leading={<BrandMark name="apple" size={18} />}
          loading={pendingProvider === 'apple'}
          onPress={() => void continueWith('apple')}
        >
          Continue with Apple
        </Button>

        <View className="my-1 flex-row items-center gap-3">
          <View className="h-px flex-1 bg-line" />
          <Text className="text-[12px] leading-4 text-ink-400">or</Text>
          <View className="h-px flex-1 bg-line" />
        </View>

        {/* Email is a route, not the default. Opening on two text fields asks
            for typing before anyone chose to type. */}
        {emailOpen ? null : (
          <Button fullWidth size="lg" variant="secondary" onPress={() => setEmailOpen(true)}>
            Continue with email
          </Button>
        )}
      </View>

      <View className={emailOpen ? 'mt-4 gap-3' : 'hidden'}>
        <View className="gap-1.5">
          <Text className="text-[13px] font-medium leading-[18px] text-ink-600">Email</Text>
          <TextInput
            value={email}
            onChangeText={(value) => { setEmail(value); setError(undefined) }}
            accessibilityLabel="Email"
            placeholder="you@example.com"
            placeholderTextColor={color.ink400}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            textContentType="emailAddress"
            {...(Platform.OS === 'web' ? { autoComplete: 'email' as const } : {})}
            className="min-h-11 rounded-xl border border-line bg-white px-3.5 text-[15px] text-ink-950"
          />
        </View>

        <View className="gap-1.5">
          <Text className="text-[13px] font-medium leading-[18px] text-ink-600">Password</Text>
          <TextInput
            value={password}
            onChangeText={(value) => { setPassword(value); setError(undefined) }}
            onSubmitEditing={() => void submit()}
            accessibilityLabel="Password"
            placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'}
            placeholderTextColor={color.ink400}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType={mode === 'register' ? 'done' : 'go'}
            textContentType={mode === 'register' ? 'newPassword' : 'password'}
            {...webPassword}
            className="min-h-11 rounded-xl border border-line bg-white px-3.5 text-[15px] text-ink-950"
          />
        </View>

        {error ? (
          <View className="gap-2.5">
            <Notice tone="danger" icon="alert">{error}</Notice>
            {unknownAccount ? (
              <Button
                variant="outline"
                icon="person"
                onPress={() => { setMode('register'); setError(undefined); setUnknownAccount(false) }}
              >
                {`Create an account for ${email.trim() || 'this email'}`}
              </Button>
            ) : null}
          </View>
        ) : null}

        <View className="flex-row flex-wrap items-center gap-3">
          <Button variant="accent" loading={busy} icon="lock" onPress={() => void submit()}>
            {mode === 'register' ? 'Create account' : 'Sign in'}
          </Button>
          <Button
            variant="ghost"
            onPress={() => {
              setMode(mode === 'register' ? 'signin' : 'register')
              setError(undefined)
              setUnknownAccount(false)
            }}
          >
            {mode === 'register' ? 'I already have an account' : 'Create an account'}
          </Button>
        </View>

      </View>

      {/* Outside the email block: it is true of every way in, not just this one. */}
      <Text className="mt-5 text-center text-[12px] leading-[17px] text-ink-400">
        Arro stores no card details. Every order is placed by the shop that sells the item.
      </Text>
    </View>
  )
}
