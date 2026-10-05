// Isolated renderer regression: no journal access, model downloads, or inference.
import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixture = mkdtempSync(join(root, '.release-smoke-'))
app.setPath('userData', join(fixture, 'profile'))
app.disableHardwareAcceleration()
const preload = join(fixture, 'preload.cjs')
writeFileSync(preload, `
const { contextBridge, ipcRenderer } = require('electron');
const settings = { theme: 'light', writingMode: 'quill', quillDeleteLimit: 5, resurfaceSensitivity: 'balanced' };
contextBridge.exposeInMainWorld('api', {
  getSettings: async () => settings,
  updateSettings: async patch => Object.assign(settings, patch),
  getModelStatus: async () => ({ reflectionEnabled: true, reflectionModelFound: true, embeddingModelFound: true }),
  listEntries: async () => [],
  onReflection: () => () => {}, onResurfaced: () => () => {}, onDownloadProgress: () => () => {},
  saveEntry: text => ipcRenderer.invoke('test:save', text)
});`)
let failSave = true
let saveCalls = 0
let savedText = ''
ipcMain.handle('test:save', async (_event, text) => {
  saveCalls++
  await new Promise(resolve => setTimeout(resolve, 250))
  if (failSave) throw new Error('Simulated disk failure')
  savedText = text
  return { id: 'saved', text, createdAt: new Date().toISOString() }
})
const deadline = setTimeout(() => { console.error('Release smoke timed out'); app.exit(1) }, 30000)
async function run() {
await app.whenReady()
const win = new BrowserWindow({ show: false, width: 1000, height: 800,
  webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
const js = code => win.webContents.executeJavaScript(code)
const pause = () => js('new Promise(resolve => setTimeout(resolve, 100))')
async function load() {
  await win.loadFile(join(root, 'out/renderer/index.html'))
  await pause()
}
async function paste(text) {
  await js(`(() => { const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(text)});
    document.querySelector('[role="textbox"]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true })); })()`)
  await pause()
}
const key = key => js(`document.querySelector('[role="textbox"]').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`)
const save = () => js(`document.querySelector('[role="textbox"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))`)
try {
  await load()
  await paste('Keep this thought extra')
  await key('Backspace')
  await pause()
  let draft = await js(`JSON.parse(localStorage.getItem('words.unsaved-draft.v1'))`)
  assert.equal(draft.remainingDeletes, 4)
  await load()
  assert((await js(`document.querySelector('[role="textbox"]').textContent`)).includes('Keep this thought '))
  await key('Backspace')
  await pause()
  draft = await js(`JSON.parse(localStorage.getItem('words.unsaved-draft.v1'))`)
  assert.equal(draft.remainingDeletes, 3, 'Correction budget must survive reload')
  await save()
  await js('new Promise(resolve => setTimeout(resolve, 400))')
  assert((await js(`document.querySelector('[role="alert"]').textContent`)).includes('could not be saved'))
  assert((await js(`document.querySelector('[role="textbox"]').textContent`)).includes('Keep this '))
  failSave = false
  await save()
  await save()
  await paste('must not disappear during save')
  await js('new Promise(resolve => setTimeout(resolve, 350))')
  assert.equal(saveCalls, 2, 'Repeated submit must not create duplicate entries')
  assert.equal(savedText, 'Keep this')
  assert.equal(await js(`localStorage.getItem('words.unsaved-draft.v1')`), null)
  assert((await js(`document.querySelector('.write__footer').textContent`)).includes('saved'))
  await paste('Next entry')
  await load()
  assert((await js(`document.querySelector('[role="textbox"]').textContent`)).includes('Next entry'))
  await js(`localStorage.setItem('words.unsaved-draft.v1', '{broken')`)
  await load()
  assert(await js(`!!document.querySelector('.write__editor-placeholder')`))
  await win.capturePage().then(image => writeFileSync(join(fixture, 'write.png'), image.toPNG()))
  console.log('Release renderer smoke passed: draft recovery, correction budget, failed-save retention, duplicate-save guard, save feedback, next draft and malformed recovery data.')
  console.log('Isolated artifacts:', fixture)
  clearTimeout(deadline)
  app.exit(0)
} catch (error) { console.error(error); app.exit(1) }
}
void run().catch(error => { console.error(error); app.exit(1) })
