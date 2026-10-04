// Small persisted settings file, in-memory cached after first read/write —
// the same "just a local file" philosophy as entries: no database, nothing
// fancier than the app actually needs. Synchronous fs calls are deliberate
// here: the file is tiny, and index.ts needs settings *before* creating the
// window (to pick the right background color), which is easier to express
// synchronously than threading a promise through window creation.

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { Settings, ResurfaceSensitivity } from '../shared/types'

export type { Settings }

const DEFAULT_SETTINGS: Settings = {
  reflectionModel: 'existing',
  embeddingModel: 'qwen',
  theme: 'light',
  resurfaceSensitivity: 'balanced',
  writingMode: 'pencil',
  quillDeleteLimit: 5,
  modelsDir: null
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cached: Settings | null = null

export function getSettings(): Settings {
  if (cached) return cached
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    cached = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>),
      reflectionModel: 'existing', embeddingModel: 'qwen' }
  } catch {
    // No settings file yet, or it's unreadable — fall back to defaults.
    cached = { ...DEFAULT_SETTINGS }
  }
  return cached
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings(), ...patch, reflectionModel: 'existing', embeddingModel: 'qwen' }
  cached = next
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch (err) {
    console.error('[words] failed to save settings:', err)
  }
  return next
}

// Friendly labels instead of a raw number in the settings UI. Values are a
// starting guess, not empirically tuned — adjust here if "balanced" turns
// out to feel over/under-eager in practice.
const RESURFACE_THRESHOLDS: Record<ResurfaceSensitivity, number> = {
  rare: 0.8,
  balanced: 0.68,
  often: 0.64
}

export function resurfaceSimilarityThreshold(): number {
  return RESURFACE_THRESHOLDS[getSettings().resurfaceSensitivity]
}
