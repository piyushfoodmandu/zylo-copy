import { buildConfig, validateRuntimeConfig } from './config.ts'

const validationEnv = {
  ...process.env,
  NODE_ENV: 'production'
}
const runtimeConfig = buildConfig(validationEnv)
const failures = validateRuntimeConfig(runtimeConfig, validationEnv)

if (process.env.NODE_ENV?.trim() !== 'production') {
  failures.unshift('NODE_ENV must be production for production connector validation.')
}

if (failures.length > 0) {
  console.error('Production configuration verification failed.')
  for (const failure of failures) console.error(`- ${failure}`)
  console.error('Set the public HTTPS API identity and production service env, keep connector/payment secrets in referenced env vars, run migrations, then start the live API.')
  process.exitCode = 1
} else {
  console.log('Production configuration verification passed.')
  console.log(`Catalog adapter descriptors: ${runtimeConfig.catalogAdapterCount}`)
  console.log(`Platform profile URL: ${runtimeConfig.platformProfileUrl}`)
  console.log('Secrets were validated by presence only and were not printed.')
}
