import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { dirname, join, basename } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { readFile, stat, mkdir, rename, copyFile, rm } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  saveEntry,
  importEntry,
  updateEntry,
  deleteEntry,
  listEntries,
  getEntry,
  loadAllEntries,
  getRecentReflections,
  getReflectionsForPeriod,
  THEME_MIN_ENTRIES,
  RECAP_MIN_ENTRIES
} from './entries'
import {
  reflect,
  surfaceTheme,
  writeRecap,
  writeLetterForTimeframe,
  describeModelStatus,
  modelPaths,
  resetModelContexts
} from './llamacpp'
import { saveLetter, listLetters, getLetter, deleteLetter } from './letters'
import type { LetterTimeframe } from '../shared/types'
import { listPatterns, dismissPattern, refreshPatterns, invalidatePatternsForEntry } from './patterns'
import { modelJob, findMemories, rebuildMemory } from './memory'
import { downloadMissingModels } from './modelDownload'
import { getSettings, updateSettings } from './settings'
import { stripStruckMarkup } from '../shared/textMarkup'

const THEME_BACKGROUND: Record<'light' | 'dark', string> = {
  light: '#f4ecdc',
  dark: '#2a2723'
}

// ESM has no __dirname — this is the standard replacement.
const __dirname = dirname(fileURLToPath(import.meta.url))

// A YYYY-MM-DD anywhere in the filename (common in journal exports, e.g.
// "2019-03-14.txt" or "entry-2019-03-14-morning.md") wins over the file's
// last-modified date for backdating an imported entry.
function dateFromFilename(filename: string): string | null {
  const match = filename.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0)
  return isNaN(date.getTime()) ? null : date.toISOString()
}

function computePeriod(date: Date, timeframe: LetterTimeframe): { label: string; start: string; end: string } {
  if (timeframe === 'week') {
    const d = date.getDay()
    const sunday = new Date(date)
    sunday.setDate(date.getDate() - d)
    sunday.setHours(0, 0, 0, 0)
    const saturday = new Date(sunday)
    saturday.setDate(sunday.getDate() + 6)
    saturday.setHours(23, 59, 59, 999)
    return {
      label: `Week of ${sunday.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
      start: sunday.toISOString(),
      end: saturday.toISOString()
    }
  }
  if (timeframe === 'month') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1)
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
    return {
      label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      start: start.toISOString(),
      end: end.toISOString()
    }
  }
  const start = new Date(date.getFullYear(), 0, 1)
  const end = new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999)
  return { label: String(date.getFullYear()), start: start.toISOString(), end: end.toISOString() }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 760,
    minWidth: 640,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    // Read directly (not via IPC) since this has to be known before the
    // window — and the renderer that would otherwise report it — exists,
    // so a dark-theme user doesn't get a flash of the light background.
    backgroundColor: THEME_BACKGROUND[getSettings().theme],
    // Packaged builds pick up build.win.icon (package.json) for the exe/
    // installer icon; this covers dev mode, where the window would
    // otherwise show Electron's default icon instead of ours.
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Broadcasts to every open window rather than one event.sender -- both the
// automatic startup kickoff (no renderer request behind it at all) and the
// manual retry button in Settings share this, and either way any window
// that's open should see progress, not just whichever one triggered it.
let downloadInFlight = false
function runModelDownload(): void {
  if (downloadInFlight) return
  downloadInFlight = true
  const { dir, reflectionFile, embeddingFile } = modelPaths()
  void downloadMissingModels(dir, reflectionFile, embeddingFile, (progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('models:download-progress', progress)
    }
  }).finally(() => {
    downloadInFlight = false
  })
}

// Moves whichever model files exist from one folder to another -- used when
// the user re-points the models folder in Settings, so they don't have to
// shift ~5GB by hand or re-download it. rename() first (instant on the same
// volume); copy-then-delete across volumes. Best effort: a file already at
// the destination, or one that fails to move, is just left -- the app fills
// any gap on the next runModelDownload().
async function relocateModelFiles(fromDir: string, toDir: string, filenames: string[]): Promise<void> {
  if (!fromDir || !toDir || fromDir === toDir) return
  await mkdir(toDir, { recursive: true })
  for (const name of filenames) {
    const src = join(fromDir, name)
    const dest = join(toDir, name)
    if (!existsSync(src) || existsSync(dest)) continue
    try {
      await rename(src, dest)
    } catch {
      try {
        await copyFile(src, dest)
        await rm(src, { force: true })
      } catch (err) {
        console.error('[words] could not move model file:', name, err)
      }
    }
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.words.journal')

  const modelStatus = describeModelStatus()
  console.log(`[words] models dir: ${modelStatus.modelsDir}`)
  console.log(
    `[words] reflection model: ${modelStatus.reflectionModelFound ? 'found' : 'NOT found — entries will save without a reflection'}`
  )
  console.log(
    `[words] embedding model: ${modelStatus.embeddingModelFound ? 'found' : 'NOT found — entries will save without an embedding'}`
  )

  // First run (and any later run where the files still aren't in place):
  // fetch the models automatically, in the background. No prompt -- the
  // writing surface shows a quiet "setting up local models" line while it
  // runs and is never blocked. downloadMissingModels() skips whichever
  // file is already present, so this is a no-op once both are down.
  if ((modelStatus.reflectionEnabled && !modelStatus.reflectionModelFound) || !modelStatus.embeddingModelFound) {
    runModelDownload()
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('entries:save', async (event, text: string) => {
    const entry = await saveEntry(text)

    // Reflect + embed in the background. The writer never waits on this —
    // save returns immediately with just the saved entry. When (if) the
    // local model responds, we quietly push the reflection to the window,
    // and — only if a genuinely similar old entry exists — a resurfaced
    // memory a beat after that.
    // Memory retrieval does not wait for reflection generation.
    void modelJob(async () => {
      const matches = await findMemories(entry.id)
      if (!event.sender.isDestroyed()) {
        event.sender.send('entries:resurfaced', { id: entry.id, matches })
      }
    }).catch((err) => console.error('[words] memory lookup failed:', err))
    void modelJob(async () => {
      const reflected = await reflect(stripStruckMarkup(entry.text))
      if (reflected) {
        await updateEntry(entry.id, reflected)
        if (!event.sender.isDestroyed()) {
          event.sender.send('entries:reflection', { id: entry.id, reflection: reflected.reflection })
        }
      }
    }).catch((err) => console.error('[words] reflection job failed:', err))
    refreshPatterns()


    return entry
  })

  // Listen again: re-run the reflection (and mood mark) for a saved entry.
  // The text never changes. If the model is off, missing, or fails, the
  // previous reflection stays and this resolves null. A second call while
  // one is already running for the same entry is ignored.
  const regenerating = new Set<string>()
  ipcMain.handle('entries:regenerateReflection', async (event, id: string) => {
    const status = describeModelStatus()
    if (!status.reflectionEnabled || !status.reflectionModelFound) return null
    if (regenerating.has(id)) return null
    regenerating.add(id)
    try {
      return await modelJob(async () => {
        const entry = await getEntry(id)
        if (!entry) return null
        const reflected = await reflect(stripStruckMarkup(entry.text))
        if (!reflected) return null
        await updateEntry(id, reflected)
        if (!event.sender.isDestroyed()) {
          event.sender.send('entries:reflection', { id, reflection: reflected.reflection })
        }
        return await getEntry(id)
      })
    } catch (err) {
      console.error('[words] regenerate reflection failed:', err)
      return null
    } finally {
      regenerating.delete(id)
    }
  })

  ipcMain.handle('entries:memories', (_event, id: string) => modelJob(() => findMemories(id)))
  ipcMain.handle('memory:rebuild', () => modelJob(async () => {
    const result = await rebuildMemory(true)
    refreshPatterns()
    return result
  }))
  ipcMain.handle('patterns:list', () => listPatterns())
  ipcMain.handle('patterns:refresh', () => refreshPatterns())
  ipcMain.handle('patterns:dismiss', (_event, id: string) => dismissPattern(id))

  ipcMain.handle('entries:list', async () => listEntries())

  ipcMain.handle('entries:get', async (_event, id: string) => getEntry(id))

  // No entries:edit handler — entries are permanent once saved. Delete is
  // the only way to change your mind about one.
  ipcMain.handle('entries:delete', async (_event, id: string) => {
    await deleteEntry(id)
    await invalidatePatternsForEntry(id)
    refreshPatterns()
  })

  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:update', (_event, patch) => updateSettings(patch))

  ipcMain.handle('models:status', () => describeModelStatus())

  // Manual retry/re-trigger from Settings -- the same download also starts
  // automatically below if a model's missing at launch; this just lets
  // someone retry after a failure (or after deleting a model file) without
  // restarting the app.
  ipcMain.handle('models:download', () => {
    runModelDownload()
  })

  // Lets the user move the two GGUF files to a folder of their choosing --
  // e.g. off the system drive. The existing files are moved there (not
  // re-downloaded); settings.modelsDir is repointed and the warm contexts
  // dropped so the next reflection loads from the new spot without a
  // restart. Anything still missing afterward is downloaded. Returns the
  // refreshed model status; returns null if the picker was cancelled.
  ipcMain.handle('models:choose-dir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose a folder for the local model files',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Use this folder',
      defaultPath: app.getPath('home')
    }
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) return null

    if (downloadInFlight) return null
    return modelJob(async () => {
      const target = result.filePaths[0]
      const current = modelPaths()
      await relocateModelFiles(current.dir, target, [current.reflectionFile, current.embeddingFile])
      updateSettings({ modelsDir: target })
      await resetModelContexts()
      const status = describeModelStatus()
      if ((status.reflectionEnabled && !status.reflectionModelFound) || !status.embeddingModelFound) runModelDownload()
      return status
    })
  })

  // Clears a chosen folder and moves the files back to the built-in default
  // location. Same move + context-reset + status contract as choose-dir.
  ipcMain.handle('models:reset-dir', () => modelJob(async () => {
    if (downloadInFlight) return describeModelStatus()
    const current = modelPaths()
    updateSettings({ modelsDir: null })
    const target = modelPaths().dir
    await relocateModelFiles(current.dir, target, [current.reflectionFile, current.embeddingFile])
    await resetModelContexts()
    const status = describeModelStatus()
    if ((status.reflectionEnabled && !status.reflectionModelFound) || !status.embeddingModelFound) runModelDownload()
    return status
  }))

  // Only attempted when the journal view is actually opened (never on the
  // writing surface, never on a timer) and only if there's enough recent
  // material for a "recurring" theme to mean anything. Returns null (no
  // model call at all) otherwise — this should never manufacture something
  // to say.
  ipcMain.handle('entries:theme', async () => {
    const recent = await getRecentReflections()
    if (recent.length < THEME_MIN_ENTRIES) return null
    return modelJob(() => surfaceTheme(recent))
  })

  // Same "only if there's genuinely enough to say something" gate as theme
  // surfacing — this is requested on demand (see the journal view), never
  // generated proactively.
  ipcMain.handle('entries:recap', async () => {
    const recent = await getRecentReflections()
    if (recent.length < RECAP_MIN_ENTRIES) return null
    return modelJob(() => writeRecap(recent))
  })

  ipcMain.handle('letters:generate', async (
    _event,
    timeframe: LetterTimeframe,
    periodLabel: string,
    periodStart: string,
    periodEnd: string
  ) => {
    const reflections = await getReflectionsForPeriod(periodStart, periodEnd)
    if (reflections.length < RECAP_MIN_ENTRIES) return null
    const content = await modelJob(() => writeLetterForTimeframe(reflections, timeframe))
    if (!content) return null
    return saveLetter(timeframe, periodLabel, periodStart, periodEnd, content)
  })

  ipcMain.handle('letters:list', (_event, timeframe?: LetterTimeframe) => listLetters(timeframe))
  ipcMain.handle('letters:get', (_event, id: string) => getLetter(id))
  ipcMain.handle('letters:delete', (_event, id: string) => deleteLetter(id))

  ipcMain.handle('letters:next-period', async (_event, timeframe: LetterTimeframe) => {
    const entries = await loadAllEntries()
    const withReflection = entries.filter((e) => e.reflection)
    if (withReflection.length === 0) return null

    const periods = new Map<string, { label: string; start: string; end: string; count: number }>()
    for (const entry of withReflection) {
      const period = computePeriod(new Date(entry.createdAt), timeframe)
      const prev = periods.get(period.start)
      if (prev) prev.count++
      else periods.set(period.start, { ...period, count: 1 })
    }

    const existing = await listLetters(timeframe)
    const coveredStarts = new Set(existing.map((l) => l.periodStart))

    const available = [...periods.values()]
      .filter((p) => !coveredStarts.has(p.start) && p.count >= RECAP_MIN_ENTRIES)
      .sort((a, b) => a.start.localeCompare(b.start))

    if (available.length === 0) return null
    return { label: available[0].label, start: available[0].start, end: available[0].end }
  })

  // Plain text/markdown files only for v1 — one file per entry. Each is
  // embedded (so resurfacing/search can reach old material) but skips
  // reflection/mood generation: that's a live "just wrote this" response,
  // not something worth manufacturing after the fact for a bulk import,
  // and it keeps importing years of entries fast.
  ipcMain.handle('entries:import-files', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: OpenDialogOptions = {
      title: 'Import old journal entries',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Text files', extensions: ['txt', 'md'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled) return { imported: 0 }

    let imported = 0
    for (const filePath of result.filePaths) {
      try {
        const text = (await readFile(filePath, 'utf-8')).trim()
        if (!text) continue
        const fileStat = await stat(filePath)
        const createdAt = dateFromFilename(basename(filePath)) ?? fileStat.mtime.toISOString()
        const entry = await importEntry(text, createdAt)
        await modelJob(() => findMemories(entry.id))
        imported++
      } catch (err) {
        // Note: keep "import" out of the tail end of this message — a
        // bundler quirk (electron-vite's CJS-shim import scanner, a regex
        // not a real parser) misreads a string literal ending in the bare
        // word "import" as the start of a side-effect `import "..."`
        // statement and corrupts the build looking for its closing quote.
        console.error('[words] could not import file:', filePath, err)
      }
    }
    if (imported) refreshPatterns()
    return { imported }
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
