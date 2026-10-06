// Reflection-model eval: runs the app's own reflect(), describePattern() and writeLetterForTimeframe()
// (src/main/llamacpp.ts, transpiled as-is) for each candidate model over sample-entries.json, then writes
// docs/reflection-eval.md (Llama | Qwen side by side) and docs/reflection-eval.json.
// Never touches the real journal: nothing is read from or written to %APPDATA%\words; settings are stubbed
// and any scratch files live in a temp folder that is deleted afterwards. Models are read-only.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const modelsDir = process.env.WORDS_MODELS_DIR || join(root, 'models')
const MODELS = [
  { label: 'Llama 3.1 8B', file: 'reflection-model.gguf' },
  { label: 'Qwen3.5-9B', file: 'Qwen3.5-9B-Q4_K_M.gguf' }
]
const missing = MODELS.filter(m => !existsSync(join(modelsDir, m.file)))
if (missing.length) {
  console.error(`Model file(s) not found in ${modelsDir}: ${missing.map(m => m.file).join(', ')}\nSet WORDS_MODELS_DIR or place them in models/.`)
  process.exit(1)
}

const scratch = mkdtempSync(join(tmpdir(), 'words-reflection-eval-'))
process.env.WORDS_MODELS_DIR = modelsDir

// Load the app's llamacpp.ts with its electron/settings imports stubbed; node-llama-cpp is the real one.
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
const { reflect, describePattern, writeLetterForTimeframe, resetModelContexts } = service.exports

const entries = JSON.parse(readFileSync(join(root, 'sample-entries.json'), 'utf8'))
const patternIdx = [0, 5, 10, 15] // four paraphrases of one idea (journal-memory group)
const leak = s => typeof s === 'string' && /<\/?think/i.test(s)
const ms = n => Math.round(n)
// The app disposes each chat sequence without awaiting it, and Qwen3.5 frees its sequence a moment later than
// Llama does. If the app's own call reports "No sequences left", wait for the slot and retry; only the
// successful attempt is timed, so the wait is not counted as model latency.
const timed = async fn => {
  for (let attempt = 0; ; attempt++) {
    errors.length = 0
    const t = performance.now()
    const value = await fn()
    const elapsed = performance.now() - t
    if (!errors.some(e => e.includes('No sequences left')) || attempt >= 100) return { value, ms: elapsed }
    await new Promise(r => setTimeout(r, 250))
  }
}
const stats = list => {
  if (!list.length) return { avg: null, p95: null }
  const s = [...list].sort((a, b) => a - b)
  return { avg: ms(s.reduce((a, b) => a + b, 0) / s.length), p95: ms(s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]) }
}

const results = {}
try {
  for (const m of MODELS) {
    console.log(`\n== ${m.label} (${m.file})`)
    process.env.WORDS_REFLECTION_MODEL_FILE = m.file
    await resetModelContexts()
    const r = { label: m.label, file: m.file, reflections: [], pattern: null, letter: null }
    // First call loads the model; time it with a trivial entry and report as load time.
    errors.length = 0
    const load = await timed(() => reflect('Hello.'))
    r.loadMs = ms(load.ms)
    console.log(`load + warm-up: ${r.loadMs} ms`, errors.join(' | '))
    for (const [i, e] of entries.entries()) {
      errors.length = 0
      const t = await timed(() => reflect(e.text))
      const out = t.value
      r.reflections.push({
        index: i, daysAgo: e.daysAgo, ms: ms(t.ms), reflection: out?.reflection ?? null, mood: out?.mood ?? null,
        failed: !out, errors: [...errors], thinkLeak: out ? leak(out.reflection) : false
      })
      console.log(`${i + 1}/${entries.length} ${ms(t.ms)} ms ${out ? out.mood + ' ' + out.reflection.slice(0, 80) : 'NULL'}`)
      if (!out) console.log("  ", errors.join(" | ").slice(0, 300))
    }
    errors.length = 0
    const p = await timed(() => describePattern(patternIdx.map(i => entries[i].text)))
    r.pattern = { ms: ms(p.ms), result: p.value, failed: !p.value, errors: [...errors], thinkLeak: p.value ? leak(p.value.title + p.value.description) : false }
    console.log('pattern', JSON.stringify(p.value))
    // Week letter from this model's own reflections of the 6 most recent sample entries (newest first).
    const recent = r.reflections.filter(x => x.reflection).sort((a, b) => a.daysAgo - b.daysAgo).slice(0, 6)
    errors.length = 0
    const l = await timed(() => writeLetterForTimeframe(recent.map(x => x.reflection), 'week'))
    r.letter = { ms: ms(l.ms), inputCount: recent.length, text: l.value, failed: !l.value, errors: [...errors], thinkLeak: leak(l.value) }
    console.log('letter', l.value)
    const lat = stats(r.reflections.filter(x => !x.failed).map(x => x.ms))
    r.summary = {
      loadMs: r.loadMs, avgMs: lat.avg, p95Ms: lat.p95,
      nulls: r.reflections.filter(x => x.failed).length,
      parseFailures: r.reflections.filter(x => x.errors.length).length + (r.pattern.errors.length ? 1 : 0) + (r.letter.errors.length ? 1 : 0),
      thinkLeaks: r.reflections.filter(x => x.thinkLeak).length + (r.pattern.thinkLeak ? 1 : 0) + (r.letter.thinkLeak ? 1 : 0)
    }
    results[m.label] = r
    await resetModelContexts()
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

writeFileSync(join(root, 'docs/reflection-eval.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2))

// --- markdown ---
const [a, b] = MODELS.map(m => results[m.label])
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ')
const short = s => s.length > 120 ? s.slice(0, 117).trimEnd() + '...' : s
const show = x => x.reflection ? `${cell(x.reflection)} (mood ${x.mood}, ${x.ms} ms)` : `FAILED (${x.ms} ms)`
const md = []
md.push('# Reflection model eval', '',
  `Generated by \`npm run eval:reflection\` on ${new Date().toISOString().slice(0, 10)}. The app's own reflect / describePattern / writeLetterForTimeframe, run as they are, over sample-entries.json.`, '',
  '## Summary', '', `| | ${a.label} | ${b.label} |`, '|---|---|---|',
  `| Model load + warm-up (ms) | ${a.summary.loadMs} | ${b.summary.loadMs} |`,
  `| Reflection latency avg (ms) | ${a.summary.avgMs} | ${b.summary.avgMs} |`,
  `| Reflection latency p95 (ms) | ${a.summary.p95Ms} | ${b.summary.p95Ms} |`,
  `| Nulls (of ${entries.length}) | ${a.summary.nulls} | ${b.summary.nulls} |`,
  `| Parse failures / logged errors | ${a.summary.parseFailures} | ${b.summary.parseFailures} |`,
  `| Outputs containing \`<think\` | ${a.summary.thinkLeaks} | ${b.summary.thinkLeaks} |`, '',
  `Qwen/Llama average latency ratio: ${a.summary.avgMs && b.summary.avgMs ? (b.summary.avgMs / a.summary.avgMs).toFixed(2) : 'n/a'} (budget: about 1.5).`, '',
  '## Reflections', '', `| # | Entry | ${a.label} | ${b.label} |`, '|---|---|---|---|')
entries.forEach((e, i) => md.push(`| ${i + 1} | ${cell(short(e.text))} | ${show(a.reflections[i])} | ${show(b.reflections[i])} |`))
const pat = r => r.pattern.result
  ? `isPattern: ${r.pattern.result.isPattern}; title: ${cell(r.pattern.result.title) || '(empty)'}; description: ${cell(r.pattern.result.description) || '(empty)'} (${r.pattern.ms} ms)`
  : `FAILED (${r.pattern.ms} ms)`
md.push('', '## Pattern', '', `Four paraphrases of one idea: entries ${patternIdx.map(i => i + 1).join(', ')}.`, '',
  `| ${a.label} | ${b.label} |`, '|---|---|', `| ${pat(a)} | ${pat(b)} |`)
md.push('', '## Week letter', '', `Written from each model's own reflections of the ${a.letter.inputCount}/${b.letter.inputCount} most recent entries.`, '')
for (const r of [a, b]) md.push(`### ${r.label} (${r.letter.ms} ms)`, '', r.letter.text ? r.letter.text.split('\n').map(x => '> ' + x).join('\n') : '_FAILED_', '')
writeFileSync(join(root, 'docs/reflection-eval.md'), md.join('\n'))
console.log('\nWrote docs/reflection-eval.md and docs/reflection-eval.json')
for (const r of Object.values(results)) console.log(r.label, JSON.stringify(r.summary))
