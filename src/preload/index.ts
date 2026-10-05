import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { JournalEntry, EntrySummary, MemoryMatch, PatternsSnapshot, Settings, ModelStatus, DownloadProgress, Letter, LetterSummary, LetterTimeframe, LetterFillProgress, LetterFillResult } from '../shared/types'

const api = {
  listPatterns: (): Promise<PatternsSnapshot> => ipcRenderer.invoke('patterns:list'),
  refreshPatterns: (): Promise<void> => ipcRenderer.invoke('patterns:refresh'),
  dismissPattern: (id: string): Promise<PatternsSnapshot> => ipcRenderer.invoke('patterns:dismiss', id),
  saveEntry: (text: string): Promise<JournalEntry> => ipcRenderer.invoke('entries:save', text),
  listEntries: (): Promise<EntrySummary[]> => ipcRenderer.invoke('entries:list'),
  getEntry: (id: string): Promise<JournalEntry | null> => ipcRenderer.invoke('entries:get', id),
  deleteEntry: (id: string): Promise<void> => ipcRenderer.invoke('entries:delete', id),
  regenerateReflection: (id: string): Promise<JournalEntry | null> =>
    ipcRenderer.invoke('entries:regenerateReflection', id),
  onReflection: (callback: (payload: { id: string; reflection: string }) => void): (() => void) => {
    const listener = (_event: unknown, payload: { id: string; reflection: string }): void =>
      callback(payload)
    ipcRenderer.on('entries:reflection', listener)
    return () => ipcRenderer.removeListener('entries:reflection', listener)
  },
  getMemories: (id: string): Promise<MemoryMatch[]> => ipcRenderer.invoke('entries:memories', id),
  rebuildMemory: (): Promise<{ indexed: number; failed: number }> => ipcRenderer.invoke('memory:rebuild'),
  onResurfaced: (callback: (payload: { id: string; matches: MemoryMatch[] }) => void): (() => void) => {
    const listener = (_event: unknown, payload: { id: string; matches: MemoryMatch[] }): void => callback(payload)
    ipcRenderer.on('entries:resurfaced', listener)
    return () => ipcRenderer.removeListener('entries:resurfaced', listener)
  },
  getTheme: (): Promise<string | null> => ipcRenderer.invoke('entries:theme'),
  getRecap: (): Promise<string | null> => ipcRenderer.invoke('entries:recap'),
  importEntries: (): Promise<{ imported: number; failed: number }> => ipcRenderer.invoke('entries:import-files'),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:update', patch),
  getSpellDictionary: (): Promise<{ aff: string; dic: string } | null> =>
    ipcRenderer.invoke('spellcheck:dictionary'),
  getModelStatus: (): Promise<ModelStatus> => ipcRenderer.invoke('models:status'),
  downloadModels: (): Promise<void> => ipcRenderer.invoke('models:download'),
  chooseModelsDir: (): Promise<ModelStatus | null> => ipcRenderer.invoke('models:choose-dir'),
  resetModelsDir: (): Promise<ModelStatus> => ipcRenderer.invoke('models:reset-dir'),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: DownloadProgress): void => callback(progress)
    ipcRenderer.on('models:download-progress', listener)
    return () => ipcRenderer.removeListener('models:download-progress', listener)
  },
  generateLetter: (
    timeframe: LetterTimeframe,
    periodLabel: string,
    periodStart: string,
    periodEnd: string
  ): Promise<Letter | null> =>
    ipcRenderer.invoke('letters:generate', timeframe, periodLabel, periodStart, periodEnd),
  nextLetterPeriod: (
    timeframe: LetterTimeframe
  ): Promise<{ label: string; start: string; end: string } | null> =>
    ipcRenderer.invoke('letters:next-period', timeframe),
  fillMissingLetters: (): Promise<LetterFillResult> => ipcRenderer.invoke('letters:fill-missing'),
  onLetterWritten: (callback: (letter: LetterSummary) => void): (() => void) => {
    const listener = (_event: unknown, letter: LetterSummary): void => callback(letter)
    ipcRenderer.on('letters:written', listener)
    return () => ipcRenderer.removeListener('letters:written', listener)
  },
  onLetterFillProgress: (callback: (progress: LetterFillProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: LetterFillProgress): void => callback(progress)
    ipcRenderer.on('letters:fill-progress', listener)
    return () => ipcRenderer.removeListener('letters:fill-progress', listener)
  },
  listLetters: (timeframe?: LetterTimeframe): Promise<LetterSummary[]> =>
    ipcRenderer.invoke('letters:list', timeframe),
  regenerateLetter: (id: string): Promise<Letter | null> => ipcRenderer.invoke('letters:regenerate', id),
  getLetter: (id: string): Promise<Letter | null> => ipcRenderer.invoke('letters:get', id),
  deleteLetter: (id: string): Promise<void> => ipcRenderer.invoke('letters:delete', id)
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
