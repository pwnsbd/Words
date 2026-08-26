import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { JournalEntry, EntrySummary, Settings, ModelStatus, DownloadProgress } from '../shared/types'

const api = {
  saveEntry: (text: string): Promise<JournalEntry> => ipcRenderer.invoke('entries:save', text),
  listEntries: (): Promise<EntrySummary[]> => ipcRenderer.invoke('entries:list'),
  getEntry: (id: string): Promise<JournalEntry | null> => ipcRenderer.invoke('entries:get', id),
  deleteEntry: (id: string): Promise<void> => ipcRenderer.invoke('entries:delete', id),
  onReflection: (callback: (payload: { id: string; reflection: string }) => void): (() => void) => {
    const listener = (_event: unknown, payload: { id: string; reflection: string }): void =>
      callback(payload)
    ipcRenderer.on('entries:reflection', listener)
    return () => ipcRenderer.removeListener('entries:reflection', listener)
  },
  onResurfaced: (callback: (entry: EntrySummary) => void): (() => void) => {
    const listener = (_event: unknown, entry: EntrySummary): void => callback(entry)
    ipcRenderer.on('entries:resurfaced', listener)
    return () => ipcRenderer.removeListener('entries:resurfaced', listener)
  },
  getTheme: (): Promise<string | null> => ipcRenderer.invoke('entries:theme'),
  getRecap: (): Promise<string | null> => ipcRenderer.invoke('entries:recap'),
  importEntries: (): Promise<{ imported: number }> => ipcRenderer.invoke('entries:import-files'),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:update', patch),
  getModelStatus: (): Promise<ModelStatus> => ipcRenderer.invoke('models:status'),
  downloadModels: (): Promise<void> => ipcRenderer.invoke('models:download'),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: DownloadProgress): void => callback(progress)
    ipcRenderer.on('models:download-progress', listener)
    return () => ipcRenderer.removeListener('models:download-progress', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

export type WordsApi = typeof api
