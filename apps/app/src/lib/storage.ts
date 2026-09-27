import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Guest shopping state — the cart, the saved list, recently viewed — belongs to
 * the device until someone explicitly signs in or hands it off. It is never
 * silently synced to a server, which is the rule the product scope sets for
 * no-account state.
 */
export const deviceStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key)
}
