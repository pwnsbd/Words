// Small persisted settings file, in-memory cached after first read/write —
// the same "just a local file" philosophy as entries: no database, nothing
// fancier than the app actually needs. Synchronous fs calls are deliberate
// here: the file is tiny, and index.ts needs settings *before* creating the
// window (to pick the right background color), which is easier to express
// synchronously than threading a promise through window creation.

import { app } from 'electron'
import { join, isAbsolute } from 'path'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { HANDWRITING_FONTS, DEFAULT_HANDWRITING } from '../shared/types'
import type { Settings, ResurfaceSensitivity, WritingMode, HandwritingFont } from '../shared/types'

export type { Settings }

const DEFAULT_SETTINGS: Settings = {
  reflectionModel: 'existing',
  embeddingModel: 'qwen',
  theme: 'light',
  resurfaceSensitivity: 'balanced',
  writingMode: 'pencil',
  handwriting: { ...DEFAULT_HANDWRITING },
  quillDeleteLimit: 5,
  journalView: 'list',
  modelsDir: null,
  spellcheckWords: []
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cached: Settings | null = null

function validatedPatch(value: unknown): Partial<Settings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings')
  const patch = value as Partial<Settings>
  const result: Partial<Settings> = {}
  if (patch.theme !== undefined) {
    if (!['light', 'dark'].includes(patch.theme)) throw new Error('Invalid theme')
    result.theme = patch.theme
  }
  if (patch.resurfaceSensitivity !== undefined) {
    if (!['rare', 'balanced', 'often'].includes(patch.resurfaceSensitivity)) throw new Error('Invalid sensitivity')
    result.resurfaceSensitivity = patch.resurfaceSensitivity
  }
  if (patch.writingMode !== undefined) {
    if (!['pencil', 'quill', 'ink'].includes(patch.writingMode)) throw new Error('Invalid writing mode')
    result.writingMode = patch.writingMode
  }
  if (patch.handwriting !== undefined) {
    const hw = patch.handwriting as unknown
    if (!hw || typeof hw !== 'object' || Array.isArray(hw)) throw new Error('Invalid handwriting font')
    const next: Partial<Record<WritingMode, HandwritingFont>> = {}
    for (const [mode, id] of Object.entries(hw)) {
      const font = HANDWRITING_FONTS[id as HandwritingFont]
      if (!['pencil', 'quill', 'ink'].includes(mode) || !Object.prototype.hasOwnProperty.call(HANDWRITING_FONTS, id) || font.mode !== mode) {
        throw new Error('Invalid handwriting font')
      }
      next[mode as WritingMode] = id as HandwritingFont
    }
    result.handwriting = next as Settings['handwriting']
  }
  if (patch.quillDeleteLimit !== undefined) {
    if (!Number.isSafeInteger(patch.quillDeleteLimit) || patch.quillDeleteLimit < 0) throw new Error('Invalid deletion limit')
    result.quillDeleteLimit = patch.quillDeleteLimit
  }
  if (patch.journalView !== undefined) {
    if (!['list', 'grid'].includes(patch.journalView)) throw new Error('Invalid journal view')
    result.journalView = patch.journalView
  }
  if (patch.modelsDir !== undefined) {
    if (patch.modelsDir !== null && (typeof patch.modelsDir !== 'string' || !isAbsolute(patch.modelsDir))) throw new Error('Invalid models folder')
    result.modelsDir = patch.modelsDir
  }
  return result
}

export function getSettings(): Settings {
  if (cached) return cached
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    cached = { ...DEFAULT_SETTINGS, ...validatedPatch(JSON.parse(raw)),
      handwriting: { ...DEFAULT_HANDWRITING, ...validatedPatch(JSON.parse(raw)).handwriting },
      reflectionModel: 'existing', embeddingModel: 'qwen' }
  } catch {
    // No settings file yet, or it's unreadable — fall back to defaults.
    cached = { ...DEFAULT_SETTINGS, handwriting: { ...DEFAULT_HANDWRITING } }
  }
  return cached
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const validated = validatedPatch(patch)
  const next: Settings = { ...getSettings(), ...validated,
    handwriting: { ...getSettings().handwriting, ...validated.handwriting }, reflectionModel: 'existing', embeddingModel: 'qwen' }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsPath() + '.tmp', JSON.stringify(next, null, 2), 'utf-8')
  renameSync(settingsPath() + '.tmp', settingsPath())
  cached = next
  return next
}

// Friendly labels instead of a raw number in the settings UI. Values are
// tuned with `npm run eval:mirror` (see docs/mirror-eval.md) on a small
// synthetic set — re-run it before changing them.
const RESURFACE_THRESHOLDS: Record<ResurfaceSensitivity, number> = {
  rare: 0.74,
  balanced: 0.68,
  often: 0.61
}

export function resurfaceSimilarityThreshold(): number {
  return RESURFACE_THRESHOLDS[getSettings().resurfaceSensitivity]
}
