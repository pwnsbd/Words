// Types shared between the main process, preload bridge, and renderer.
// Kept separate from main/entries.ts so the renderer's TS project doesn't
// need to pull in main-process-only code just to know the shape of an entry.

export interface JournalEntry {
  id: string
  createdAt: string // ISO timestamp
  text: string
  isSample?: boolean
  reflection?: string
  // -2 (heavy/hard day) to 2 (light/good day). Internal only — never shown
  // to the user as a number/label, just used to draw a soft trend line.
  mood?: number
  embedding?: number[]
  memory?: MemoryEmbedding
  // Handwriting font the entry was written in. Absent on old entries,
  // imports and samples, which read in the default serif.
  font?: HandwritingFont
}

export interface MemoryEmbedding {
  modelId: string
  passages: { text: string; start: number; end: number; vector: number[] }[]
}

export interface MemoryMatch extends EntrySummary {
  start: number
  end: number
  score: number
  currentPassage: string
}

export interface EntrySummary {
  id: string
  createdAt: string
  preview: string
  isSample?: boolean
  mood?: number
}

export interface EntryEcho {
  passage: string
  count: number // how many other entries this passage returns in
}

// Grid-card text: the entry's opening with struck markup kept, plus its reflection.
export interface EntryCardText {
  id: string
  excerpt: string
  reflection?: string
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

export type HandwritingFont =
  | 'caveat' | 'gochi-hand' | 'indie-flower'
  | 'dancing-script' | 'cormorant-italic' | 'parisienne'
  | 'kalam' | 'special-elite' | 'courier-prime'

// One table for every handwriting font. `scale` multiplies the writing
// surface's base font-size so all nine read at a similar visual size. The
// first font listed for each mode is that mode's default.
export const HANDWRITING_FONTS: Record<HandwritingFont, { mode: WritingMode; family: string; scale: number; label: string }> = {
  'caveat': { mode: 'pencil', family: 'Caveat', scale: 1.25, label: 'Caveat' },
  'gochi-hand': { mode: 'pencil', family: 'Gochi Hand', scale: 1.1, label: 'Gochi Hand' },
  'indie-flower': { mode: 'pencil', family: 'Indie Flower', scale: 1.1, label: 'Indie Flower' },
  'dancing-script': { mode: 'quill', family: 'Dancing Script', scale: 1.2, label: 'Dancing Script' },
  'cormorant-italic': { mode: 'quill', family: 'Cormorant Garamond Italic', scale: 1.15, label: 'Cormorant' },
  'parisienne': { mode: 'quill', family: 'Parisienne', scale: 1.3, label: 'Parisienne' },
  'kalam': { mode: 'ink', family: 'Kalam', scale: 1.0, label: 'Kalam' },
  'special-elite': { mode: 'ink', family: 'Special Elite', scale: 0.95, label: 'Special Elite' },
  'courier-prime': { mode: 'ink', family: 'Courier Prime', scale: 0.95, label: 'Courier Prime' }
}

export const DEFAULT_HANDWRITING: Record<WritingMode, HandwritingFont> = {
  pencil: 'caveat',
  quill: 'dancing-script',
  ink: 'kalam'
}

export function isHandwritingFont(id: unknown): id is HandwritingFont {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(HANDWRITING_FONTS, id)
}

export interface Settings {
  reflectionModel: 'existing'
  embeddingModel: 'qwen'
  theme: Theme
  resurfaceSensitivity: ResurfaceSensitivity
  writingMode: WritingMode
  // The font chosen for each writing mode (Settings → Handwriting).
  handwriting: Record<WritingMode, HandwritingFont>
  quillDeleteLimit: number
  journalView: 'list' | 'grid'
  // Folder the app looks in for the two GGUF model files. null = the
  // built-in default (dev: models/ at the project root; packaged: a
  // models/ folder inside the install directory, so an uninstall removes
  // them too). Set to an absolute path when the user picks a different
  // folder from Settings → Local models — the app moves the existing files
  // there. The WORDS_MODELS_DIR env var, if set, overrides this.
  modelsDir: string | null
  // Words the user has added to the spellcheck dictionary (write surface).
  spellcheckWords: string[]
}

export interface ModelStatus {
  reflectionEnabled: boolean
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

export type LetterTimeframe = 'week' | 'month' | 'year'

export interface Letter {
  id: string
  timeframe: LetterTimeframe
  periodLabel: string   // "Week of Sep 15, 2026", "September 2026", "2026"
  periodStart: string   // ISO date
  periodEnd: string     // ISO date
  content: string
  entryCount?: number   // entries the letter was written from; absent on older letters
  createdAt: string     // ISO date
}

export interface LetterSummary {
  id: string
  timeframe: LetterTimeframe
  periodLabel: string
  periodStart: string
  entryCount?: number
  createdAt: string
}

export interface LetterFillProgress {
  done: number
  total: number
  currentLabel: string
}

export interface LetterFillResult {
  started: boolean
  written: number
  failed: number
  modelUnavailable?: boolean
}

export interface IdeaEvidence {
  entryId: string
  createdAt: string
  text: string
  start: number
  end: number
  isSample?: boolean
}
export interface IdeaPattern {
  id: string
  title: string
  description: string
  evidence: IdeaEvidence[]
}
export interface PatternsSnapshot {
  patterns: IdeaPattern[]
  updating: boolean
  message: string | null
}
