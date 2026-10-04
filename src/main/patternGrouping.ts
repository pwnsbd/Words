import { createHash } from 'crypto'
import { cosineSimilarity } from './similarityIndex'
import type { JournalEntry, IdeaEvidence } from '../shared/types'

export interface PatternCandidate { id: string; evidence: IdeaEvidence[] }
export function evidenceKey(e: IdeaEvidence): string { return `${e.entryId}:${e.start}:${e.end}` }
export function distinctDays(evidence: IdeaEvidence[]): number {
  return new Set(evidence.map(e => new Date(e.createdAt).toLocaleDateString('en-CA'))).size
}
export function isDismissed(evidence: IdeaEvidence[], dismissed: string[][]): boolean {
  const keys = new Set(evidence.map(evidenceKey))
  return dismissed.some(group => group.filter(key => keys.has(key)).length >= Math.min(3, group.length))
}

// Complete-link grouping: every passage must match every other passage.
// A-B and B-C alone never imply A-C. One passage per entry, at least 3 dates.
export function groupIdeas(entries: JournalEntry[], modelId: string, threshold = 0.68): PatternCandidate[] {
  const nodes = entries.filter(e => e.memory?.modelId === modelId)
    .flatMap(entry => entry.memory!.passages.map(p => ({
      vector: p.vector, evidence: { entryId: entry.id, createdAt: entry.createdAt,
        text: p.text, start: p.start, end: p.end, isSample: entry.isSample } as IdeaEvidence
    }))).sort((a, b) => evidenceKey(a.evidence).localeCompare(evidenceKey(b.evidence)))
  const score = (a: number, b: number): number => cosineSimilarity(nodes[a].vector, nodes[b].vector)
  const groups: PatternCandidate[] = []
  for (let seed = 0; seed < nodes.length; seed++) {
    const members = [seed]
    const candidates = nodes.map((_, i) => i).filter(i => i !== seed && score(seed, i) >= threshold)
      .sort((a, b) => score(seed, b) - score(seed, a) || a - b)
    for (const candidate of candidates) {
      if (members.some(i => nodes[i].evidence.entryId === nodes[candidate].evidence.entryId)) continue
      if (members.every(i => score(i, candidate) >= threshold)) members.push(candidate)
    }
    const evidence = members.map(i => nodes[i].evidence).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    if (evidence.length < 3 || distinctDays(evidence) < 3) continue
    const id = createHash('sha256').update(modelId + evidence.map(evidenceKey).sort().join('|')).digest('hex').slice(0, 24)
    if (!groups.some(g => g.id === id)) groups.push({ id, evidence })
  }
  // Prefer the broadest coherent group over duplicate overlapping triples.
  const selected: PatternCandidate[] = []
  for (const group of groups.sort((a, b) => b.evidence.length - a.evidence.length || a.id.localeCompare(b.id))) {
    const keys = new Set(group.evidence.map(evidenceKey))
    if (selected.some(g => g.evidence.filter(e => keys.has(evidenceKey(e))).length >= Math.ceil(group.evidence.length * 0.66))) continue
    selected.push(group)
  }
  return selected
}
