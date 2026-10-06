// Pattern-rule eval: runs the app's own describePattern() (src/main/llamacpp.ts, transpiled as-is) over 10 sets
// (docs/contracts/pattern-rule.md) and exits 1 on any miss. Never touches %APPDATA%\words; models are read-only.
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const modelsDir = process.env.WORDS_MODELS_DIR || join(root, 'models')
const file = process.env.WORDS_REFLECTION_MODEL_FILE || 'Qwen3.5-9B-Q4_K_M.gguf'
if (!existsSync(join(modelsDir, file))) {
  console.error(`Model file not found in ${modelsDir}: ${file}\nSet WORDS_MODELS_DIR or place it in models/.`)
  process.exit(1)
}
const scratch = mkdtempSync(join(tmpdir(), 'words-pattern-eval-'))
process.env.WORDS_MODELS_DIR = modelsDir

const nodeLlama = await import('node-llama-cpp')
const dependencies = {
  electron: { app: { getAppPath: () => root, getPath: () => scratch } },
  '@electron-toolkit/utils': { is: { dev: true } },
  './settings': { getSettings: () => ({}) },
  'node-llama-cpp': nodeLlama,
  fs: await import('node:fs'),
  path: await import('node:path')
}
const source = ts.transpileModule(readFileSync(join(root, 'src/main/llamacpp.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText
const service = { exports: {} }
runInNewContext(source, {
  exports: service.exports, console: { ...console, error: () => {} }, process, Buffer, URL,
  require: id => { if (!(id in dependencies)) throw new Error(`unexpected dependency ${id}`); return dependencies[id] }
})
const { describePattern, resetModelContexts } = service.exports

const demo = JSON.parse(readFileSync(join(root, 'test/fixtures/demo-entries.json'), 'utf8')).map(e => e.text)
const sample = JSON.parse(readFileSync(join(root, 'test/fixtures/sample-entries.json'), 'utf8')).map(e => e.text)
const pick = (list, idx) => idx.map(i => list[i - 1]) // 1-based

const sets = [
  { name: 'demo doubt 5/9/13', want: true, texts: pick(demo, [5, 9, 13]) },
  { name: 'demo identity 2/6/18', want: true, texts: pick(demo, [2, 6, 18]) },
  { name: 'demo unplanned happiness 7/11/19', want: true, texts: pick(demo, [7, 11, 19]) },
  { name: 'demo release excitement 12/16/20', want: true, texts: pick(demo, [12, 16, 20]) },
  { name: 'sample journal-memory 1/6/11/16', want: true, texts: pick(sample, [1, 6, 11, 16]) },
  { name: 'sample unrelated 5/10/15/20', want: false, texts: pick(sample, [5, 10, 15, 20]) },
  { name: 'synthetic calm walk/music/nap', want: false, texts: [
    'Walked along the river this morning and felt completely calm.',
    'Put on some quiet piano music in the evening and felt calm again.',
    'Took a short nap after lunch and woke up feeling calm.'] },
  { name: 'synthetic happy dinner/weather/book', want: false, texts: [
    'Had a really good dinner with friends tonight and I was happy.',
    'The weather was sunny all day and it made me happy.',
    'Finished a book I had been reading for weeks and felt happy about it.'] },
  { name: 'mixed demo 5/7/16', want: false, texts: pick(demo, [5, 7, 16]) }
]
let misses = 0
for (const s of sets) {
  const r = await describePattern(s.texts)
  const ok = r !== null && r.isPattern === s.want
  if (!ok) misses++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name}  want=${s.want} got=${r ? r.isPattern : 'null'}  title="${r ? r.title : ''}"`)
}
console.log(`${sets.length - misses}/${sets.length} correct`)
await resetModelContexts()
rmSync(scratch, { recursive: true, force: true })
process.exit(misses ? 1 : 0)
