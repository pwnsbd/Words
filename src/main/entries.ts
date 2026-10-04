// Plain-file storage for journal entries: one JSON file per entry in the
// app's local data folder. No database for v1 — entries are just files the
// user owns, which is both simpler to build and true to the product's
// local-first philosophy. This module only knows how to read/write entries;
// it never calls a model (see llamacpp.ts) and never decides *when* to.

import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import type { JournalEntry, EntrySummary } from '../shared/types'


import { stripStruckMarkup } from '../shared/textMarkup'

export type { JournalEntry, EntrySummary }

function entriesDir(): string {
  return join(app.getPath('userData'), 'entries')
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(entriesDir(), { recursive: true })
}

function entryPath(id: string): string {
  return join(entriesDir(), `${id}.json`)
}

// Shared by everything below that needs to look across entries (theme
// surfacing, recap, the initial index build) rather than just list them for
// display. Resurfacing itself no longer calls this per-check — see the
// similarity index below.
export async function loadAllEntries(): Promise<JournalEntry[]> {
  await ensureDir()
  const files = await fs.readdir(entriesDir())
  const entries: JournalEntry[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(join(entriesDir(), file), 'utf-8')
      entries.push(JSON.parse(raw) as JournalEntry)
    } catch {
      // Skip a corrupt/unreadable file rather than fail the whole read.
    }
  }
  return entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) // newest first
}

export async function saveEntry(text: string): Promise<JournalEntry> {
  await ensureDir()
  const entry: JournalEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    text
  }
  await fs.writeFile(entryPath(entry.id), JSON.stringify(entry, null, 2), 'utf-8')
  return entry
}

// Same as saveEntry, but lets the caller supply a backdated timestamp — used
// by old-journal import so imported writing sits at the point in the
// journal's timeline it actually happened, not "today".
export async function importEntry(text: string, createdAt: string): Promise<JournalEntry> {
  await ensureDir()
  const entry: JournalEntry = {
    id: randomUUID(),
    createdAt,
    text
  }
  await fs.writeFile(entryPath(entry.id), JSON.stringify(entry, null, 2), 'utf-8')
  return entry
}

// Serialize mutations so a late embedding cannot resurrect a deleted entry.
let mutations: Promise<unknown> = Promise.resolve()
function mutate<T>(work: () => Promise<T>): Promise<T> {
  const next = mutations.then(work)
  mutations = next.catch(() => {})
  return next
}
export function updateEntry(id: string, patch: Partial<Pick<JournalEntry, 'reflection' | 'mood' | 'embedding' | 'memory'>>): Promise<void> {
  return mutate(() => updateEntryUnlocked(id, patch))
}
export function deleteEntry(id: string): Promise<void> {
  return mutate(() => deleteEntryUnlocked(id))
}

async function updateEntryUnlocked(
  id: string,
  patch: Partial<Pick<JournalEntry, 'reflection' | 'mood' | 'embedding' | 'memory'>>
): Promise<void> {
  try {
    const raw = await fs.readFile(entryPath(id), 'utf-8')
    const entry = JSON.parse(raw) as JournalEntry
    const updated: JournalEntry = { ...entry, ...patch }
    const temporary = entryPath(id) + '.tmp'
    await fs.writeFile(temporary, JSON.stringify(updated, null, 2), 'utf-8')
    await fs.rename(temporary, entryPath(id))

  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // A deleted entry must not be recreated by a late model result.
  }
}

// Entries are permanent once saved — no edit. The only way to change your
// mind about one is to delete it and, if you want to, write it again.
async function deleteEntryUnlocked(id: string): Promise<void> {
  try {
    await fs.unlink(entryPath(id))
  } catch {
    // Already gone — nothing to do.
  }
}

export async function getEntry(id: string): Promise<JournalEntry | null> {
  try {
    const raw = await fs.readFile(entryPath(id), 'utf-8')
    return JSON.parse(raw) as JournalEntry
  } catch {
    return null
  }
}

export async function listEntries(): Promise<EntrySummary[]> {
  const entries = await loadAllEntries()
  return entries.map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    // Struck (crossed-out) text is stripped for the preview -- it's what
    // the writer marked as a mistake, not what the entry is "about".
    isSample: entry.isSample,
    preview: stripStruckMarkup(entry.text).trim().slice(0, 140),
    ...(entry.mood !== undefined ? { mood: entry.mood } : {})
  }))
}

const THEME_LOOKBACK_DAYS = 30
const THEME_MAX_ENTRIES = 20
export const THEME_MIN_ENTRIES = 5
// Reuses the same recent-reflections window as theme surfacing — a month's
// worth of material either way.
export const RECAP_MIN_ENTRIES = 5

// Recent one-line reflections, newest first — the compact input theme
// surfacing reasons over, rather than raw entry text (already captures the
// emotional gist of each entry, so it's both cheaper and more on-point).
export async function getRecentReflections(): Promise<string[]> {
  const entries = await loadAllEntries()
  const cutoff = Date.now() - THEME_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  return entries
    .filter((e) => new Date(e.createdAt).getTime() >= cutoff && e.reflection)
    .slice(0, THEME_MAX_ENTRIES)
    .map((e) => e.reflection as string)
}

export async function getReflectionsForPeriod(
  start: string,
  end: string
): Promise<string[]> {
  const entries = await loadAllEntries()
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  return entries
    .filter((e) => {
      const t = new Date(e.createdAt).getTime()
      return t >= startMs && t <= endMs && e.reflection
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((e) => e.reflection as string)
}
