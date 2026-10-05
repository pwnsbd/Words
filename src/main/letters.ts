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
  return letter
}

export async function saveLetter(
  timeframe: LetterTimeframe,
  periodLabel: string,
  periodStart: string,
  periodEnd: string,
  content: string
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
    createdAt: new Date().toISOString()
  }
  const destination = letterPath(letter.id)
  const temporary = destination + '.tmp'
  try {
    await fs.writeFile(temporary, JSON.stringify(letter, null, 2), 'utf-8')
    await fs.rename(temporary, destination)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
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
    createdAt: l.createdAt
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
