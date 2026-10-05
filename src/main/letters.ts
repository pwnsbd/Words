import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import type { Letter, LetterSummary, LetterTimeframe } from '../shared/types'
import { assertStorageId, isValidDate } from './storageValidation'

function lettersDir(): string {
  return join(app.getPath('userData'), 'letters')
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(lettersDir(), { recursive: true })
}

function letterPath(id: string): string {
  assertStorageId(id)
  return join(lettersDir(), `${id}.json`)
}

function parseLetter(raw: string): Letter {
  const letter = JSON.parse(raw) as Letter
  assertStorageId(letter.id)
  if (!['week', 'month', 'year'].includes(letter.timeframe) || typeof letter.periodLabel !== 'string' ||
      !isValidDate(letter.periodStart) || !isValidDate(letter.periodEnd) || !isValidDate(letter.createdAt) ||
      typeof letter.content !== 'string') throw new Error('Invalid saved letter')
  if (letter.entryCount !== undefined && (!Number.isInteger(letter.entryCount) || letter.entryCount < 0)) {
    delete letter.entryCount // odd files: show nothing rather than a bad count
  }
  return letter
}

async function writeLetterFile(letter: Letter): Promise<void> {
  const destination = letterPath(letter.id)
  const temporary = destination + '.tmp'
  try {
    await fs.writeFile(temporary, JSON.stringify(letter, null, 2), 'utf-8')
    await fs.rename(temporary, destination)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}

export async function saveLetter(
  timeframe: LetterTimeframe,
  periodLabel: string,
  periodStart: string,
  periodEnd: string,
  content: string,
  entryCount?: number
): Promise<Letter> {
  if (!['week', 'month', 'year'].includes(timeframe) || typeof periodLabel !== 'string' ||
      !isValidDate(periodStart) || !isValidDate(periodEnd) || Date.parse(periodStart) > Date.parse(periodEnd) ||
      typeof content !== 'string' || !content.trim()) throw new Error('Invalid letter')
  await ensureDir()
  const letter: Letter = {
    id: randomUUID(),
    timeframe,
    periodLabel,
    periodStart,
    periodEnd,
    content,
    ...(entryCount !== undefined ? { entryCount } : {}),
    createdAt: new Date().toISOString()
  }
  await writeLetterFile(letter)
  return letter
}

// "Write again": same id and period, new content and count, fresh timestamp.
export async function replaceLetterContent(id: string, content: string, entryCount: number): Promise<Letter | null> {
  if (typeof content !== 'string' || !content.trim() || !Number.isInteger(entryCount) || entryCount < 0) {
    throw new Error('Invalid letter')
  }
  const existing = await getLetter(id)
  if (!existing) return null
  const letter: Letter = { ...existing, content, entryCount, createdAt: new Date().toISOString() }
  await writeLetterFile(letter)
  return letter
}

export async function listLetters(timeframe?: LetterTimeframe): Promise<LetterSummary[]> {
  await ensureDir()
  const files = await fs.readdir(lettersDir())
  const letters: Letter[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(join(lettersDir(), file), 'utf-8')
      const letter = parseLetter(raw)
      if (file === `${letter.id}.json`) letters.push(letter)
    } catch { /* skip corrupt */ }
  }
  const filtered = timeframe ? letters.filter((l) => l.timeframe === timeframe) : letters
  filtered.sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))
  return filtered.map((l) => ({
    id: l.id,
    timeframe: l.timeframe,
    periodLabel: l.periodLabel,
    periodStart: l.periodStart,
    createdAt: l.createdAt,
    ...(l.entryCount !== undefined ? { entryCount: l.entryCount } : {})
  }))
}

export async function getLetter(id: string): Promise<Letter | null> {
  assertStorageId(id)
  try {
    const raw = await fs.readFile(letterPath(id), 'utf-8')
    const letter = parseLetter(raw)
    return letter.id === id ? letter : null
  } catch {
    return null
  }
}

export async function deleteLetter(id: string): Promise<void> {
  try {
    await fs.unlink(letterPath(id))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

// ---------- Eligibility ----------
// The renderer words the "nothing qualifies" messages; the rules live here.

export const LETTER_WEEK_MIN = 2
export const LETTER_MONTH_MIN = 5
export const LETTER_YEAR_MIN = 12
export const LETTER_YEAR_MONTHS = 6

export function computePeriod(date: Date, timeframe: LetterTimeframe): { label: string; start: string; end: string } {
  if (timeframe === 'week') {
    const d = date.getDay()
    const sunday = new Date(date)
    sunday.setDate(date.getDate() - d)
    sunday.setHours(0, 0, 0, 0)
    const saturday = new Date(sunday)
    saturday.setDate(sunday.getDate() + 6)
    saturday.setHours(23, 59, 59, 999)
    return {
      label: `Week of ${sunday.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
      start: sunday.toISOString(),
      end: saturday.toISOString()
    }
  }
  if (timeframe === 'month') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1)
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
    return {
      label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      start: start.toISOString(),
      end: end.toISOString()
    }
  }
  const start = new Date(date.getFullYear(), 0, 1)
  const end = new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999)
  return { label: String(date.getFullYear()), start: start.toISOString(), end: end.toISOString() }
}

// Whether the period [start, end] qualifies for a letter, given the creation
// dates (ISO) of every entry that has a reflection. Local time throughout.
// Only finished periods qualify.
export function periodQualifies(
  timeframe: LetterTimeframe,
  start: string,
  end: string,
  reflectionDates: string[],
  now: Date = new Date()
): boolean {
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs >= now.getTime()) return false
  const times = reflectionDates.map((d) => new Date(d).getTime()).filter((t) => Number.isFinite(t))
  const inPeriod = times.filter((t) => t >= startMs && t <= endMs)

  if (timeframe === 'week') return inPeriod.length >= LETTER_WEEK_MIN
  if (timeframe === 'month') {
    if (inPeriod.length >= LETTER_MONTH_MIN) return true
    // An entry in every Sunday-to-Saturday week that overlaps the month.
    const first = new Date(startMs)
    const weekStart = new Date(first.getFullYear(), first.getMonth(), first.getDate() - first.getDay())
    while (weekStart.getTime() <= endMs) {
      const from = weekStart.getTime()
      const to = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7).getTime()
      if (!times.some((t) => t >= from && t < to)) return false
      weekStart.setDate(weekStart.getDate() + 7)
    }
    return true
  }
  if (inPeriod.length >= LETTER_YEAR_MIN) return true
  return new Set(inPeriod.map((t) => new Date(t).getMonth())).size >= LETTER_YEAR_MONTHS
}
