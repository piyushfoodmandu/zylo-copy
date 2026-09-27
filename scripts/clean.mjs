#!/usr/bin/env node

import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixedTargets = [
  '.runtime',
  'apps/app/.expo',
  'apps/app/dist',
  'apps/app/src/uniwind-types.d.ts',
  'apps/api/dist',
  'packages/contracts/dist',
  'packages/product-intelligence/dist',
  'packages/ucp-client/dist',
  'services/connectors/dist'
]

await Promise.all(
  fixedTargets.map((target) =>
    rm(join(root, target), { recursive: true, force: true })
  )
)

const generatedFile = (name) =>
  name.endsWith('.tsbuildinfo') ||
  name.endsWith('.rej') ||
  name.endsWith('.orig') ||
  name === '.DS_Store'

const removeGeneratedFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries.map(async (entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await removeGeneratedFiles(path)
      return
    }
    if (generatedFile(entry.name)) await rm(path, { force: true })
  }))
}

await removeGeneratedFiles(root)
console.log('Removed generated build, Expo, runtime, and patch-conflict artifacts.')
