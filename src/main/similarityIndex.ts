import type { MemoryEmbedding, MemoryMatch } from '../shared/types'

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return -1
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return -1
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : -1
}

export interface IndexedEntry {
  id: string
  createdAt: string
  memory: MemoryEmbedding
}

export class BruteForceSimilarityIndex {
  private entries = new Map<string, IndexedEntry>()
  add(entry: IndexedEntry): void { this.entries.set(entry.id, entry) }
  remove(id: string): void { this.entries.delete(id) }

  findMatches(target: MemoryEmbedding, options: {
    excludeId: string; minSimilarity: number; before: string; limit?: number
  }): MemoryMatch[] {
    const matches: MemoryMatch[] = []
    for (const entry of this.entries.values()) {
      if (entry.id === options.excludeId || entry.createdAt >= options.before) continue
      if (entry.memory.modelId !== target.modelId) continue
      let best: MemoryMatch | undefined
      for (const query of target.passages) {
        for (const passage of entry.memory.passages) {
          const score = cosineSimilarity(query.vector, passage.vector)
          if (score >= options.minSimilarity && (!best || score > best.score)) {
            best = { id: entry.id, createdAt: entry.createdAt, preview: passage.text,
              start: passage.start, end: passage.end, score, currentPassage: query.text }
          }
        }
      }
      if (best) matches.push(best)
    }
    return matches.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, options.limit ?? 3)
  }
}
