import { app, BrowserWindow } from 'electron'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
app.disableHardwareAcceleration()
const root = fileURLToPath(new URL('../', import.meta.url))
const fixture = mkdtempSync(join(root, '.memory-smoke-'))
app.setPath('userData', fixture)
process.env.WORDS_MODELS_DIR = join(root, 'models')
process.env.WORDS_GPU_LAYERS = '0'
writeFileSync(join(fixture, 'settings.json'), JSON.stringify({ reflectionModel: 'existing', embeddingModel: 'qwen' }))
mkdirSync(join(fixture, 'entries'))
writeFileSync(join(fixture, 'entries', 'past.json'), JSON.stringify({ id: 'past', createdAt: '2025-01-01T12:00:00.000Z', text: 'A journal could remind me of earlier ideas even when I describe them differently.' }))
BrowserWindow.prototype.show = function () {}
const deadline = setTimeout(() => { console.error('Smoke test timed out'); app.exit(1) }, 45000)
app.once('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load', async () => {
    try {
      await win.webContents.executeJavaScript(`new Promise(resolve => setTimeout(resolve, 300))`)
      await win.webContents.executeJavaScript(`(() => {
        const editor = document.querySelector('[role="textbox"]');
        const data = new DataTransfer();
        data.setData('text/plain', 'I want my notebook to recognize a thought I had months ago despite different wording.');
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
      })()`)
      await win.webContents.executeJavaScript(`new Promise(resolve => setTimeout(resolve, 100))`)
      await win.webContents.executeJavaScript(`document.querySelector('[role="textbox"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))`)
      const text = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const start = Date.now();
        const poll = () => {
          const match = document.querySelector('.resurfaced button');
          if (match) return resolve(document.querySelector('.afterthought').innerText);
          if (Date.now() - start > 25000) return reject(new Error('No memory link surfaced'));
          setTimeout(poll, 150);
        }; poll();
      })`)
      assert(text.includes('a similar thought'))
      assert(text.includes('A journal could remind'))
      await win.webContents.executeJavaScript(`document.querySelector('.resurfaced button').click()`)
      await win.webContents.executeJavaScript(`new Promise(resolve => setTimeout(resolve, 900))`)
      const read = await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Entry"]').innerText`)
      assert(read.includes('Passage you followed here'))
      assert(read.includes('A journal could remind'))
      writeFileSync(join(fixture, 'result.json'), JSON.stringify({ passed: true, checks: ['save', 'real-model match', 'source link', 'source passage'], read }, null, 2))
      console.log('Electron smoke passed: paste, save, real-model match, source link, source passage. Results:', join(fixture, 'result.json'))
      clearTimeout(deadline)
      app.exit(0)
    } catch (error) { console.error(error); app.exit(1) }
  })
})
await import('../out/main/index.js')
