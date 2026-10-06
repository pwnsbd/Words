// Verifies both models with the app's own code: runs reflect() and embed() from src/main/llamacpp.ts
// (transpiled as-is, electron/settings imports stubbed, same approach as eval-reflection.mjs), loaded
// concurrently on first use like index.ts's Promise.all([reflect(text), embed(text)]).
// Checks: both models load, reflection non-null with a mood, no <think leaks, embedding length sane,
// two back-to-back reflections succeed. Exits non-zero on any failure. Models are read-only; nothing
// is read from or written to %APPDATA%\words.
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const modelsDir = process.env.WORDS_MODELS_DIR || join(root, 'models')
const reflectionFile = process.env.WORDS_REFLECTION_MODEL_FILE || 'Qwen3.5-9B-Q4_K_M.gguf'
const embeddingFile = 'Qwen3-Embedding-0.6B-Q8_0.gguf'
const absent = [reflectionFile, embeddingFile].filter(f => !existsSync(join(modelsDir, f)))
if (absent.length) {
  console.error(`✗ FAILED: model file(s) not found in ${modelsDir}: ${absent.join(', ')}`)
  process.exit(1)
}

const scratch = mkdtempSync(join(tmpdir(), 'words-verify-models-'))
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
const errors = []
const quietConsole = { ...console, error: (...a) => errors.push(a.map(String).join(' ')) }
const service = { exports: {} }
runInNewContext(source, {
  exports: service.exports, console: quietConsole, process, Buffer, URL,
  require: id => { if (!(id in dependencies)) throw new Error(`unexpected dependency ${id}`); return dependencies[id] }
})
const { reflect, embed } = service.exports

const failures = []
const check = (ok, msg) => { if (!ok) failures.push(msg) }
const words = s => s.trim().split(/\s+/).filter(Boolean).length
const leak = s => /<\/?think/i.test(s)

function checkReflection(label, r) {
  check(r !== null && r !== undefined, `${label}: reflection is null${errors.length ? ` (${errors.join('; ')})` : ''}`)
  if (!r) return
  console.log(`${label}: "${r.reflection}"  mood=${r.mood}  words=${words(r.reflection)}`)
  check([-2, -1, 0, 1, 2].includes(r.mood), `${label}: missing mood`)
  check(!leak(r.reflection) && !leak(String(r.mood)), `${label}: <think leak`)
}

try {
  const entryText = `Long day. Spent most of it in back-to-back meetings that could have been emails. Made
dinner anyway, sat with it in the quiet for a while.`
  console.log('Simulating first save: reflect + embed running concurrently...')
  const t0 = Date.now()
  const [reflection, embedding] = await Promise.all([reflect(entryText), embed(entryText)])
  console.log(`  both settled in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  checkReflection('Reflection', reflection)
  console.log('Embedding vector length:', embedding?.length)
  check(Array.isArray(embedding) && embedding.length > 0, 'embedding missing or empty')
  check(!embedding || embedding.length === 1024, `unexpected embedding length ${embedding?.length} (expected 1024)`)

  console.log('\nBack-to-back reflections (models warm)...')
  const a = await reflect('A quieter day today. Nothing much happened, and that was alright.')
  const b = await reflect('Argued with my sister on the phone and I still feel off about it.')
  checkReflection('Reflection A', a)
  checkReflection('Reflection B', b)
} catch (err) {
  failures.push(`threw: ${err?.stack || err}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

if (failures.length) {
  console.error('\n✗ FAILED:\n  ' + failures.join('\n  '))
  process.exit(1)
}
console.log('\n✓ models load and the app\'s own reflect()/embed() work end to end')
process.exit(0)
