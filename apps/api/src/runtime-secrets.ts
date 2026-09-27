import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const maximumSecretFileBytes = 65_536

export class RuntimeSecretConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeSecretConfigError'
  }
}

const resolvedSecretPath = (configuredPath: string) =>
  isAbsolute(configuredPath) ? configuredPath : resolve(repoRoot, configuredPath)

export const readRuntimeSecretFile = (
  configuredPath: string,
  fieldName: string,
  maximumBytes = maximumSecretFileBytes
) => {
  const path = resolvedSecretPath(configuredPath)

  try {
    const fileStats = statSync(path)
    if (!fileStats.isFile() || fileStats.size < 1 || fileStats.size > maximumBytes) {
      throw new Error('not a bounded regular file')
    }

    const value = readFileSync(path, 'utf8').trim()
    if (!value || value.includes('\n') || value.includes('\r')) {
      throw new Error('not one non-empty line')
    }
    return value
  } catch {
    throw new RuntimeSecretConfigError(
      `${fieldName} must point to a readable, non-empty, single-line secret file no larger than ${maximumBytes} bytes.`
    )
  }
}

export const resolveFileBackedSecret = (
  env: NodeJS.ProcessEnv,
  valueName: string,
  fileName = `${valueName}_FILE`,
  maximumBytes = maximumSecretFileBytes
) => {
  const inlineValue = env[valueName]?.trim()
  const configuredPath = env[fileName]?.trim()

  if (inlineValue && configuredPath) {
    throw new RuntimeSecretConfigError(
      `Configure only one of ${valueName} or ${fileName}.`
    )
  }

  return configuredPath
    ? readRuntimeSecretFile(configuredPath, fileName, maximumBytes)
    : inlineValue || undefined
}

export const resolveDatabaseUrlFromEnv = (env: NodeJS.ProcessEnv = process.env) =>
  resolveFileBackedSecret(env, 'DATABASE_URL', 'DATABASE_URL_FILE')
