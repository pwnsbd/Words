import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { dirname, join, basename } from 'path'
import { fileURLToPath } from 'url'
import { readFile, stat } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  saveEntry,
  importEntry,
  updateEntry,
  deleteEntry,
  listEntries,
  getEntry,
  findResurfacedEntry,
  getRecentReflections,
  THEME_MIN_ENTRIES,
  RECAP_MIN_ENTRIES
} from './entries'
import { reflect, embed, surfaceTheme, writeRecap, describeModelStatus, modelPaths } from './llamacpp'
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

  // No automatic download kicked off here -- a ~5GB download deserves a
  // yes/no first. The renderer shows a one-time consent banner on the
  // write page when a model's missing and settings.modelDownloadAsked is
  // still false; "download" there (or the manual button in Settings)
  // calls the same models:download handler below either way.

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
    void (async () => {
      // Struck (crossed-out) text is a marked mistake, not part of what the
      // writer meant to say -- the model should read the entry as if it
      // wasn't there, same as previews elsewhere.
      const cleanText = stripStruckMarkup(entry.text)
      const [reflected, embedding] = await Promise.all([reflect(cleanText), embed(cleanText)])
      if (reflected || embedding) {
        await updateEntry(entry.id, {
          ...(reflected ? { reflection: reflected.reflection, mood: reflected.mood } : {}),
          ...(embedding ? { embedding } : {})
        })
      }
      if (!event.sender.isDestroyed()) {
        if (reflected) {
          event.sender.send('entries:reflection', { id: entry.id, reflection: reflected.reflection })
        }
        if (embedding) {
          const resurfaced = await findResurfacedEntry(embedding, entry.id)
          if (resurfaced && !event.sender.isDestroyed()) {
            event.sender.send('entries:resurfaced', resurfaced)
          }
        }
      }
    })()

    return entry
  })

  ipcMain.handle('entries:list', async () => listEntries())

  ipcMain.handle('entries:get', async (_event, id: string) => getEntry(id))

  // No entries:edit handler — entries are permanent once saved. Delete is
  // the only way to change your mind about one.
  ipcMain.handle('entries:delete', async (_event, id: string) => {
    await deleteEntry(id)
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

  // Only attempted when the journal view is actually opened (never on the
  // writing surface, never on a timer) and only if there's enough recent
  // material for a "recurring" theme to mean anything. Returns null (no
  // model call at all) otherwise — this should never manufacture something
  // to say.
  ipcMain.handle('entries:theme', async () => {
    const recent = await getRecentReflections()
    if (recent.length < THEME_MIN_ENTRIES) return null
    return surfaceTheme(recent)
  })

  // Same "only if there's genuinely enough to say something" gate as theme
  // surfacing — this is requested on demand (see the journal view), never
  // generated proactively.
  ipcMain.handle('entries:recap', async () => {
    const recent = await getRecentReflections()
    if (recent.length < RECAP_MIN_ENTRIES) return null
    return writeRecap(recent)
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
        const embedding = await embed(entry.text)
        if (embedding) await updateEntry(entry.id, { embedding })
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
