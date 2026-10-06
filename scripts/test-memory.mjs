import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

export async function sourceModule(path) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
  })
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
}
const { splitPassages } = await sourceModule('../src/main/passages.ts')
const { BruteForceSimilarityIndex, cosineSimilarity } = await sourceModule('../src/main/similarityIndex.ts')
assert.equal(cosineSimilarity([1, 0], [1]), -1)
assert.equal(cosineSimilarity([0, 0], [0, 0]), -1)
assert.equal(cosineSimilarity([NaN], [1]), -1)
assert.deepEqual(splitPassages('  '), [])
const long = 'Introduction to unrelated things. '.repeat(80) + '\nfunction unique(items) { return [...new Set(items)] }'
const chunks = splitPassages(long)
assert(chunks.length > 1)
assert(chunks.every(p => p.text.length <= 900 && long.slice(p.start, p.end) === p.text))
assert(chunks.at(-1).text.includes('function unique'))
assert(splitPassages('a'.repeat(3000)).every(p => p.text.length <= 900))
const memory = (modelId = 'one', vector = [1, 0]) => ({ modelId, passages: [{ text: 'actual matching passage', start: 300, end: 323, vector }] })
const index = new BruteForceSimilarityIndex()
index.add({ id: 'old', createdAt: '2026-01-01', memory: memory() })
index.add({ id: 'self', createdAt: '2026-05-01', memory: memory() })
index.add({ id: 'future', createdAt: '2026-06-01', memory: memory() })
index.add({ id: 'other-model', createdAt: '2026-01-01', memory: memory('two') })
index.add({ id: 'unrelated', createdAt: '2026-01-01', memory: memory('one', [0, 1]) })
const options = { excludeId: 'self', before: '2026-05-01', minSimilarity: .68 }
assert.deepEqual(index.findMatches(memory(), options).map(m => m.id), ['old'])
assert.equal(index.findMatches(memory(), options)[0].start, 300)
index.add({ id: 'yesterday', createdAt: '2026-04-30', memory: memory() })
assert.equal(index.findMatches(memory(), options).length, 2)
index.remove('old')
assert.deepEqual(index.findMatches(memory(), options).map(m => m.id), ['yesterday'])
console.log('Memory regression tests passed (vectors, model isolation, chronology, deletion, passage offsets and long text).')

if (process.argv.includes('--model')) {
  const { getLlama } = await import('node-llama-cpp')
  const llama = await getLlama({ gpu: false })
  const model = await llama.loadModel({ modelPath: fileURLToPath(new URL('../models/Qwen3-Embedding-0.6B-Q8_0.gguf', import.meta.url)) })
  const context = await model.createEmbeddingContext({ contextSize: 2048 })
  const cases = [
    ['paraphrase', 'I keep postponing projects because I am afraid they will not be perfect.', 'My fear of making something imperfect stops me from getting started.'],
    ['product idea', 'A journal could remind me of earlier ideas even when I describe them differently.', 'I want my notebook to recognize a thought I had months ago despite different wording.'],
    ['code', 'function unique(items) { return [...new Set(items)] }', 'const deduplicate = values => Array.from(new Set(values));'],
    ['unrelated', 'A journal could remind me of earlier ideas even when I describe them differently.', 'Roast the potatoes in olive oil until they are golden brown.'],
    ['opposite code', 'const ascending = values => values.sort((a, b) => a - b);', 'const descending = values => values.sort((a, b) => b - a);']
  ]
  try {
    for (const [name, a, b] of cases) {
      const va = Array.from((await context.getEmbeddingFor(a)).vector)
      const vb = Array.from((await context.getEmbeddingFor(b)).vector)
      const score = cosineSimilarity(va, vb)
      console.log(`${name}: ${score.toFixed(3)} (${score >= .68 ? 'surfaces' : 'quiet'})`)
      if (name === 'unrelated') assert(score < .68)
      if (name === 'product idea' || name === 'code') assert(score >= .68)
    }
  } finally { await context.dispose(); await model.dispose(); await llama.dispose() }
}
// Exercise the real orchestration with a fake model and isolated in-memory entries.
const { runInNewContext } = await import('node:vm')
const { stripStruckMarkup } = await sourceModule('../src/shared/textMarkup.ts')
const stored = new Map([
  ['old', { id: 'old', createdAt: '2025-01-01', text: 'An earlier idea', embedding: [9, 9] }],
  ['new', { id: 'new', createdAt: '2026-01-01', text: 'An earlier idea in other words' }]
])
let activeId = 'model-a', calls = 0, available = true, loads = 0
const dependencies = {
  './llamacpp': { embeddingModelId: () => available ? activeId : null, embed: async () => { calls++; return [1, 0] } },
  './entries': {
    loadAllEntries: async () => { loads++; return [...stored.values()].map(e => ({ ...e })) },
    getEntry: async id => stored.get(id) ?? null,
    updateEntry: async (id, patch) => { if (stored.has(id)) stored.set(id, { ...stored.get(id), ...patch }) }
  },
  './passages': { splitPassages },
  './similarityIndex': { BruteForceSimilarityIndex },
  './settings': { resurfaceSimilarityThreshold: () => .68 },
  '../shared/textMarkup': { stripStruckMarkup }
}
const orchestrator = { exports: {} }
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/main/memory.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, { exports: orchestrator.exports, setTimeout, clearTimeout, console, require: id => {
  assert(id in dependencies, `unexpected dependency ${id}`)
  return dependencies[id]
} })
const memoryService = orchestrator.exports
assert.equal((await memoryService.findMemories('new'))[0].id, 'old')
assert.equal(calls, 2, 'legacy embeddings must be rebuilt')
await memoryService.findMemories('new')
assert.equal(calls, 2, 'unchanged entries reuse saved passage embeddings')
activeId = 'model-b'
await memoryService.findMemories('new')
assert.equal(calls, 4, 'switching same-dimension models still rebuilds both entries')
stored.delete('old')
assert.equal((await memoryService.findMemories('new')).length, 0)
available = false
assert.equal((await memoryService.findMemories('new')).length, 0)
await assert.rejects(memoryService.modelJob(async () => { throw new Error('test failure') }))
assert.equal(await memoryService.modelJob(async () => 42), 42, 'failed jobs must not poison the queue')
console.log('Memory service tests passed (migration, reuse, model swaps, deletion, missing models and queue recovery).')

// Echoes: stored vectors only, active model only, threshold respected, cached until invalidated.
{
  const unit = (angle) => [Math.cos(angle), Math.sin(angle)]
  const entry = (id, day, modelId, passages) => ({ id, createdAt: `2026-02-0${day}`, text: id,
    memory: { modelId, passages: passages.map(([text, vector]) => ({ text, start: 0, end: text.length, vector })) } })
  stored.clear()
  // 'a' has a lonely passage and one that returns in b and c; the busier one must win.
  stored.set('a', entry('a', 1, 'model-b', [['lonely line', [0, 1]], ['the recurring thought', unit(0)]]))
  stored.set('b', entry('b', 2, 'model-b', [['recurring, reworded', unit(0.1)]]))
  stored.set('c', entry('c', 3, 'model-b', [['the thought again', unit(-0.1)]]))
  stored.set('d', entry('d', 4, 'model-b', [['something else entirely', [0, 1]]]))
  // Same vectors under another model must not count.
  stored.set('x', entry('x', 5, 'model-a', [['recurring from elsewhere', unit(0)]]))
  activeId = 'model-b'; available = true
  memoryService.invalidateEchoes()
  let echoes = await memoryService.getEchoes()
  assert.deepEqual({ ...echoes.a }, { passage: 'the recurring thought', count: 2 })
  assert(!('x' in echoes), 'other-model entries have no echoes')
  assert.equal(echoes.d.count, 1, 'a passage can echo a single other entry (d and a share [0,1])')
  assert.equal(echoes.d.passage, 'something else entirely')
  // Cached: nothing is reloaded until invalidated.
  const before = loads
  await memoryService.getEchoes()
  assert.equal(loads, before, 'second call is served from cache')
  // Deleting an entry invalidates: its echoes vanish and others recount.
  stored.delete('b')
  memoryService.invalidateEchoes()
  echoes = await memoryService.getEchoes()
  assert.equal(loads, before + 1)
  assert(!('b' in echoes))
  assert.equal(echoes.a.count, 1)
  // Below the threshold: nothing.
  const far = await memoryService.computeEchoes([...stored.values()], 'model-b', 1.01)
  assert.equal(Object.keys(far).length, 0)
  // No model: no echoes.
  available = false
  memoryService.invalidateEchoes()
  assert.equal(Object.keys(await memoryService.getEchoes()).length, 0)
  available = true
  // Speed: 500 entries x 3 passages x 1024 dims, one slice at a time.
  const big = []
  for (let i = 0; i < 500; i++) {
    big.push({ id: 'e' + i, createdAt: new Date(2025, 0, 1 + i).toISOString(), text: '',
      memory: { modelId: 'model-b', passages: [0, 1, 2].map(k => ({ text: `p${i}.${k}`, start: 0, end: 1,
        vector: Array.from({ length: 1024 }, () => Math.random() - .5) })) } })
  }
  const t0 = Date.now()
  await memoryService.computeEchoes(big, 'model-b', .68)
  console.log(`  echo timing: 500 entries x 3 passages x 1024 dims in ${Date.now() - t0} ms (background, sliced)`)
}
console.log('Echo tests passed (most-connected passage, model isolation, threshold, cache invalidation).')

// Older saved model selections cannot re-enable removed configurations.
for (const previous of [null, { reflectionModel: 'off', embeddingModel: 'nomic', theme: 'dark' }]) {
  let persisted
  const settingsModule = { exports: {} }
  const typesModule = { exports: {} }
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/shared/types.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, { exports: typesModule.exports })
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/main/settings.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, { exports: settingsModule.exports, console, require: id => ({
    '../shared/types': typesModule.exports,
    electron: { app: { getPath: () => '/test' } },
    path: { join: (...parts) => parts.join('/') },
    fs: { readFileSync: () => { if (!previous) throw new Error('missing'); return JSON.stringify(previous) },
      mkdirSync: () => {}, renameSync: () => {}, writeFileSync: (_path, value) => { persisted = JSON.parse(value) } }
  })[id] })
  const initial = settingsModule.exports.getSettings()
  assert.equal(initial.reflectionModel, 'existing')
  assert.equal(initial.embeddingModel, 'qwen')
  if (previous) assert.equal(initial.theme, 'dark')
  settingsModule.exports.updateSettings({ reflectionModel: 'small', embeddingModel: 'nomic' })
  assert.equal(persisted.reflectionModel, 'existing')
  assert.equal(persisted.embeddingModel, 'qwen')
}
console.log('Basic configuration tests passed (new settings, legacy migration and removed-choice rejection).')
