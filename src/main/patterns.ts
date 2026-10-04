import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { loadAllEntries } from './entries'
import { embeddingModelId, describePattern } from './llamacpp'
import { modelJob, rebuildMemory } from './memory'
import { groupIdeas, evidenceKey, isDismissed } from './patternGrouping'
import { stripStruckMarkup } from '../shared/textMarkup'
import type { IdeaPattern, PatternsSnapshot } from '../shared/types'

const ANALYSIS_VERSION = 2
type State = { version: 1; analysisVersion?: number; modelId: string | null; fingerprint: string; patterns: IdeaPattern[]; dismissed: string[][] }
let state: State = { version: 1, analysisVersion: ANALYSIS_VERSION, modelId: null, fingerprint: '', patterns: [], dismissed: [] }
let loaded: Promise<void> | null = null
let writes: Promise<void> = Promise.resolve()
let updating = false
let again = false
let message: string | null = null
function path(): string { return join(app.getPath('userData'), 'idea-patterns.json') }
async function load(): Promise<void> {
  loaded ??= (async () => {
    try {
      const saved = JSON.parse(await fs.readFile(path(), 'utf8')) as State
      if (saved.version === 1 && Array.isArray(saved.patterns) && Array.isArray(saved.dismissed)) {
        state = saved.analysisVersion === ANALYSIS_VERSION ? saved : {
          ...saved, analysisVersion: ANALYSIS_VERSION, fingerprint: '', patterns: []
        }
      }
    } catch { /* first run or unreadable cache: rebuild from entries */ }
  })()
  return loaded
}
function persist(): Promise<void> {
  const next = writes.catch(() => {}).then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(path() + '.tmp', JSON.stringify(state), 'utf8')
    await fs.rename(path() + '.tmp', path())
  })
  writes = next
  return next
}
export async function listPatterns(): Promise<PatternsSnapshot> {
  await load()
  const entries = new Map((await loadAllEntries()).map(e => [e.id, e]))
  const patterns = state.modelId === embeddingModelId() ? state.patterns.filter(pattern =>
    !isDismissed(pattern.evidence, state.dismissed) && pattern.evidence.every(e => {
      const entry = entries.get(e.entryId)
      return entry && stripStruckMarkup(entry.text).slice(e.start, e.end) === e.text
    })) : []
  patterns.sort((a, b) => b.evidence[b.evidence.length - 1].createdAt.localeCompare(a.evidence[a.evidence.length - 1].createdAt))
  return { patterns, updating, message }
}
export async function dismissPattern(id: string): Promise<PatternsSnapshot> {
  await load()
  const pattern = state.patterns.find(p => p.id === id)
  if (pattern && !isDismissed(pattern.evidence, state.dismissed)) {
    state.dismissed.push(pattern.evidence.map(evidenceKey))
    await persist()
  }
  return listPatterns()
}
// Purge cached excerpts immediately on deletion, even if models are unavailable.
export async function invalidatePatternsForEntry(id: string): Promise<void> {
  await load()
  state.patterns = state.patterns.filter(p => !p.evidence.some(e => e.entryId === id))
  state.fingerprint = ''
  await persist()
}
async function refresh(): Promise<void> {
  await load()
  const modelId = embeddingModelId()
  if (!modelId) { message = 'The memory model is not ready yet. Your writing is safe.'; return }
  const result = await rebuildMemory()
  if (result.failed) { message = 'Some writing could not be checked. You can try again.'; return }
  const entries = await loadAllEntries()
  const fingerprint = createHash('sha256').update(modelId + entries.map(e => e.id + e.createdAt + e.text).sort().join('|')).digest('hex')
  if (state.fingerprint === fingerprint && state.modelId === modelId) { message = null; return }
  const candidates = groupIdeas(entries, modelId)
  const patterns: IdeaPattern[] = []
  let failed = false
  for (const candidate of candidates) {
    if (isDismissed(candidate.evidence, state.dismissed)) continue
    const cached = state.modelId === modelId ? state.patterns.find(p => p.id === candidate.id) : undefined
    if (cached) { patterns.push(cached); continue }
    // Evenly sample long histories, including both endpoints, within a small context.
    const evidence = candidate.evidence.filter((_, i, all) => all.length <= 6 ||
      Array.from({ length: 6 }, (_, j) => Math.round(j * (all.length - 1) / 5)).includes(i))
    const label = await describePattern(evidence.map(e => e.text))
    if (!label) { failed = true; continue }
    if (label.isPattern && label.title && label.description) patterns.push({ ...candidate, title: label.title, description: label.description })
  }
  const live = new Map((await loadAllEntries()).map(e => [e.id, e]))
  const surviving = patterns.filter(p => p.evidence.every(e => {
    const entry = live.get(e.entryId)
    return entry && stripStruckMarkup(entry.text).slice(e.start, e.end) === e.text
  }))
  state = { ...state, modelId, fingerprint: failed ? '' : fingerprint,
    patterns: surviving.filter(p => !isDismissed(p.evidence, state.dismissed)) }
  message = failed ? 'Some patterns could not be checked. You can try again.' : null
  await persist()
}
export function refreshPatterns(): void {
  if (updating) { again = true; return }
  updating = true
  void modelJob(async () => {
    do { again = false; await refresh() } while (again)
  }).catch(error => {
    console.error('[words] patterns failed:', error)
    message = 'Patterns could not be updated. Please try again.'
  }).finally(() => { updating = false })
}
