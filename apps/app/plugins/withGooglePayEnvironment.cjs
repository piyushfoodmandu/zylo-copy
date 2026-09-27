const {
  AndroidConfig,
  withAndroidManifest,
  withGradleProperties
} = require('@expo/config-plugins')

const PROPERTY = 'GOOGLE_PAY_ENVIRONMENT'

/**
 * The official Google Pay React Native bridge reads its environment from an
 * Android Gradle property at build time. Reuse the backend's existing setting
 * so the native client and API always enforce the same live environment.
 */
module.exports = function withGooglePayEnvironment(config) {
  const environment = process.env[PROPERTY]?.trim().toUpperCase() || 'PRODUCTION'
  if (environment !== 'PRODUCTION') {
    throw new Error(`${PROPERTY} must be PRODUCTION. Arro native release builds do not include a sandbox payment mode.`)
  }

  // The native library consumes the Gradle property, while the JavaScript
  // dispatcher consumes the same baked value from Expo config before it will
  // accept a merchant action. Native release builds therefore cannot silently
  // present a non-production payment request.
  config.extra = {
    ...config.extra,
    googlePayEnvironment: environment
  }

  const withEnvironment = withGradleProperties(config, (next) => {
    next.modResults = next.modResults.filter(
      (entry) => entry.type !== 'property' || entry.key !== PROPERTY
    )
    next.modResults.push({ type: 'property', key: PROPERTY, value: environment })
    return next
  })

  return withAndroidManifest(withEnvironment, (next) => {
    const application = next.modResults.manifest.application?.[0]
    if (!application) throw new Error('AndroidManifest.xml is missing its application element.')
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      application,
      'com.google.android.gms.wallet.api.enabled',
      'true'
    )
    return next
  })
}
