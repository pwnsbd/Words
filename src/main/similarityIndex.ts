// The seam between "how resurfacing finds a similar old entry" and "how
// entries are stored." entries.ts talks to this interface, never to a
// concrete search strategy — so swapping the brute-force implementation
// below for something smarter later (a real vector index — hnswlib, sqlite
// with a vector extension, whatever) is a one-file change, not a rewrite of
// the resurfacing logic.
//
// Built once from everything on disk at startup, then kept in sync
// incrementally (add on save/import, remove on delete) rather than re-read
// from disk on every check — which is also just a straightforwardly faster
// way to do this regardless of indexing strategy.

export interface IndexedEntry {
  id: string
  createdAt: string
  embedding: number[]
}

export interface SimilarityMatch {
  id: string
  score: number
}

export interface SimilarityIndex {
  add(entry: IndexedEntry): void
  remove(id: string): void
  /** Best match above minSimilarity, created before cutoffMs, excluding excludeId. */
  findBestMatch(
    embedding: number[],
    options: { excludeId: string; minSimilarity: number; cutoffMs: number }
  ): SimilarityMatch | null
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// The "day one" implementation: an in-memory map, checked one by one. Fine
// up to at least low thousands of entries — a straight loop over a few
// thousand short vectors is still well under a millisecond. Long before
// that stops being true, this class is what gets replaced.
export class BruteForceSimilarityIndex implements SimilarityIndex {
  private entries = new Map<string, IndexedEntry>()

  add(entry: IndexedEntry): void {
    this.entries.set(entry.id, entry)
  }

  remove(id: string): void {
    this.entries.delete(id)
  }

  findBestMatch(
    embedding: number[],
    { excludeId, minSimilarity, cutoffMs }: { excludeId: string; minSimilarity: number; cutoffMs: number }
  ): SimilarityMatch | null {
    let best: SimilarityMatch | null = null
    for (const entry of this.entries.values()) {
      if (entry.id === excludeId) continue
      if (new Date(entry.createdAt).getTime() > cutoffMs) continue
      const score = cosineSimilarity(embedding, entry.embedding)
      if (score >= minSimilarity && (!best || score > best.score)) {
        best = { id: entry.id, score }
      }
    }
    return best
  }
}
