import { embed, embeddingModelId } from './llamacpp'
import { loadAllEntries, getEntry, updateEntry } from './entries'
import { splitPassages } from './passages'
import { BruteForceSimilarityIndex } from './similarityIndex'
import { resurfaceSimilarityThreshold } from './settings'
import { stripStruckMarkup } from '../shared/textMarkup'
import type { JournalEntry, MemoryEmbedding, MemoryMatch, EntryEcho, EntryCardText } from '../shared/types'

// All model operations (including configuration changes) use this queue. Small
// local contexts have one sequence; overlapping saves must not compete for it.
let pending: Promise<unknown> = Promise.resolve()
export function modelJob<T>(work: () => Promise<T>): Promise<T> {
  const result = pending.then(work)
  pending = result.catch(() => {})
  return result
}

export async function indexEntry(entry: JournalEntry, modelId: string, force = false): Promise<MemoryEmbedding | null> {
  if (!force && entry.memory?.modelId === modelId) return entry.memory
  const passages: MemoryEmbedding['passages'] = []
  for (const passage of splitPassages(stripStruckMarkup(entry.text))) {
    const vector = await embed(passage.text)
    if (!vector || !vector.length || vector.some((value) => !Number.isFinite(value))) return null
    passages.push({ ...passage, vector })
  }
  const memory = { modelId, passages }
  await updateEntry(entry.id, { memory })
  return memory
}

export async function rebuildMemory(force = false): Promise<{ indexed: number; failed: number }> {
  const modelId = embeddingModelId()
  const entries = await loadAllEntries()
  if (!modelId) return { indexed: 0, failed: entries.length }
  let indexed = 0, failed = 0
  for (const entry of entries) {
    if (await indexEntry(entry, modelId, force)) indexed++
    else { failed++; break } // unavailable model: retry on the next run, without repeated loads
  }
  return { indexed, failed: failed ? entries.length - indexed : 0 }
}

export async function findMemories(id: string): Promise<MemoryMatch[]> {
  const target = await getEntry(id)
  const modelId = embeddingModelId()
  if (!target || !modelId) return []
  const memory = await indexEntry(target, modelId)
  if (!memory) return []
  const index = new BruteForceSimilarityIndex()
  for (const entry of await loadAllEntries()) {
    if (entry.id === target.id || entry.createdAt >= target.createdAt) continue
    const historical = await indexEntry(entry, modelId)
    if (!historical) break
    index.add({ id: entry.id, createdAt: entry.createdAt, memory: historical })
  }
  // Recheck deletions after potentially lengthy inference.
  if (!await getEntry(id)) return []
  const matches = index.findMatches(memory, {
    excludeId: id, before: target.createdAt, minSimilarity: resurfaceSimilarityThreshold()
  })
  const surviving: MemoryMatch[] = []
  for (const match of matches) if (await getEntry(match.id)) surviving.push(match)
  return surviving
}

// ---- Journal grid: the passage that echoes across other entries ----
//
// Uses only stored passage vectors of the active model (no model calls). All
// vectors are normalised once, so each comparison is a plain dot product.
// Brute force over ~1500 passages takes a while on one thread, so it runs in
// the background in short slices and results fill in as they are ready; the
// grid never waits for it.

function normalised(vector: number[]): Float32Array | null {
  if (!vector.length) return null
  let norm = 0
  for (const value of vector) {
    if (!Number.isFinite(value)) return null
    norm += value * value
  }
  if (!norm) return null
  const out = new Float32Array(vector.length)
  const scale = 1 / Math.sqrt(norm)
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] * scale
  return out
}

export async function computeEchoes(
  entries: JournalEntry[], modelId: string, threshold: number,
  onEntry?: (id: string, echo: EntryEcho) => void
): Promise<Record<string, EntryEcho>> {
  const items: { id: string; createdAt: string; texts: string[]; vectors: Float32Array[] }[] = []
  for (const entry of entries) {
    if (entry.memory?.modelId !== modelId) continue
    const texts: string[] = [], vectors: Float32Array[] = []
    for (const passage of entry.memory.passages) {
      const vector = normalised(passage.vector)
      if (vector) { texts.push(passage.text); vectors.push(vector) }
    }
    if (vectors.length) items.push({ id: entry.id, createdAt: entry.createdAt, texts, vectors })
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) // newest first, like the grid
  const result: Record<string, EntryEcho> = {}
  let sliceStart = Date.now()
  for (const item of items) {
    let bestText = '', bestCount = 0, bestTop = -1
    for (let p = 0; p < item.vectors.length; p++) {
      const vector = item.vectors[p]
      let count = 0, top = -1
      for (const other of items) {
        if (other === item) continue
        let match = -1
        for (const candidate of other.vectors) {
          if (candidate.length !== vector.length) continue
          let dot = 0
          for (let i = 0; i < vector.length; i++) dot += vector[i] * candidate[i]
          if (dot > match) match = dot
        }
        if (match >= threshold) { count++; if (match > top) top = match }
      }
      if (count && (count > bestCount || (count === bestCount && top > bestTop))) {
        bestText = item.texts[p]; bestCount = count; bestTop = top
      }
    }
    if (bestCount) {
      result[item.id] = { passage: bestText, count: bestCount }
      onEntry?.(item.id, result[item.id])
    }
    if (Date.now() - sliceStart > 8) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      sliceStart = Date.now()
    }
  }
  return result
}

interface EchoState { key: string; result: Record<string, EntryEcho>; done: boolean; job: Promise<void> }
let echoState: EchoState | null = null
let echoListener: (() => void) | null = null

// Call on save, delete, import and memory rebuild.
export function invalidateEchoes(): void { echoState = null }
export function onEchoesReady(listener: () => void): void { echoListener = listener }

// Returns what is ready within the budget; the rest keeps computing and
// the listener fires when it completes. Cached until invalidated.
export async function getEchoes(budgetMs = 250): Promise<Record<string, EntryEcho>> {
  const modelId = embeddingModelId()
  if (!modelId) return {}
  const threshold = resurfaceSimilarityThreshold()
  const key = `${modelId}|${threshold}`
  if (!echoState || echoState.key !== key) {
    const state: EchoState = { key, result: {}, done: false, job: Promise.resolve() }
    state.job = (async () => {
      const entries = await loadAllEntries()
      await computeEchoes(entries, modelId, threshold, (id, echo) => { state.result[id] = echo })
      state.done = true
      if (echoState === state) echoListener?.()
    })().catch((err) => {
      if (echoState === state) echoState = null
      console.error('[words] echo computation failed:', err)
    })
    echoState = state
  }
  const state = echoState
  if (!state.done) {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([state.job, new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs) })])
    if (timer) clearTimeout(timer)
  }
  return { ...state.result }
}

// The opening of each entry (struck markup kept) plus its reflection: enough
// for grid cards to show a hint and unfold, without bloating the list payload.
const CARD_EXCERPT_CHARS = 700
export async function listCardTexts(): Promise<EntryCardText[]> {
  return (await loadAllEntries()).map((entry) => {
    let excerpt = entry.text.slice(0, CARD_EXCERPT_CHARS)
    // Never leave a strike run open at the cut.
    if (excerpt.lastIndexOf('') > excerpt.lastIndexOf('')) excerpt += ''
    return { id: entry.id, excerpt, ...(entry.reflection ? { reflection: entry.reflection } : {}) }
  })
}
