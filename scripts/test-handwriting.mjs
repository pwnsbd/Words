import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'words-handwriting-'))
function load(file, deps) {
  const exports = {}
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  runInNewContext(output, { exports, console, Buffer, URL, process: { env: {} }, require: id => {
    assert(id in deps, `Unexpected dependency ${id}`)
    return deps[id]
  } })
  return exports
}

try {
  const electron = { app: { getPath: () => fixture } }
  const types = load('src/shared/types.ts', {})
  const settings = load('src/main/settings.ts', {
    electron, path, fs, '../shared/types': types
  })
  const entries = load('src/main/entries.ts', {
    electron, path, crypto, fs: { promises: fs.promises },
    '../shared/types': types,
    '../shared/textMarkup': load('src/shared/textMarkup.ts', {}),
    './storageValidation': load('src/main/storageValidation.ts', {})
  })

  // Defaults
  assert.deepEqual({ ...settings.getSettings().handwriting },
    { pencil: 'caveat', quill: 'dancing-script', ink: 'kalam' }, 'default handwriting')
  assert.equal(Object.keys(types.HANDWRITING_FONTS).length, 9, 'nine fonts')

  // Validation
  assert.throws(() => settings.updateSettings({ handwriting: { pencil: 'kalam' } }), /Invalid handwriting font/)
  assert.throws(() => settings.updateSettings({ handwriting: { ink: 'nope' } }), /Invalid handwriting font/)
  assert.throws(() => settings.updateSettings({ handwriting: { desk: 'kalam' } }), /Invalid handwriting font/)
  assert.equal(settings.getSettings().handwriting.pencil, 'caveat', 'rejected patch changes nothing')
  const updated = settings.updateSettings({ handwriting: { quill: 'parisienne' } })
  assert.deepEqual({ ...updated.handwriting },
    { pencil: 'caveat', quill: 'parisienne', ink: 'kalam' }, 'partial patch merges')

  // Entries
  const saved = await entries.saveEntry('hello', 'parisienne')
  assert.equal(saved.font, 'parisienne')
  assert.equal((await entries.getEntry(saved.id)).font, 'parisienne', 'font round-trips')
  const bad = await entries.saveEntry('hello', 'comic-sans')
  assert.equal(bad.font, undefined, 'invalid font dropped')
  assert.equal((await entries.getEntry(bad.id)).font, undefined)
  assert.equal((await entries.saveEntry('hello')).font, undefined, 'no font by default')

  console.log('handwriting tests passed')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}
