import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Universal modules import Platform from React Native. Tests execute in a
    // Node web context, so use the same implementation the Expo web bundle does.
    alias: { 'react-native': 'react-native-web' }
  }
})
