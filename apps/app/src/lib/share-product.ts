import { Share } from 'react-native'
import { canonical } from './seo'

export type ShareProductResult = 'shared' | 'copied' | 'cancelled'

export const shareProduct = async ({ title, path }: { title: string; path: string }): Promise<ShareProductResult> => {
  const url = canonical(path)
  const result = await Share.share({ title, url, message: `${title}\n${url}` })
  return result.action === Share.dismissedAction ? 'cancelled' : 'shared'
}
