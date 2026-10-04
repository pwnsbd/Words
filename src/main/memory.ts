import { embed, embeddingModelId } from './llamacpp'
import { loadAllEntries, getEntry, updateEntry } from './entries'
import { splitPassages } from './passages'
import { BruteForceSimilarityIndex } from './similarityIndex'
import { resurfaceSimilarityThreshold } from './settings'
import { stripStruckMarkup } from '../shared/textMarkup'
import type { JournalEntry, MemoryEmbedding, MemoryMatch } from '../shared/types'

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
