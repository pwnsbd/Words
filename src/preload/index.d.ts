import { ElectronAPI } from '@electron-toolkit/preload'
import type { WordsApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: WordsApi
  }
}
