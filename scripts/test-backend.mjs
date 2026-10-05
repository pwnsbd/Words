import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { PassThrough } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'words-backend-'))
function loadSource(source, deps) {
  const exports = {}
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  runInNewContext(output, { exports, console, Buffer, URL, process: { env: {} }, require: id => {
    assert(id in deps, `Unexpected dependency ${id}`)
    return deps[id]
  } })
  return exports
}
function load(file, deps) { return loadSource(fs.readFileSync(file, 'utf8'), deps) }
try {
  const validation = load('src/main/storageValidation.ts', {})
  const deps = { electron: { app: { getPath: () => fixture } }, path, fs, crypto,
    './storageValidation': validation, '../shared/textMarkup': { stripStruckMarkup: value => value } }
  const entries = load('src/main/entries.ts', deps)
  await assert.rejects(entries.saveEntry('  '), /empty/)
  await assert.rejects(entries.getEntry('../settings'), /Invalid/)
  await assert.rejects(entries.deleteEntry('../settings'), /Invalid/)
  const entry = await entries.saveEntry('Saved writing')
  await fs.promises.writeFile(path.join(fixture, 'entries', 'corrupt.json'), '{"text":42}')
  assert.equal((await entries.listEntries()).length, 1, 'malformed files do not break journal listing')
  await entries.updateEntry(entry.id, { reflection: 'A quiet entry.' })
  assert.equal((await entries.getEntry(entry.id)).reflection, 'A quiet entry.')
  await entries.deleteEntry(entry.id)
  await entries.updateEntry(entry.id, { reflection: 'Late result' })
  assert.equal(await entries.getEntry(entry.id), null, 'late model results do not resurrect deleted writing')

  const settings = load('src/main/settings.ts', deps)
  assert.throws(() => settings.updateSettings({ theme: 'invalid' }), /Invalid/)
  assert.throws(() => settings.updateSettings({ quillDeleteLimit: -1 }), /Invalid/)
  settings.updateSettings({ theme: 'dark' })
  const failing = load('src/main/settings.ts', { ...deps, fs: { ...fs, renameSync: () => { throw new Error('disk failure') } } })
  assert.throws(() => failing.updateSettings({ theme: 'light' }), /disk failure/)
  assert.equal(failing.getSettings().theme, 'dark', 'failed persistence does not publish a changed cache')

  // Exercise the real relocation functions without launching Electron.
  const indexSource = ts.createSourceFile('index.ts', fs.readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest)
  const relocationSource = `import { mkdir, rename, copyFile, rm, link } from 'fs/promises';
    import { join } from 'path'; import { existsSync } from 'fs';\n` + indexSource.statements
    .filter(node => ts.isFunctionDeclaration(node) && ['relocateModelFiles', 'removeRelocatedSources'].includes(node.name?.text))
    .map(node => node.getFullText(indexSource)).join('\n') + '\nexport { relocateModelFiles, removeRelocatedSources };'
  const oldDir = path.join(fixture, 'old-models'), newDir = path.join(fixture, 'new-models')
  fs.mkdirSync(oldDir)
  fs.writeFileSync(path.join(oldDir, 'first.gguf'), 'complete')
  fs.writeFileSync(path.join(oldDir, 'second.gguf'), 'complete')
  const relocationDeps = { fs, path, 'fs/promises': fs.promises }
  const failedMove = loadSource(relocationSource, { ...relocationDeps, 'fs/promises': {
    ...fs.promises, link: async () => { throw new Error('cross-volume') },
    copyFile: async (source, target) => {
      if (source.endsWith('second.gguf')) { await fs.promises.writeFile(target, 'partial'); throw new Error('disk full') }
      return fs.promises.copyFile(source, target)
    }
  } })
  await assert.rejects(failedMove.relocateModelFiles(oldDir, newDir, ['first.gguf', 'second.gguf']), /disk full/)
  assert(fs.existsSync(path.join(oldDir, 'first.gguf')), 'failed moves retain every source')
  assert(fs.existsSync(path.join(oldDir, 'second.gguf')))
  assert(!fs.existsSync(path.join(newDir, 'second.gguf')), 'a partial copy is not published')
  assert(!fs.existsSync(path.join(newDir, 'second.gguf.moving')))
  const move = loadSource(relocationSource, relocationDeps)
  const sources = await move.relocateModelFiles(oldDir, newDir, ['second.gguf'])
  assert(fs.existsSync(path.join(oldDir, 'second.gguf')), 'source retained until settings are committed')
  await move.removeRelocatedSources(sources)
  assert(!fs.existsSync(path.join(oldDir, 'second.gguf')))
  assert.equal(fs.readFileSync(path.join(newDir, 'second.gguf'), 'utf8'), 'complete')

  let aborted = true
  const https = { get: (_url, onResponse) => {
    const request = new PassThrough()
    request.setTimeout = () => request
    setImmediate(() => {
      const response = new PassThrough()
      response.statusCode = 200
      response.headers = { 'content-length': '4' }
      onResponse(response)
      response.write(Buffer.from('GG'))
      if (aborted) response.destroy(new Error('network disconnected'))
      else response.end(Buffer.from('UF'))
    })
    return request
  } }
  const downloads = load('src/main/modelDownload.ts', {
    fs, 'fs/promises': fs.promises, path, https: { default: https }, 'stream/promises': { pipeline }
  })
  const modelDir = path.join(fixture, 'models')
  let events = []
  await downloads.downloadMissingModels(modelDir, 'reflection.gguf', 'embedding.gguf', value => events.push(value))
  assert.equal(events.filter(event => event.error).length, 2)
  assert.equal(fs.existsSync(path.join(modelDir, 'reflection.gguf')), false)
  assert.equal(fs.existsSync(path.join(modelDir, 'reflection.gguf.part')), false)
  aborted = false
  events = []
  await downloads.downloadMissingModels(modelDir, 'reflection.gguf', 'embedding.gguf', value => events.push(value))
  assert.equal(fs.readFileSync(path.join(modelDir, 'reflection.gguf'), 'utf8'), 'GGUF')
  assert.equal(events.filter(event => event.done && !event.error).length, 2, 'retry completes both clean downloads')
  console.log('Backend regressions passed: storage validation, atomic settings, failed model moves, interrupted downloads and retry.')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}
