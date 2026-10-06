// Mirror-quality eval: runs the app's own retrieval (src/main/memory.ts findMemories, passages.ts,
// similarityIndex.ts) with the real embedding model over a labelled synthetic journal, sweeps the
// similarity threshold, and writes test/results/mirror-eval.md + test/results/mirror-eval.json.
// Never touches the real journal: entries live in memory, scratch files in a temp .mirror-eval-* folder.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const started = Date.now()
const modelsDir = process.env.WORDS_MODELS_DIR || join(root, 'models')
const modelFile = process.env.WORDS_EMBEDDING_MODEL_FILE || 'Qwen3-Embedding-0.6B-Q8_0.gguf'
const modelPath = join(modelsDir, modelFile)
if (!existsSync(modelPath)) {
  console.error(`Embedding model not found: ${modelPath}\nPlace ${modelFile} in models/ or set WORDS_MODELS_DIR.`)
  process.exit(1)
}
const scratch = mkdtempSync(join(root, '.mirror-eval-'))

const transpile = (path, module) => ts.transpileModule(readFileSync(join(root, path), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module }
}).outputText
const esm = async path => import('data:text/javascript;base64,' +
  Buffer.from(transpile(path, ts.ModuleKind.ES2022)).toString('base64'))
const { splitPassages } = await esm('src/main/passages.ts')
const { BruteForceSimilarityIndex, cosineSimilarity } = await esm('src/main/similarityIndex.ts')
const { stripStruckMarkup } = await esm('src/shared/textMarkup.ts')

// --- corpus: synthetic set + test/fixtures/sample-entries.json (labelled by position: 4 ideas x 4, then 4 unrelated) ---
const synthetic = JSON.parse(readFileSync(join(root, 'test/fixtures/mirror-eval.json'), 'utf8')).entries
const sampleGroups = ['journal-memory', 'perfectionism', 'array-dedup', 'quiet-morning', null]
const sample = JSON.parse(readFileSync(join(root, 'test/fixtures/sample-entries.json'), 'utf8')).map((e, i) => ({
  id: `sample-${i}`, daysAgo: e.daysAgo, text: e.text,
  group: sampleGroups[i % 5], kind: sampleGroups[i % 5] ? 'idea' : 'negative-sample'
}))
const corpus = [...synthetic, ...sample]
const DAY = 86400000
const base = Date.UTC(2026, 0, 1, 12)
for (const e of corpus) e.createdAt = new Date(base - e.daysAgo * DAY).toISOString()
assert.equal(new Set(corpus.map(e => e.id)).size, corpus.length, 'duplicate ids')

// --- real model, same embedding call as llamacpp.embed() ---
const { getLlama } = await import('node-llama-cpp')
const llama = await getLlama({ gpu: false })
const model = await llama.loadModel({ modelPath })
const context = await model.createEmbeddingContext({ contextSize: 2048 })
const prefix = process.env.WORDS_EMBEDDING_PREFIX ?? ''
const vectorCache = new Map()
const embed = async text => {
  if (!vectorCache.has(text)) vectorCache.set(text, Array.from((await context.getEmbeddingFor(prefix + text)).vector))
  return vectorCache.get(text)
}

// --- the app's own orchestration (memory.ts) over in-memory entries ---
const stored = new Map(corpus.map(e => [e.id, { id: e.id, createdAt: e.createdAt, text: e.text }]))
let threshold = 0.68
const dependencies = {
  './llamacpp': { embeddingModelId: () => 'mirror-eval', embed },
  './entries': {
    loadAllEntries: async () => [...stored.values()].map(e => ({ ...e })),
    getEntry: async id => stored.get(id) ?? null,
    updateEntry: async (id, patch) => { if (stored.has(id)) stored.set(id, { ...stored.get(id), ...patch }) }
  },
  './passages': { splitPassages },
  './similarityIndex': { BruteForceSimilarityIndex },
  './settings': { resurfaceSimilarityThreshold: () => threshold },
  '../shared/textMarkup': { stripStruckMarkup }
}
const service = { exports: {} }
runInNewContext(transpile('src/main/memory.ts', ts.ModuleKind.CommonJS), {
  exports: service.exports,
  require: id => { assert(id in dependencies, `unexpected dependency ${id}`); return dependencies[id] }
})

try {
  // Embed everything once (cached), oldest first.
  for (const e of [...corpus].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    assert(await service.exports.findMemories(e.id) !== undefined)
  }
  writeFileSync(join(scratch, 'progress.txt'), 'embedded')
  const byId = new Map(corpus.map(e => [e.id, e]))
  const related = (a, b) => a.group && a.group === b.group
  const earlierRelated = e => corpus.filter(o => o.id !== e.id && related(e, o) && o.createdAt < e.createdAt)
  const negatives = corpus.filter(e => !e.group)

  // Best passage-pair similarity between any two entries (for score distributions and misses).
  const bestPair = (a, b) => {
    let best = -1
    for (const p of stored.get(a.id).memory.passages) for (const q of stored.get(b.id).memory.passages)
      best = Math.max(best, cosineSimilarity(p.vector, q.vector))
    return best
  }

  const run = async t => {
    threshold = t
    let surfaced = 0, correct = 0, relatedTotal = 0, relatedFound = 0, zero = 0, zeroWithRelated = 0, withRelated = 0
    let negHit = 0
    const falsePositives = []
    for (const e of corpus) {
      const matches = await service.exports.findMemories(e.id)
      const rel = earlierRelated(e)
      surfaced += matches.length
      relatedTotal += rel.length
      if (rel.length) withRelated++
      if (!matches.length) { zero++; if (rel.length) zeroWithRelated++ }
      for (const m of matches) {
        const ok = related(e, byId.get(m.id))
        if (ok) { correct++; relatedFound++ }
        else falsePositives.push({ entry: e.id, kind: e.kind, matched: m.id, score: +m.score.toFixed(4),
          now: m.currentPassage.slice(0, 140), then: m.preview.slice(0, 140) })
      }
      if (!e.group && matches.length) negHit++
    }
    return {
      threshold: +t.toFixed(2), surfaced, precision: surfaced ? correct / surfaced : null,
      recall: relatedTotal ? relatedFound / relatedTotal : null,
      hardNegativeFpRate: negHit / negatives.length,
      zeroMatchShare: zero / corpus.length,
      zeroMatchShareWhereRelatedExists: withRelated ? zeroWithRelated / withRelated : null,
      falsePositives
    }
  }

  const sweep = []
  for (let i = 55; i <= 85; i++) sweep.push(await run(i / 100))
  const at = t => sweep.find(r => r.threshold === +t.toFixed(2)) ?? run(t)

  // Misses and score distributions.
  const relatedScores = [], unrelatedScores = []
  for (const e of corpus) for (const o of corpus) {
    if (o.createdAt >= e.createdAt) continue
    const s = bestPair(e, o)
    if (related(e, o)) relatedScores.push({ later: e.id, earlier: o.id, score: +s.toFixed(4) })
    else unrelatedScores.push({ later: e.id, earlier: o.id, score: +s.toFixed(4) })
  }
  relatedScores.sort((a, b) => a.score - b.score)
  unrelatedScores.sort((a, b) => b.score - a.score)

  // --- current thresholds from settings.ts, recommendation per the contract ---
  // "Before" = the original uncalibrated starting values (settings.ts is updated once the eval has been applied).
  const current = { rare: 0.8, balanced: 0.68, often: 0.64 }
  const P = r => r.precision ?? 1, R = r => r.recall ?? 0
  // Margins above the highest unrelated pair guard against a small eval set (quiet beats wrong).
  const maxUnrelated = unrelatedScores[0].score
  const ceil2 = x => Math.ceil(x * 100 - 1e-9) / 100
  // balanced: maximise precision with recall >= 0.6; of the tied thresholds take the lowest that keeps
  // a 0.025 margin above the highest unrelated pair (falls back to the middle of the tied range).
  const okBalanced = sweep.filter(r => R(r) >= 0.6)
  const bestP = Math.max(...okBalanced.map(P))
  const tied = okBalanced.filter(r => Math.abs(P(r) - bestP) < 1e-9)
  const balanced = tied.find(r => r.threshold >= ceil2(maxUnrelated + 0.025)) ?? tied[Math.floor((tied.length - 1) / 2)]
  // rare: precision 1.0 with a 0.08 margin above the highest unrelated pair, and at least 0.05 above balanced
  const rareT = Math.min(0.85, Math.max(ceil2(maxUnrelated + 0.08), balanced.threshold + 0.05))
  const rare = await at(rareT)
  // often: highest threshold meeting recall >= 0.8 and precision >= 0.7 (closest to quiet that still satisfies it)
  const oftenCandidates = sweep.filter(r => R(r) >= 0.8 && P(r) >= 0.7)
  const oftenR = oftenCandidates.length ? oftenCandidates.at(-1) : null
  const oftenT = oftenR ? Math.min(oftenR.threshold, balanced.threshold - 0.02) : Math.max(0.55, balanced.threshold - 0.04)
  const often = await at(oftenT)
  const recommended = { rare: rare.threshold, balanced: balanced.threshold, often: often.threshold }
  const strip = ({ falsePositives, ...rest }) => rest
  const summary = k => ({
    current: { threshold: current[k], ...strip(sweep.find(r => r.threshold === current[k]) ?? { }) },
    recommended: { threshold: recommended[k], ...strip(sweep.find(r => r.threshold === recommended[k])) }
  })
  const sensitivities = { rare: summary('rare'), balanced: summary('balanced'), often: summary('often') }
  const worstFp = sweep.find(r => r.threshold === recommended.balanced).falsePositives
    .sort((a, b) => b.score - a.score).slice(0, 5)
  const worstFpLowest = (sweep.find(r => r.threshold === 0.6) ?? sweep[0]).falsePositives
    .sort((a, b) => b.score - a.score).slice(0, 5)
  const worstMisses = relatedScores.slice(0, 5).map(m => ({
    ...m, later_text: byId.get(m.later).text.slice(0, 160), earlier_text: byId.get(m.earlier).text.slice(0, 160)
  }))

  const result = {
    generatedAt: new Date().toISOString(), model: modelFile,
    corpus: { entries: corpus.length, synthetic: synthetic.length, sample: sample.length,
      ideaGroups: new Set(corpus.filter(e => e.group).map(e => e.group)).size,
      hardNegatives: negatives.length, relatedPairs: relatedScores.length, unrelatedPairs: unrelatedScores.length },
    scoreDistribution: {
      relatedBestPassagePair: { min: relatedScores[0].score, median: relatedScores[Math.floor(relatedScores.length / 2)].score,
        max: relatedScores.at(-1).score },
      unrelatedBestPassagePairTop5: unrelatedScores.slice(0, 5)
    },
    current, recommended, sensitivities,
    sweep: sweep.map(strip), worstFalsePositivesAtRecommendedBalanced: worstFp,
    worstFalsePositivesAt060: worstFpLowest, worstMisses,
    runtimeSeconds: Math.round((Date.now() - started) / 1000)
  }
  writeFileSync(join(root, 'test/results/mirror-eval.json'), JSON.stringify(result, null, 2) + '\n')

  // --- markdown ---
  const f = (x, d = 2) => x === null || x === undefined ? 'n/a' : x.toFixed(d)
  const row = (label, r) => `| ${label} | ${r.threshold.toFixed(2)} | ${f(r.precision)} | ${f(r.recall)} | ${f(r.hardNegativeFpRate)} | ${f(r.zeroMatchShare)} |`
  const md = []
  md.push('# Mirror eval', '',
    `Generated by \`npm run eval:mirror\` (${result.runtimeSeconds}s, ${modelFile}, CPU). Retrieval runs through the app's own \`findMemories\` (src/main/memory.ts), \`splitPassages\` and \`BruteForceSimilarityIndex\`: top 3 per entry, earlier dates only.`, '',
    `**Corpus:** ${corpus.length} entries (${synthetic.length} synthetic in test/fixtures/mirror-eval.json + ${sample.length} from test/fixtures/sample-entries.json), ${result.corpus.ideaGroups} idea groups, ${negatives.length} negative entries (same topic / same mood / filler / unrelated), ${relatedScores.length} related earlier-pairs.`, '',
    '- precision@3: share of surfaced matches that are the same idea.',
    '- recall: share of related earlier entries that got surfaced.',
    '- hard-negative FP rate: share of negative entries (no true match exists) that surface anything.',
    '- zero-match share: share of all entries that surface nothing.', '',
    '## Before / after by sensitivity', '',
    '| Sensitivity | Threshold | Precision@3 | Recall | Hard-neg FP | Zero-match |', '|---|---|---|---|---|---|')
  for (const k of ['rare', 'balanced', 'often']) {
    md.push(row(`${k} (current)`, sensitivities[k].current), row(`${k} (recommended)`, sensitivities[k].recommended))
  }
  md.push('', '## Score separation (best passage pair, earlier vs later entry)', '',
    `Related pairs: min ${f(result.scoreDistribution.relatedBestPassagePair.min, 3)}, median ${f(result.scoreDistribution.relatedBestPassagePair.median, 3)}, max ${f(result.scoreDistribution.relatedBestPassagePair.max, 3)}.`,
    `Highest unrelated pairs: ${unrelatedScores.slice(0, 5).map(u => `${u.later}~${u.earlier} ${u.score.toFixed(3)}`).join('; ')}.`, '',
    '## Full sweep', '', '| Threshold | Surfaced | Precision@3 | Recall | Hard-neg FP | Zero-match | Zero-match (where a related earlier entry exists) |', '|---|---|---|---|---|---|---|')
  for (const r of sweep) md.push(`| ${r.threshold.toFixed(2)} | ${r.surfaced} | ${f(r.precision)} | ${f(r.recall)} | ${f(r.hardNegativeFpRate)} | ${f(r.zeroMatchShare)} | ${f(r.zeroMatchShareWhereRelatedExists)} |`)
  const quote = fp => `- \`${fp.entry}\` -> \`${fp.matched}\` (${fp.score.toFixed(3)}): "${fp.now}" ~ "${fp.then}"`
  md.push('', `## Worst false positives at the recommended balanced threshold (${recommended.balanced.toFixed(2)})`, '',
    ...(worstFp.length ? worstFp.map(quote) : ['None.']),
    '', '## Worst false positives at 0.60 (what a looser setting would let through)', '', ...worstFpLowest.map(quote),
    '', '## Worst misses (related pairs with the lowest best-passage similarity)', '',
    ...worstMisses.map(m => `- \`${m.later}\` -> \`${m.earlier}\` (${m.score.toFixed(3)}): "${m.later_text}" ~ "${m.earlier_text}"`), '')
  writeFileSync(join(root, 'test/results/mirror-eval.md'), md.join('\n'))
  console.log(`Current ${JSON.stringify(current)} -> recommended ${JSON.stringify(recommended)}`)
  for (const k of ['rare', 'balanced', 'often']) {
    const { current: c, recommended: r } = sensitivities[k]
    console.log(`${k}: current ${c.threshold} P=${f(c.precision)} R=${f(c.recall)} | recommended ${r.threshold} P=${f(r.precision)} R=${f(r.recall)}`)
  }
  console.log(`Wrote test/results/mirror-eval.md and test/results/mirror-eval.json in ${result.runtimeSeconds}s`)
} finally {
  await context.dispose(); await model.dispose(); await llama.dispose()
  rmSync(scratch, { recursive: true, force: true })
}
