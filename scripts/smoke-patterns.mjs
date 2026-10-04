// Isolated end-to-end UI check using copies of the 20 generated sample entries.
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url))
const source = join(app.getPath('appData'), 'words', 'entries')
const fixture = mkdtempSync(join(root, '.memory-smoke-patterns-'))
app.setPath('userData', fixture)
app.disableHardwareAcceleration()
process.env.WORDS_MODELS_DIR = join(root, 'models')
mkdirSync(join(fixture, 'entries'))
for (let i = 1; i <= 20; i++) {
  const name = `words-sample-v1-${String(i).padStart(2,'0')}.json`
  assert(existsSync(join(source,name)), 'Run npm run seed:demo first')
  copyFileSync(join(source,name), join(fixture,'entries',name))
}
BrowserWindow.prototype.show = function () {}
const deadline = setTimeout(() => { console.error('Pattern UI test timed out'); app.exit(1) }, 240000)
app.once('browser-window-created', (_event, original) => {
  original.webContents.once('did-finish-load', async () => {
    const win = new BrowserWindow({ show: false, width: 960, height: 760, webPreferences: {
      preload: join(root,'out/preload/index.mjs'), sandbox: false, offscreen: true, backgroundThrottling: false
    } })
    const js = script => win.webContents.executeJavaScript(script)
    const pause = ms => new Promise(resolve => setTimeout(resolve,ms))
    try {
      await win.loadFile(join(root,'out/renderer/index.html'))
      await pause(500)
      const alignment = await js(`(() => {
        const a=document.querySelector('[aria-label="Open patterns"]').getBoundingClientRect();
        const b=document.querySelector('[aria-label="Open your journal"]').getBoundingClientRect();
        return { above: a.bottom < b.top, centered: Math.abs((a.left+a.right-b.left-b.right)/2)<5 }
      })()`)
      assert(alignment.above && alignment.centered, 'Patterns button must be directly above journal')
      writeFileSync(join(fixture,'writing.png'),(await win.webContents.capturePage()).toPNG())
      await js(`document.querySelector('[aria-label="Open patterns"]').click()`)
      let snapshot
      for (let i=0;i<220;i++) {
        await pause(1000)
        snapshot=await js('window.api.listPatterns()')
        if (!snapshot.updating && snapshot.patterns.length) break
        if (snapshot.message && !snapshot.updating) throw new Error(snapshot.message)
      }
      assert(snapshot.patterns.length > 0, 'Real models must identify at least one sample pattern')
      await pause(2400)
      await js(`document.querySelector('.pattern__heading').click()`)
      await pause(300)
      assert(await js(`document.querySelectorAll('.pattern__timeline li').length >= 3`))
      writeFileSync(join(fixture,'patterns.png'),(await win.webContents.capturePage()).toPNG())
      await js(`document.querySelector('.pattern__timeline button').click()`)
      await pause(900)
      assert(await js(`!!document.querySelector('[aria-label="Back to patterns"]') && document.querySelector('.memory-source').innerText.includes('Passage you followed here')`))
      await js(`document.querySelector('[aria-label="Back to patterns"]').click()`)
      await pause(900)
      const dismissedId=snapshot.patterns[0].id
      await js(`document.querySelector('.pattern__dismiss').click()`)
      await pause(400)
      assert(!(await js('window.api.listPatterns()')).patterns.some(p=>p.id===dismissedId))
      await js('window.api.refreshPatterns()')
      await pause(1000)
      assert(!(await js('window.api.listPatterns()')).patterns.some(p=>p.id===dismissedId))
      const report={ passed:true, patterns: snapshot.patterns.map(p=>({title:p.title, description:p.description, entries:p.evidence.length})), fixture }
      writeFileSync(join(fixture,'result.json'),JSON.stringify(report,null,2))
      console.log(JSON.stringify(report,null,2))
      clearTimeout(deadline)
      app.exit(0)
    } catch(error) { console.error(error); app.exit(1) }
  })
})
await import('../out/main/index.js')
