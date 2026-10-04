import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import type { Letter, LetterSummary, LetterTimeframe } from '../shared/types'

function lettersDir(): string {
  return join(app.getPath('userData'), 'letters')
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(lettersDir(), { recursive: true })
}

function letterPath(id: string): string {
  return join(lettersDir(), `${id}.json`)
}

export async function saveLetter(
  timeframe: LetterTimeframe,
  periodLabel: string,
  periodStart: string,
  periodEnd: string,
  content: string
): Promise<Letter> {
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
  await fs.writeFile(letterPath(letter.id), JSON.stringify(letter, null, 2), 'utf-8')
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
      letters.push(JSON.parse(raw) as Letter)
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
  try {
    const raw = await fs.readFile(letterPath(id), 'utf-8')
    return JSON.parse(raw) as Letter
  } catch {
    return null
  }
}

export async function deleteLetter(id: string): Promise<void> {
  try {
    await fs.unlink(letterPath(id))
  } catch { /* already gone */ }
}
