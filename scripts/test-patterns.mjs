import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import ts from 'typescript'
const bundle = await build({ entryPoints: ['src/main/patternGrouping.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const grouping = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const { groupIdeas, isDismissed, evidenceKey } = grouping
const entry = (id, day, angle = 0) => ({ id, createdAt: `2026-01-${String(day).padStart(2, '0')}T12:00:00Z`, text: id,
  memory: { modelId: 'model', passages: [{ text: id, start: 0, end: id.length, vector: [Math.cos(angle), Math.sin(angle)] }] } })
assert.equal(groupIdeas([entry('a',1), entry('b',2)], 'model').length, 0)
assert.equal(groupIdeas([entry('a',1), entry('b',1), entry('c',1)], 'model').length, 0)
assert.equal(groupIdeas([entry('a',1), entry('b',2), entry('c',3)], 'other-model').length, 0)
assert.equal(groupIdeas([entry('a',1,0), entry('b',2,.7), entry('c',3,1.4)], 'model').length, 0, 'a similarity chain must not become a pattern')
const coherent = [entry('a',1), entry('b',2,.1), entry('c',3,.2), entry('d',4,.3)]
const groups = groupIdeas(coherent, 'model')
assert.equal(groups.length, 1)
assert.equal(groups[0].evidence.length, 4)
assert.deepEqual(groups[0].evidence.map(e => e.entryId), ['a','b','c','d'])
const dismissed = [groups[0].evidence.map(evidenceKey)]
assert(isDismissed(groupIdeas([...coherent, entry('e',5)], 'model')[0].evidence, dismissed))
assert.equal(groupIdeas([entry('a',1), entry('b',2)], 'model').length, 0)

// Real service, fake storage/model: persistence, cached labels, dismissal, deletion.
let entries = coherent.slice(0,3), labelCalls = 0, queued = Promise.resolve(), labelAvailable = true, ideaAllowed = true
const files = new Map()
const deps = {
  electron: { app: { getPath: () => '/fixture' } }, path: { join: (...parts) => parts.join('/') }, crypto: { createHash },
  fs: { promises: { readFile: async p => { if (!files.has(p)) throw new Error('missing'); return files.get(p) },
    mkdir: async () => {}, writeFile: async (p,data) => files.set(p,data), rename: async (a,b) => { files.set(b,files.get(a)); files.delete(a) } } },
  './entries': { loadAllEntries: async () => entries },
  './llamacpp': { embeddingModelId: () => 'model', describePattern: async () => { labelCalls++; return labelAvailable ? { isPattern: ideaAllowed, title: 'A concrete approach', description: 'An approach shared across entries.' } : null } },
  './memory': { rebuildMemory: async () => ({ indexed: entries.length, failed: 0 }), modelJob: work => queued = queued.then(work) },
  './patternGrouping': grouping, '../shared/textMarkup': { stripStruckMarkup: text => text }
}
function loadService() {
  const exports = {}
  runInNewContext(ts.transpileModule(readFileSync('src/main/patterns.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, console, require: id => { assert(id in deps, id); return deps[id] } })
  return exports
}
let service = loadService()
async function refresh() { service.refreshPatterns(); await queued; await new Promise(resolve => setImmediate(resolve)) }
await refresh()
assert.equal((await service.listPatterns()).patterns.length, 1)
assert.equal(labelCalls, 1)
await refresh()
assert.equal(labelCalls, 1, 'unchanged evidence must reuse the saved title')
let snapshot = await service.listPatterns()
await service.dismissPattern(snapshot.patterns[0].id)
entries = coherent
await refresh()
assert.equal((await service.listPatterns()).patterns.length, 0, 'dismissal must survive new related entries')
service = loadService()
assert.equal((await service.listPatterns()).patterns.length, 0, 'dismissal must survive process reload')
files.clear(); service = loadService(); await refresh()
entries = coherent.slice(0,2)
assert.equal((await service.listPatterns()).patterns.length, 0, 'deleted source evidence is hidden immediately')
await refresh()
assert.equal((await service.listPatterns()).patterns.length, 0)
entries = coherent; labelAvailable = false
await refresh()
assert((await service.listPatterns()).message)
labelAvailable = true
await refresh()
assert.equal((await service.listPatterns()).patterns.length, 1, 'a failed label should be retried')
await service.invalidatePatternsForEntry('a')
assert.equal(JSON.parse(files.get('/fixture/idea-patterns.json')).patterns.length, 0, 'deleted excerpts must leave the persisted cache without a model call')
files.clear(); service = loadService(); ideaAllowed = false
await refresh()
assert.equal((await service.listPatterns()).patterns.length, 0, 'shared feelings without an idea must be rejected')
const legacy = JSON.parse(files.get('/fixture/idea-patterns.json'))
legacy.analysisVersion = 1
legacy.dismissed = [['old-a', 'old-b', 'old-c']]
legacy.patterns = [{ id: 'old-title', title: 'Old idea-only result', evidence: [] }]
files.set('/fixture/idea-patterns.json', JSON.stringify(legacy))
service = loadService()
assert.equal((await service.listPatterns()).patterns.length, 0, 'older analysis must not reuse idea-only results')
ideaAllowed = true
await refresh()
const migrated = JSON.parse(files.get('/fixture/idea-patterns.json'))
assert.equal(migrated.analysisVersion, 2)
assert.deepEqual(migrated.dismissed, legacy.dismissed, 'analysis upgrades must preserve dismissals')
assert.equal((await service.listPatterns()).patterns.length, 1)
console.log('Patterns tests passed: coherent groups, distinct days, model isolation, no chains, cache reuse, persistent dismissal, deletion and retry.')
