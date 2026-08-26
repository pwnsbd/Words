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
import { resurfaceSimilarityThreshold } from './settings'
import { BruteForceSimilarityIndex, type SimilarityIndex } from './similarityIndex'
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
async function loadAllEntries(): Promise<JournalEntry[]> {
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

// --- similarity index (see similarityIndex.ts) ---
// Built once from disk, then kept in sync as entries are saved/imported
// (add) or deleted (remove). Swap the concrete class here to change
// indexing strategy without touching anything below.
const similarityIndex: SimilarityIndex = new BruteForceSimilarityIndex()
let indexReady: Promise<void> | null = null

function ensureIndexReady(): Promise<void> {
  if (!indexReady) {
    indexReady = loadAllEntries().then((entries) => {
      for (const entry of entries) {
        if (entry.embedding) {
          similarityIndex.add({ id: entry.id, createdAt: entry.createdAt, embedding: entry.embedding })
        }
      }
    })
  }
  return indexReady
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

export async function updateEntry(
  id: string,
  patch: Partial<Pick<JournalEntry, 'reflection' | 'mood' | 'embedding'>>
): Promise<void> {
  try {
    const raw = await fs.readFile(entryPath(id), 'utf-8')
    const entry = JSON.parse(raw) as JournalEntry
    const updated: JournalEntry = { ...entry, ...patch }
    await fs.writeFile(entryPath(id), JSON.stringify(updated, null, 2), 'utf-8')
    if (patch.embedding) {
      await ensureIndexReady()
      similarityIndex.add({ id, createdAt: updated.createdAt, embedding: patch.embedding })
    }
  } catch {
    // Entry file may be gone or unreadable — nothing to update.
  }
}

// Entries are permanent once saved — no edit. The only way to change your
// mind about one is to delete it and, if you want to, write it again.
export async function deleteEntry(id: string): Promise<void> {
  try {
    await fs.unlink(entryPath(id))
  } catch {
    // Already gone — nothing to do.
  }
  similarityIndex.remove(id)
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
    preview: stripStruckMarkup(entry.text).trim().slice(0, 140),
    ...(entry.mood !== undefined ? { mood: entry.mood } : {})
  }))
}

const RESURFACE_MIN_AGE_DAYS = 14

// Finds one old, thematically-related entry to quietly resurface — "you
// wrote something like this a while ago" — never a "report", just the
// single best match, and only if it's a genuine echo (similarity threshold)
// of something that isn't just from a few days ago.
export async function findResurfacedEntry(
  targetEmbedding: number[],
  excludeId: string
): Promise<EntrySummary | null> {
  await ensureIndexReady()
  const cutoffMs = Date.now() - RESURFACE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000
  const minSimilarity = resurfaceSimilarityThreshold()

  const match = similarityIndex.findBestMatch(targetEmbedding, { excludeId, minSimilarity, cutoffMs })
  if (!match) return null

  const entry = await getEntry(match.id)
  if (!entry) return null
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    preview: stripStruckMarkup(entry.text).trim().slice(0, 160)
  }
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
