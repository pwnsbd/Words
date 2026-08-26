// Types shared between the main process, preload bridge, and renderer.
// Kept separate from main/entries.ts so the renderer's TS project doesn't
// need to pull in main-process-only code just to know the shape of an entry.

export interface JournalEntry {
  id: string
  createdAt: string // ISO timestamp
  text: string
  reflection?: string
  // -2 (heavy/hard day) to 2 (light/good day). Internal only — never shown
  // to the user as a number/label, just used to draw a soft trend line.
  mood?: number
  embedding?: number[]
}

export interface EntrySummary {
  id: string
  createdAt: string
  preview: string
  mood?: number
}

export type Theme = 'light' | 'dark'

// Friendly labels stand in for the raw cosine-similarity threshold — see
// RESURFACE_THRESHOLDS in src/main/settings.ts for the actual numbers.
export type ResurfaceSensitivity = 'rare' | 'balanced' | 'often'

// How forgiving the writing surface is about deleting what you just wrote:
//  - pencil: unlimited edits, delete works normally — for anyone who just
//    wants to write without a second thought about it.
//  - quill: a per-entry budget of real deletions (quillDeleteLimit, user
//    tunable in Settings); once it's spent, further deletes strike instead
//    of removing.
//  - ink: no real deletions at all — every delete strikes from the first
//    keystroke. Once it's down, it's down; a struck word stays visible
//    rather than disappearing.
export type WritingMode = 'pencil' | 'quill' | 'ink'

export interface Settings {
  theme: Theme
  resurfaceSensitivity: ResurfaceSensitivity
  writingMode: WritingMode
  quillDeleteLimit: number
  // Whether the one-time "download local models?" consent banner has
  // already been shown (accepted or declined either way) -- once true, it
  // never shows again; Settings → Local models still offers a manual
  // download/retry regardless.
  modelDownloadAsked: boolean
}

export interface ModelStatus {
  modelsDir: string
  reflectionModelFound: boolean
  embeddingModelFound: boolean
}

export type ModelKey = 'reflection' | 'embedding'

// Progress for one model's automatic download -- see src/main/modelDownload.ts.
export interface DownloadProgress {
  key: ModelKey
  receivedBytes: number
  totalBytes: number
  done: boolean
  error?: string
}
