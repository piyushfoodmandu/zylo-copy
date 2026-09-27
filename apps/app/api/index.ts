const path = require('node:path') as typeof import('node:path')
const { createRequestHandler } = require('expo-server/adapter/vercel') as typeof import('expo-server/adapter/vercel')

module.exports = createRequestHandler({
  build: path.join(__dirname, '../dist/server')
})
