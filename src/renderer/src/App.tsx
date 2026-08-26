import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  EntrySummary,
  JournalEntry,
  Settings,
  ModelStatus,
  ResurfaceSensitivity,
  WritingMode,
  ModelKey,
  DownloadProgress
} from '../../shared/types'
import { parseRuns, serializeRuns } from '../../shared/textMarkup'

type View = 'write' | 'journal' | 'read' | 'recap' | 'settings'
type TurnPhase = 'idle' | 'leaving' | 'entering'
type Char = { ch: string; struck: boolean }

const RESURFACE_SENSITIVITY_OPTIONS: { value: ResurfaceSensitivity; label: string }[] = [
  { value: 'rare', label: 'rarely' },
  { value: 'balanced', label: 'sometimes' },
  { value: 'often', label: 'often' }
]

const WRITING_MODE_ORDER: WritingMode[] = ['pencil', 'quill', 'ink']

// The dial's three snap positions, in CSS-rotation degrees (0 = needle
// pointing straight up, increasing clockwise) -- evenly spaced 120° apart
// starting from the top, like a three-way rotary switch.
const MODE_ANGLE: Record<WritingMode, number> = { pencil: 0, quill: 120, ink: 240 }

// Tick-mark positions matching MODE_ANGLE above, as percentages inside the
// dial's own box -- precomputed rather than done with trig in the render,
// since there are only ever these three fixed points.
const MODE_TICK_POSITION: Record<WritingMode, { left: string; top: string }> = {
  pencil: { left: '50%', top: '5%' },
  quill: { left: '89%', top: '73%' },
  ink: { left: '11%', top: '73%' }
}

// Traffic-light meaning (green/yellow/red), themed to match the app's
// palette -- see --mode-easy/medium/hard in styles.css. pencil is the most
// forgiving (green), ink the least (red).
const MODE_COLOR: Record<WritingMode, string> = {
  pencil: 'var(--mode-easy)',
  quill: 'var(--mode-medium)',
  ink: 'var(--mode-hard)'
}

// How many real deletions a fresh entry starts with under each mode.
// pencil: unlimited. quill: a user-tunable budget (settings.quillDeleteLimit).
// ink: none -- every delete strikes, from the very first keystroke.
function budgetForMode(mode: WritingMode, quillLimit: number): number {
  if (mode === 'pencil') return Infinity
  if (mode === 'quill') return quillLimit
  return 0
}

// Same threshold the backend gates entries:recap behind — used here only to
// decide whether the "a letter from the past month" link is worth showing
// at all, so it's never offered when it can't produce anything.
const RECAP_MIN_ENTRIES = 5

function timeOfDayPhrase(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'this morning'
  if (hour >= 12 && hour < 17) return 'this afternoon'
  if (hour >= 17 && hour < 21) return 'this evening'
  return 'tonight' // late evening through early morning — the core "pour out your day" hours
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(iso))
}

function formatGB(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)}GB`
}

const MODEL_LABEL: Record<ModelKey, string> = { reflection: 'reflection model', embedding: 'embedding model' }

// No separate chart — the mood reading sits right beside the entry it
// belongs to, as a small mark rather than a number: denser/more present for
// a heavier day, fainter/airier for a lighter one (echoes the wax-seal
// stamps from the brief — "murky for heavy days, open/airy for light days"
// — until that's actually built).
function moodMarkOpacity(mood: number): number {
  const normalized = (mood + 2) / 4 // -2..2 -> 0..1
  return 1 - normalized * 0.65 // 1.0 (heavy) down to 0.35 (light)
}

// The engraving in the middle of the wax seal -- a compact version of the
// app's own pen-and-ink-trail icon mark (resources/icon.svg: a diagonal
// nib stroke with a small curled flourish at the top), not an arbitrary
// squiggle. Same signet pressed every time, on purpose -- that consistency
// is what makes it read as a *seal* rather than incidental decoration.
const SEAL_EMBLEM_PATH = 'M40 22 L26 40 M40 22 C45 17 52 18 53 23 C54 28 48 31 44 28'

// The brief's wax-seal stamp: "murky for heavy days, open/airy for light
// days". Procedural (SVG + CSS color-mix), not a generated image -- no new
// model, no download, no VRAM to share with the two already loaded, and
// it's something I can actually verify by reading the code rather than
// guessing at what a diffusion model would draw. A real local image-gen
// model was considered and explicitly set aside for now (see git history
// on this comment) in favor of investing in this looking more deliberate.
//
// A turbulence filter distorts a plain circle into an organic, slightly
// uneven blob (real wax seals are never perfect circles), reused for the
// base fill, a pressed-rim shadow, and a soft gloss highlight so all three
// share the same edge. Mood drives more than color here: the color blends
// between --seal-heavy and --seal-light (both theme-aware), but the edge
// itself gets rougher/more irregular on heavy days and smoother/more even
// on light ones -- "murky" and "open" as shape, not just hue.
function WaxSeal({ mood }: { mood?: number }): JSX.Element {
  const uid = useId()
  const filterId = `${uid}-turb`
  const sheenId = `${uid}-sheen`
  const rimId = `${uid}-rim`
  // mood -2 (heaviest) -> 100% heavy; mood 2 (lightest) -> 0% heavy.
  // Undefined mood (no reflection yet) sits at a neutral, unstamped 50/50.
  const heavyPct = mood !== undefined ? ((2 - mood) / 4) * 100 : 50
  // Same -2..2 -> 0..1 scale, driving edge roughness instead of color:
  // 3 (smooth, almost circular) on the lightest days up to 9 (rough,
  // uneven) on the heaviest.
  const edgeScale = mood !== undefined ? 3 + ((2 - mood) / 4) * 6 : 6

  return (
    <div
      className={`scroll__seal ${mood === undefined ? 'scroll__seal--unset' : ''}`}
      style={{ ['--seal-mix' as string]: `${heavyPct}%` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" className="scroll__seal-svg">
        <defs>
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence type="fractalNoise" baseFrequency="0.02 0.028" numOctaves={2} seed={7} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={edgeScale} />
          </filter>
          <radialGradient id={sheenId} cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="55%" stopColor="#fff" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          {/* The raised lip real pressed wax has -- darkest near the rim,
              clear in the middle and right at the very edge. */}
          <radialGradient id={rimId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#000" stopOpacity="0" />
            <stop offset="72%" stopColor="#000" stopOpacity="0" />
            <stop offset="88%" stopColor="#000" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.05" />
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="25" className="scroll__seal-blob" style={{ filter: `url(#${filterId})` }} />
        <circle cx="32" cy="32" r="25" fill={`url(#${rimId})`} style={{ filter: `url(#${filterId})` }} />
        <circle cx="32" cy="32" r="25" fill={`url(#${sheenId})`} style={{ filter: `url(#${filterId})` }} />
        <path className="scroll__seal-emblem scroll__seal-emblem--shadow" d={SEAL_EMBLEM_PATH} />
        <path className="scroll__seal-emblem scroll__seal-emblem--highlight" d={SEAL_EMBLEM_PATH} />
      </svg>
    </div>
  )
}

// A past entry (or the monthly letter) unrolled as a parchment scroll,
// rather than plain text on the page background — reinforces the "journal
// as physical object" feeling the page-flip already leans on.
function ScrollFrame({
  mood,
  showSeal = true,
  children
}: {
  mood?: number
  showSeal?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="scroll">
      <div className="scroll__rod scroll__rod--top" aria-hidden="true" />
      <div className="scroll__content">
        {children}
        {showSeal && <WaxSeal mood={mood} />}
      </div>
      <div className="scroll__rod scroll__rod--bottom" aria-hidden="true" />
    </div>
  )
}

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('write')
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('idle')
  // Settings is reachable from both the write page and the journal view --
  // its back arrow should return wherever it was opened from, not always
  // to one fixed place.
  const [settingsOrigin, setSettingsOrigin] = useState<'write' | 'journal'>('write')
  const [chars, setChars] = useState<Char[]>([])
  const [remainingDeletes, setRemainingDeletes] = useState<number>(Infinity)
  const [editorFocused, setEditorFocused] = useState(false)
  const [journalIconActive, setJournalIconActive] = useState(false)
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null)
  const [reflection, setReflection] = useState<string | null>(null)
  const [resurfaced, setResurfaced] = useState<EntrySummary | null>(null)
  const [saving, setSaving] = useState(false)
  const [entries, setEntries] = useState<EntrySummary[] | null>(null)
  const [theme, setTheme] = useState<string | null>(null)
  const [readEntry, setReadEntry] = useState<JournalEntry | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  // undefined = still gathering, null = backend decided there wasn't enough
  // to write, string = the letter itself
  const [recap, setRecap] = useState<string | null | undefined>(undefined)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<Partial<Record<ModelKey, DownloadProgress>>>({})
  const [greeting] = useState(timeOfDayPhrase) // fixed for the session, not recomputed every render
  const editorRef = useRef<HTMLDivElement>(null)
  const dialRef = useRef<HTMLDivElement>(null)
  const [dialRotation, setDialRotation] = useState(0)
  const [dialDragging, setDialDragging] = useState(false)

  useEffect(() => {
    editorRef.current?.focus()
  }, [])

  useEffect(() => {
    void window.api.getSettings().then((loaded) => {
      setSettings(loaded)
      document.documentElement.setAttribute('data-theme', loaded.theme)
      setRemainingDeletes(budgetForMode(loaded.writingMode, loaded.quillDeleteLimit))
      setDialRotation(MODE_ANGLE[loaded.writingMode])
    })
    // Needed on the write page too now, not just Settings -- deciding
    // whether to show the one-time model-download consent banner requires
    // knowing model status right from the start.
    void window.api.getModelStatus().then(setModelStatus)
  }, [])

  // Keeps the dial's needle synced to the current mode whenever it changes
  // some other way (keyboard, or settings loading) -- but never fights an
  // in-progress drag, which is driving the needle directly.
  useEffect(() => {
    if (!settings || dialDragging) return
    setDialRotation(MODE_ANGLE[settings.writingMode])
  }, [settings?.writingMode, dialDragging])

  // Angle (in the same 0=up/clockwise convention as MODE_ANGLE) from the
  // dial's center to a pointer position -- the core of "grab the knob and
  // turn it": the needle just always points straight at the pointer.
  function angleFromPointer(clientX: number, clientY: number): number {
    const el = dialRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const raw = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI + 90
    return ((raw % 360) + 360) % 360
  }

  function nearestMode(angle: number): WritingMode {
    let best: WritingMode = 'pencil'
    let bestDiff = Infinity
    for (const mode of WRITING_MODE_ORDER) {
      const target = MODE_ANGLE[mode]
      const diff = Math.min(Math.abs(angle - target), 360 - Math.abs(angle - target))
      if (diff < bestDiff) {
        bestDiff = diff
        best = mode
      }
    }
    return best
  }

  function handleDialPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    dialRef.current?.focus()
    setDialDragging(true)
    setDialRotation(angleFromPointer(e.clientX, e.clientY))
  }

  useEffect(() => {
    if (!dialDragging) return
    function handleMove(e: PointerEvent): void {
      setDialRotation(angleFromPointer(e.clientX, e.clientY))
    }
    function handleUp(e: PointerEvent): void {
      const mode = nearestMode(angleFromPointer(e.clientX, e.clientY))
      setDialRotation(MODE_ANGLE[mode])
      setDialDragging(false)
      if (settings && mode !== settings.writingMode) void applySettings({ writingMode: mode })
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialDragging])

  function handleDialKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (!settings) return
    const idx = WRITING_MODE_ORDER.indexOf(settings.writingMode)
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      void applySettings({ writingMode: WRITING_MODE_ORDER[(idx + 1) % WRITING_MODE_ORDER.length] })
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      const prevIdx = (idx - 1 + WRITING_MODE_ORDER.length) % WRITING_MODE_ORDER.length
      void applySettings({ writingMode: WRITING_MODE_ORDER[prevIdx] })
    }
  }

  async function applySettings(patch: Partial<Settings>): Promise<void> {
    const updated = await window.api.updateSettings(patch)
    setSettings(updated)
    document.documentElement.setAttribute('data-theme', updated.theme)
    // Switching the writing mode (or its quill budget) resets the current
    // entry's remaining-deletes count fresh -- the budget is meant to be
    // "how forgiving is this mode", not a pool that survives a mode swap.
    if (patch.writingMode !== undefined || patch.quillDeleteLimit !== undefined) {
      setRemainingDeletes(budgetForMode(updated.writingMode, updated.quillDeleteLimit))
    }
  }

  const plainDraft = useMemo(() => chars.map((c) => c.ch).join(''), [chars])
  const draftRuns = useMemo(() => {
    const runs: { text: string; struck: boolean }[] = []
    for (const c of chars) {
      const last = runs[runs.length - 1]
      if (last && last.struck === c.struck) last.text += c.ch
      else runs.push({ text: c.ch, struck: c.struck })
    }
    return runs
  }, [chars])

  useEffect(() => {
    const unsubscribe = window.api.onReflection(({ id, reflection }) => {
      if (id === savedEntryId) setReflection(reflection)
    })
    return unsubscribe
  }, [savedEntryId])

  useEffect(() => {
    const unsubscribe = window.api.onResurfaced((entry) => {
      setResurfaced(entry)
    })
    return unsubscribe
  }, [])

  // Subscribed from the start (not just while Settings is open) since a
  // download can begin automatically at launch, before anyone's looked at
  // Settings at all -- this way whatever progress already happened is
  // there to see whenever they do.
  useEffect(() => {
    const unsubscribe = window.api.onDownloadProgress((progress) => {
      setDownloadProgress((prev) => ({ ...prev, [progress.key]: progress }))
      if (progress.done && !progress.error) {
        void window.api.getModelStatus().then(setModelStatus)
      }
    })
    return unsubscribe
  }, [])

  async function handleSave(): Promise<void> {
    if (saving) return
    // Trim on the char array (not the serialized string) so a leading/
    // trailing whitespace char that happens to be struck doesn't leave a
    // dangling, now-empty strike marker behind.
    let start = 0
    let end = chars.length
    while (start < end && /\s/.test(chars[start].ch)) start++
    while (end > start && /\s/.test(chars[end - 1].ch)) end--
    const trimmed = chars.slice(start, end)
    if (trimmed.length === 0) return

    setSaving(true)
    setReflection(null)
    setResurfaced(null)
    try {
      const entry = await window.api.saveEntry(serializeRuns(trimmed))
      setSavedEntryId(entry.id)
      setChars([])
      if (settings) setRemainingDeletes(budgetForMode(settings.writingMode, settings.quillDeleteLimit))
      editorRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  // Scanning backward from `fromIndex` (inclusive), skips a trailing run of
  // whitespace and then the word before it -- both only while `removable`
  // holds -- and returns the index the word starts at. Used for both real
  // word-deletion (removable = always true) and striking a whole word at
  // once (removable = not already struck), so "one correction" means the
  // same thing -- a word, plus whatever whitespace trails it -- either way.
  function wordStartBackward(list: Char[], fromIndex: number, removable: (c: Char) => boolean): number {
    let i = fromIndex
    while (i >= 0 && removable(list[i]) && /\s/.test(list[i].ch)) i--
    while (i >= 0 && removable(list[i]) && !/\s/.test(list[i].ch)) i--
    return i + 1
  }

  // The write surface isn't a native <textarea> -- it's a plain focusable
  // div whose visible content is fully derived from `chars`, so that a
  // "delete" can be redirected into a strikethrough instead of an actual
  // removal once a mode's budget runs out. Every handled key is
  // preventDefault()'d before the browser can touch the DOM itself; only
  // `chars` (and therefore React's own render) ever changes what's shown.
  // Trade-off: no native spellcheck/IME composition on this surface, since
  // both need a real input/textarea/contenteditable element underneath.
  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleSave()
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return // don't swallow copy/select-all/etc.

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      if (chars.length === 0) return
      if (reflection) beginNewEntry()
      if (remainingDeletes === Infinity) {
        // Pencil: unrestricted, so there's no "correction" to count in
        // words -- plain single-character backspace, like any editor.
        setChars((prev) => prev.slice(0, -1))
      } else if (remainingDeletes > 0) {
        // Quill, budget remaining: one press removes one whole word (plus
        // its trailing whitespace) -- a "correction" is a word, not a
        // character, so the budget above should count them the same way.
        setChars((prev) => prev.slice(0, wordStartBackward(prev, prev.length - 1, () => true)))
        setRemainingDeletes((r) => r - 1)
      } else if (settings?.writingMode === 'ink') {
        // Ink: striking a word (rather than erasing) is the mode itself,
        // not a fallback -- always available, from the very first
        // backspace. Strikes the most recent not-yet-struck word, all at
        // once; repeated presses walk further back a word at a time.
        setChars((prev) => {
          let i = prev.length - 1
          while (i >= 0 && prev[i].struck) i--
          if (i < 0) return prev
          const start = wordStartBackward(prev, i, (c) => !c.struck)
          const next = [...prev]
          for (let k = start; k <= i; k++) next[k] = { ...next[k], struck: true }
          return next
        })
      }
      // else: quill with its budget spent -- no striking fallback here.
      // Once quill's corrections run out, that's it; the entry is locked
      // for the rest of what you write, same as after it's saved.
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      if (reflection) beginNewEntry()
      setChars((prev) => [...prev, { ch: '\n', struck: false }])
      return
    }

    if (e.key.length === 1) {
      e.preventDefault()
      if (reflection) beginNewEntry()
      setChars((prev) => [...prev, { ch: e.key, struck: false }])
    }
  }

  function handleEditorPaste(e: React.ClipboardEvent<HTMLDivElement>): void {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    if (reflection) beginNewEntry()
    setChars((prev) => [...prev, ...Array.from(text).map((ch) => ({ ch, struck: false }))])
  }

  function turnTo(next: View, entryId?: string): void {
    if (turnPhase !== 'idle') return
    // Capture where we're turning to settings *from* before the view
    // changes, so its back arrow can return there instead of a fixed page.
    if (next === 'settings') setSettingsOrigin(view === 'journal' ? 'journal' : 'write')
    setTurnPhase('leaving')
    window.setTimeout(() => {
      setView(next)
      if (next === 'journal') {
        setTheme(null)
        setImportStatus(null)
        void window.api.listEntries().then(setEntries)
        void window.api.getTheme().then(setTheme)
      }
      if (next === 'read' && entryId) {
        setReadEntry(null)
        setDeleteConfirming(false)
        void window.api.getEntry(entryId).then(setReadEntry)
      }
      if (next === 'recap') {
        setRecap(undefined)
        void window.api.getRecap().then(setRecap)
      }
      if (next === 'settings') {
        void window.api.getModelStatus().then(setModelStatus)
      }
      setTurnPhase('entering')
      window.setTimeout(() => setTurnPhase('idle'), 320)
    }, 280)
  }

  // A little bounce-and-pen-wiggle on the notebook icon before the
  // page-turn to the journal actually starts. See .notebook-icon in
  // styles.css; the timeout here roughly covers the animation's duration.
  function handleOpenJournal(): void {
    setJournalIconActive(true)
    window.setTimeout(() => turnTo('journal'), 380)
  }

  // Ready for a fresh bounce next time, whichever way you got back here.
  useEffect(() => {
    if (view === 'write') setJournalIconActive(false)
  }, [view])

  async function handleDelete(): Promise<void> {
    if (!readEntry) return
    await window.api.deleteEntry(readEntry.id)
    turnTo('journal')
  }

  async function handleImport(): Promise<void> {
    const result = await window.api.importEntries()
    if (result.imported > 0) {
      setImportStatus(`${result.imported} ${result.imported === 1 ? 'entry' : 'entries'} added.`)
      void window.api.listEntries().then(setEntries)
    }
  }

  // Also what the automatic startup download is doing under the hood --
  // this button is really just "start/retry that", visible from Settings.
  function handleDownloadModels(): void {
    setDownloadProgress({})
    void window.api.downloadModels()
  }

  const modelsMissing = modelStatus !== null && (!modelStatus.reflectionModelFound || !modelStatus.embeddingModelFound)
  const showModelConsent = modelsMissing && settings !== null && !settings.modelDownloadAsked

  // The one-time consent decision itself -- either way, modelDownloadAsked
  // flips to true so this banner never shows again; Settings → Local
  // models is always there afterward for a manual download/retry.
  async function handleDownloadConsent(accept: boolean): Promise<void> {
    await applySettings({ modelDownloadAsked: true })
    if (accept) handleDownloadModels()
  }

  function beginNewEntry(): void {
    setReflection(null)
    setResurfaced(null)
    setSavedEntryId(null)
    editorRef.current?.focus()
  }

  return (
    <div className="stage">
      <div className={`page page--${turnPhase}`}>
        {view === 'write' ? (
          <section className="write" aria-label="Write">
            {showModelConsent && (
              <div className="write__consent" role="status">
                <p className="write__consent-text">
                  Words works better with two local models (about 5GB total, downloaded once). Download them
                  now?
                </p>
                <div className="write__consent-actions">
                  <button type="button" className="journal__link" onClick={() => void handleDownloadConsent(true)}>
                    download
                  </button>
                  <button type="button" className="journal__link" onClick={() => void handleDownloadConsent(false)}>
                    not now
                  </button>
                </div>
              </div>
            )}
            <div
              ref={editorRef}
              className="write__editor"
              tabIndex={0}
              role="textbox"
              aria-multiline="true"
              aria-label="Write"
              onKeyDown={handleEditorKeyDown}
              onPaste={handleEditorPaste}
              onFocus={() => setEditorFocused(true)}
              onBlur={() => setEditorFocused(false)}
            >
              {chars.length === 0 && (
                <span className="write__editor-placeholder">{`What's on your mind ${greeting}?`}</span>
              )}
              {draftRuns.map((run, i) =>
                run.struck ? (
                  <s key={i} className="struck-run">
                    {run.text}
                  </s>
                ) : (
                  <span key={i}>{run.text}</span>
                )
              )}
              {editorFocused && <span className="write__caret" aria-hidden="true" />}
            </div>

            <div className="write__footer">
              {reflection || resurfaced ? (
                <div className="afterthought" key={savedEntryId}>
                  {reflection && <p className="reflection">{reflection}</p>}
                  {resurfaced && (
                    <p className="resurfaced">
                      you wrote something like this on {formatDate(resurfaced.createdAt)} —{' '}
                      <span className="resurfaced__preview">{resurfaced.preview}</span>
                    </p>
                  )}
                </div>
              ) : (
                <span className="hint">
                  {plainDraft.trim() ? 'ctrl / ⌘ + enter to set this down' : ' '}
                </span>
              )}
            </div>

            <button
              type="button"
              className={`corner corner--journal notebook-icon ${journalIconActive ? 'notebook-icon--active' : ''}`}
              onClick={handleOpenJournal}
              aria-label="Open your journal"
              title="Your journal"
            >
              <span className="notebook-icon__spine" aria-hidden="true" />
              <span className="notebook-icon__body" aria-hidden="true" />
              <span className="notebook-icon__pen" aria-hidden="true" />
            </button>

            <button
              type="button"
              className="corner corner--settings-mini"
              onClick={() => turnTo('settings')}
              aria-label="Settings"
              title="Settings"
            >
              ⚙
            </button>

            <div className="dial-wrap">
              <div
                ref={dialRef}
                className={`dial ${dialDragging ? 'dial--dragging' : ''}`}
                tabIndex={0}
                role="slider"
                aria-label="Writing mode"
                aria-valuemin={0}
                aria-valuemax={2}
                aria-valuenow={WRITING_MODE_ORDER.indexOf(settings?.writingMode ?? 'pencil')}
                aria-valuetext={settings?.writingMode ?? 'pencil'}
                title="Writing mode — turn the dial"
                onPointerDown={handleDialPointerDown}
                onKeyDown={handleDialKeyDown}
              >
                {WRITING_MODE_ORDER.map((mode) => (
                  <span
                    key={mode}
                    className="dial__tick"
                    style={{ ...MODE_TICK_POSITION[mode], background: MODE_COLOR[mode] }}
                    aria-hidden="true"
                  />
                ))}
                <span
                  className="dial__needle"
                  style={{
                    transform: `translate(-50%,-100%) rotate(${dialRotation}deg)`,
                    background: MODE_COLOR[settings?.writingMode ?? 'pencil']
                  }}
                  aria-hidden="true"
                />
                <span
                  className="dial__hub"
                  style={{ background: MODE_COLOR[settings?.writingMode ?? 'pencil'] }}
                  aria-hidden="true"
                />
              </div>
              <span
                className="dial__label"
                style={{ color: MODE_COLOR[settings?.writingMode ?? 'pencil'] }}
              >
                {settings?.writingMode ?? 'pencil'}
              </span>
            </div>
          </section>
        ) : view === 'read' ? (
          <section className="read" aria-label="Entry">
            <button
              type="button"
              className="corner corner--write"
              onClick={() => turnTo('journal')}
              aria-label="Back to journal"
              title="Back to journal"
            >
              ‹
            </button>

            {readEntry === null ? (
              <p className="journal__empty"> </p>
            ) : (
              <>
                <ScrollFrame mood={readEntry.mood}>
                  <div className="journal__date read__date">
                    {readEntry.mood !== undefined && (
                      <span
                        className="journal__mood"
                        style={{ opacity: moodMarkOpacity(readEntry.mood) }}
                        aria-hidden="true"
                      />
                    )}
                    {formatDate(readEntry.createdAt)}
                  </div>
                  <p className="read__text">
                    {parseRuns(readEntry.text).map((run, i) =>
                      run.struck ? (
                        <s key={i} className="struck-run">
                          {run.text}
                        </s>
                      ) : (
                        <span key={i}>{run.text}</span>
                      )
                    )}
                  </p>
                  {readEntry.reflection && <p className="reflection read__reflection">{readEntry.reflection}</p>}
                </ScrollFrame>

                <div className="read__actions">
                  {deleteConfirming ? (
                    <>
                      <span className="hint">delete this entry?</span>
                      <button type="button" className="journal__link" onClick={() => void handleDelete()}>
                        yes, delete
                      </button>
                      <button type="button" className="journal__link" onClick={() => setDeleteConfirming(false)}>
                        never mind
                      </button>
                    </>
                  ) : (
                    <button type="button" className="journal__link" onClick={() => setDeleteConfirming(true)}>
                      delete
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        ) : view === 'recap' ? (
          <section className="read" aria-label="A letter from the past month">
            <button
              type="button"
              className="corner corner--write"
              onClick={() => turnTo('journal')}
              aria-label="Back to journal"
              title="Back to journal"
            >
              ‹
            </button>

            {recap === undefined ? (
              <p className="hint">gathering a letter from your past month...</p>
            ) : recap === null ? (
              <p className="journal__empty">
                Not quite enough recent writing for a letter yet — check back after a few more entries.
              </p>
            ) : (
              <ScrollFrame showSeal={false}>
                <p className="read__text recap__letter">{recap}</p>
              </ScrollFrame>
            )}
          </section>
        ) : view === 'settings' ? (
          <section className="settings" aria-label="Settings">
            <button
              type="button"
              className="corner corner--write"
              onClick={() => turnTo(settingsOrigin)}
              aria-label={settingsOrigin === 'journal' ? 'Back to journal' : 'Back to writing'}
              title={settingsOrigin === 'journal' ? 'Back to journal' : 'Back to writing'}
            >
              ‹
            </button>

            <h1 className="journal__title">Settings</h1>

            <div className="settings__group">
              <h2 className="settings__label">About Words</h2>
              <p className="settings__about-line">
                Words is a local-first journal — everything you write stays on this machine; nothing is sent
                anywhere.
              </p>
              <p className="settings__about-line">
                Write freely on the main page, then Ctrl/Cmd+Enter to set an entry down. A quiet one-line
                reflection may follow a moment later, and every so often an old entry that genuinely echoes
                today's will quietly surface too — never forced, and how often is up to you below.
              </p>
              <p className="settings__about-line">
                Entries are permanent once saved — no editing, only delete. The dial on the writing page
                controls how forgiving that is while you're still writing:
              </p>
              <ul className="settings__about-list">
                <li>
                  <strong>pencil</strong> — unlimited edits, write freely.
                </li>
                <li>
                  <strong>quill</strong> — a per-entry budget of {settings?.quillDeleteLimit ?? 5} whole word
                  {(settings?.quillDeleteLimit ?? 5) === 1 ? '' : 's'} you can correct (backspace removes a
                  full word at a time, set below). Once the budget's spent, that's it — no more edits at all,
                  same as after an entry's saved.
                </li>
                <li>
                  <strong>ink</strong> — no real deletions, ever. A delete strikes a whole word through
                  instead of removing it, so the mistake stays visible rather than vanishing — always
                  available, not just once something runs out.
                </li>
              </ul>
              <p className="settings__about-line">
                The journal view gathers everything you've written, notes a recurring theme when one's
                genuinely there, and can write you a short letter from your past month once you've got a few
                entries in. You can also import old plain-text journal entries from there.
              </p>
            </div>

            <div className="settings__group">
              <h2 className="settings__label">Appearance</h2>
              <div className="settings__options">
                <button
                  type="button"
                  className={`settings__option ${settings?.theme === 'light' ? 'settings__option--active' : ''}`}
                  onClick={() => void applySettings({ theme: 'light' })}
                >
                  cream
                </button>
                <button
                  type="button"
                  className={`settings__option ${settings?.theme === 'dark' ? 'settings__option--active' : ''}`}
                  onClick={() => void applySettings({ theme: 'dark' })}
                >
                  charcoal
                </button>
              </div>
            </div>

            <div className="settings__group">
              <h2 className="settings__label">How often should old entries resurface?</h2>
              <div className="settings__options">
                {RESURFACE_SENSITIVITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`settings__option ${
                      settings?.resurfaceSensitivity === option.value ? 'settings__option--active' : ''
                    }`}
                    onClick={() => void applySettings({ resurfaceSensitivity: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings__group">
              <h2 className="settings__label">Quill mode's corrections per entry</h2>
              <div className="settings__options">
                <input
                  type="number"
                  min={1}
                  max={200}
                  className="settings__number"
                  value={settings?.quillDeleteLimit ?? 5}
                  onChange={(e) => {
                    const value = Math.max(1, Math.min(200, Math.round(Number(e.target.value)) || 1))
                    void applySettings({ quillDeleteLimit: value })
                  }}
                />
              </div>
            </div>

            <div className="settings__group">
              <h2 className="settings__label">Local models</h2>
              {modelStatus ? (
                <>
                  <p className="settings__about-line">models folder: {modelStatus.modelsDir}</p>
                  <p className="settings__about-line">
                    reflection model: {modelStatus.reflectionModelFound ? 'found' : 'not found'}
                  </p>
                  <p className="settings__about-line">
                    embedding model: {modelStatus.embeddingModelFound ? 'found' : 'not found'}
                  </p>
                  {(['reflection', 'embedding'] as const).map((key) => {
                    const p = downloadProgress[key]
                    if (!p) return null
                    const pct = Math.min(100, Math.round((p.receivedBytes / Math.max(p.totalBytes, 1)) * 100))
                    return (
                      <p key={key} className="settings__about-line">
                        {p.error
                          ? `${MODEL_LABEL[key]} download failed — ${p.error}`
                          : p.done
                            ? `${MODEL_LABEL[key]} downloaded.`
                            : `downloading ${MODEL_LABEL[key]}: ${pct}% of ${formatGB(p.totalBytes)}`}
                      </p>
                    )
                  })}
                  {(!modelStatus.reflectionModelFound || !modelStatus.embeddingModelFound) &&
                    (() => {
                      const values = Object.values(downloadProgress)
                      const inProgress = values.some((p) => p && !p.done)
                      const failed = values.some((p) => p?.error)
                      return (
                        <button
                          type="button"
                          className="journal__link"
                          disabled={inProgress}
                          onClick={handleDownloadModels}
                        >
                          {inProgress
                            ? 'downloading…'
                            : failed
                              ? 'retry download'
                              : 'download missing model file(s) — about 5GB total'}
                        </button>
                      )
                    })()}
                </>
              ) : (
                <p className="settings__about-line"> </p>
              )}
            </div>
          </section>
        ) : (
          <section className="journal" aria-label="Journal">
            <button
              type="button"
              className="corner corner--write"
              onClick={() => turnTo('write')}
              aria-label="Back to writing"
              title="Back to writing"
            >
              ‹
            </button>

            <div className="journal__top-right">
              <button
                type="button"
                className="journal__import-btn"
                onClick={() => void handleImport()}
                aria-label="Import old writing"
                title="Import old writing"
              >
                <span className="journal__import-icon" aria-hidden="true">
                  ↓
                </span>
                import
              </button>
              <button
                type="button"
                className="journal__gear"
                onClick={() => turnTo('settings')}
                aria-label="Settings"
                title="Settings"
              >
                ⚙
              </button>
            </div>

            <h1 className="journal__title">Your journal</h1>

            {importStatus && <p className="journal__import-status">{importStatus}</p>}

            {theme && <p className="journal__theme">{theme}</p>}

            {entries && entries.length >= RECAP_MIN_ENTRIES && (
              <button type="button" className="journal__link" onClick={() => turnTo('recap')}>
                a letter from the past month
              </button>
            )}

            {entries === null ? (
              <p className="journal__empty"> </p>
            ) : entries.length === 0 ? (
              <p className="journal__empty">Nothing written yet. It'll gather here quietly, over time.</p>
            ) : (
              <ul className="journal__list">
                {entries.map((entry) => (
                  <li key={entry.id} className="journal__entry">
                    <button
                      type="button"
                      className="journal__entry-button"
                      onClick={() => turnTo('read', entry.id)}
                    >
                      <span className="journal__date">
                        {entry.mood !== undefined && (
                          <span
                            className="journal__mood"
                            style={{ opacity: moodMarkOpacity(entry.mood) }}
                            aria-hidden="true"
                          />
                        )}
                        {formatDate(entry.createdAt)}
                      </span>
                      <span className="journal__preview">{entry.preview}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
