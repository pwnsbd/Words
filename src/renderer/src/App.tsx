import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  EntrySummary,
  MemoryMatch,
  PatternsSnapshot,
  JournalEntry,
  Settings,
  ModelStatus,
  ResurfaceSensitivity,
  WritingMode,
  ModelKey,
  DownloadProgress,
  Letter,
  LetterSummary,
  LetterTimeframe,
  LetterFillProgress
} from '../../shared/types'
import { HANDWRITING_FONTS, DEFAULT_HANDWRITING } from '../../shared/types'
import type { HandwritingFont } from '../../shared/types'
import { parseRuns, serializeRuns } from '../../shared/textMarkup'
import { DRAFT_KEY, readDraft } from './draft'
import { DeleteControl } from './DeleteMark'
import { InkScroll } from './InkScroll'
import { JournalGrid } from './JournalGrid'
import { PageDock } from './PageDock'
import { Knot, RopeTimeline, SagRope } from './Rope'
import {
  loadSpellcheck,
  spellReady,
  findMisspellings,
  suggestFor,
  addPersonalWord,
  type SpellRange
} from './spellcheck'

type View = 'patterns' | 'write' | 'journal' | 'read' | 'recap' | 'read-letter' | 'settings'
type TurnPhase = 'idle' | 'leaving' | 'entering'
type Char = { ch: string; struck: boolean }
type SpellMenu = { x: number; y: number; start: number; end: number; word: string; suggestions: string[] }

const RESURFACE_SENSITIVITY_OPTIONS: { value: ResurfaceSensitivity; label: string }[] = [
  { value: 'rare', label: 'rarely' },
  { value: 'balanced', label: 'sometimes' },
  { value: 'often', label: 'often' }
]

// Inline style for text set in a handwriting font: the font's family (falling
// back to Lora if it fails to load) and its scale applied to a base size.
// An unknown id yields no style, so the text stays in Lora.
function handwritingStyle(font: HandwritingFont | undefined, basePx: number): React.CSSProperties | undefined {
  const hw = font && Object.prototype.hasOwnProperty.call(HANDWRITING_FONTS, font) ? HANDWRITING_FONTS[font] : null
  if (!hw) return undefined
  return { fontFamily: `'${hw.family}', var(--serif)`, fontSize: `${Math.round(basePx * hw.scale * 10) / 10}px` }
}

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

const TIMEFRAMES: LetterTimeframe[] = ['week', 'month', 'year']
const TIMEFRAME_LABEL: Record<LetterTimeframe, string> = { week: 'weekly', month: 'monthly', year: 'yearly' }
// What a letter needs, in words — shown when no finished period qualifies yet.
const LETTER_NEEDS: Record<LetterTimeframe, string> = {
  week: 'a weekly letter needs 2 entries in a finished week',
  month: 'a monthly letter needs an entry every week of a finished month, or 5 in it',
  year: 'a yearly letter needs 12 entries in a finished year, or entries in 6 of its months'
}

// "Week of Jul 5, 2026" reads as "the week of Jul 5, 2026" in the status line.
function fillLabel(label: string): string {
  return label.startsWith('Week of') ? `the week of${label.slice(7)}` : /^\d{4}$/.test(label) ? `the year ${label}` : label
}
const CANDLE_COLOR: Record<LetterTimeframe, string> = {
  week: 'var(--mode-easy)',
  month: 'var(--mode-medium)',
  year: 'var(--mode-hard)'
}

const CANDLE_BODY: Record<LetterTimeframe, { h: number; w: number }> = {
  week: { h: 18, w: 8 },
  month: { h: 32, w: 10 },
  year: { h: 48, w: 12 }
}

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
  const [patterns, setPatterns] = useState<PatternsSnapshot | null>(null)
  const [patternsError, setPatternsError] = useState(false)
  const [readOrigin, setReadOrigin] = useState<'patterns' | 'journal'>('journal')
  const [recapOrigin, setRecapOrigin] = useState<'write' | 'journal'>('write')
  const [entryCount, setEntryCount] = useState(0)
  const [expandedPattern, setExpandedPattern] = useState<string | null>(null)
  const [dismissBusy, setDismissBusy] = useState<string | null>(null)
  const [view, setView] = useState<View>('write')
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('idle')
  // Settings is reachable from both the write page and the journal view --
  // its back arrow should return wherever it was opened from, not always
  // to one fixed place.
  const [settingsOrigin, setSettingsOrigin] = useState<'write' | 'journal'>('write')
  const [recoveredDraft] = useState(() => readDraft(window.localStorage))
  const [chars, setChars] = useState<Char[]>(recoveredDraft?.chars ?? [])
  const [remainingDeletes, setRemainingDeletes] = useState<number>(Infinity)
  const [editorFocused, setEditorFocused] = useState(false)
  const [journalIconActive, setJournalIconActive] = useState(false)
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null)
  const [reflection, setReflection] = useState<string | null>(null)
  const [resurfaced, setResurfaced] = useState<MemoryMatch[]>([])
  // True once the post-save memory lookup has actually reported back, so an
  // empty result is known to be empty rather than still loading.
  const [resurfacedDone, setResurfacedDone] = useState(false)
  const [readMemories, setReadMemories] = useState<MemoryMatch[]>([])
  const [memoryStatus, setMemoryStatus] = useState('')
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [sourcePassage, setSourcePassage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const saveInFlight = useRef(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [draftWarning, setDraftWarning] = useState<string | null>(null)
  const [entries, setEntries] = useState<EntrySummary[] | null>(null)
  const [theme, setTheme] = useState<string | null>(null)
  const [readEntry, setReadEntry] = useState<JournalEntry | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [listeningAgain, setListeningAgain] = useState(false)
  const [letters, setLetters] = useState<LetterSummary[]>([])
  const [letterTimeframe, setLetterTimeframe] = useState<LetterTimeframe>('month')
  const [letterLayout, setLetterLayout] = useState<'list' | 'grid'>('list')
  const [letterFill, setLetterFill] = useState<LetterFillProgress | null>(null)
  const [lettersOpened, setLettersOpened] = useState(false)
  const [letterFillFailed, setLetterFillFailed] = useState(false)
  const [letterModelMissing, setLetterModelMissing] = useState(false)
  const [readLetter, setReadLetter] = useState<Letter | null>(null)
  const [letterDeleteConfirming, setLetterDeleteConfirming] = useState(false)
  const [letterRewriting, setLetterRewriting] = useState(false)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const journalView = settings?.journalView ?? 'list'
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<Partial<Record<ModelKey, DownloadProgress>>>({})
  const [modelDirBusy, setModelDirBusy] = useState(false) // a models-folder move is running
  const [greeting] = useState(timeOfDayPhrase) // fixed for the session, not recomputed every render
  const editorRef = useRef<HTMLDivElement>(null)
  const imeRef = useRef<HTMLTextAreaElement>(null)
  const [composing, setComposing] = useState('') // in-progress IME text, shown at the caret
  const dialRef = useRef<HTMLDivElement>(null)
  const [dialRotation, setDialRotation] = useState(0)
  const [dialDragging, setDialDragging] = useState(false)
  // Spellcheck: result of the last debounced pass (tied to the chars it was
  // computed from), a bump counter for when the dictionary finishes loading,
  // and the open right-click menu, if any.
  const [spellResult, setSpellResult] = useState<{ chars: Char[]; ranges: SpellRange[] } | null>(null)
  const [spellVersion, setSpellVersion] = useState(0)
  const [spellMenu, setSpellMenu] = useState<SpellMenu | null>(null)
  const spellMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    focusEditor()
  }, [])

  useEffect(() => {
    void window.api.getSettings().then((loaded) => {
      setSettings(loaded)
      document.documentElement.setAttribute('data-theme', loaded.theme)
      setRemainingDeletes(recoveredDraft?.mode === loaded.writingMode
        ? recoveredDraft.remainingDeletes ?? Infinity
        : budgetForMode(loaded.writingMode, loaded.quillDeleteLimit))
      setDialRotation(MODE_ANGLE[loaded.writingMode])
    }).catch(() => setActionError('Settings could not be loaded. Please restart Words.'))
    // Needed on the write page too now, not just Settings -- deciding
    // whether to show the one-time model-download consent banner requires
    // knowing model status right from the start.
    void window.api.getModelStatus().then(setModelStatus).catch(() => setActionError('Local model status could not be checked. Your writing can still be saved.'))
    void window.api.listEntries().then((list) => setEntryCount(list.length)).catch(() => setActionError('Your journal could not be opened. Check access to the journal folder and restart Words.'))
  }, [])

  // Preserve the actual character/strike state and correction budget on restart.
  useEffect(() => {
    if (!settings) return
    try {
      if (chars.length) window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        chars, remainingDeletes: Number.isFinite(remainingDeletes) ? remainingDeletes : null,
        mode: settings.writingMode
      }))
      else window.localStorage.removeItem(DRAFT_KEY)
      setDraftWarning(null)
    } catch {
      setDraftWarning('Draft recovery is unavailable. Save your writing before closing Words.')
    }
  }, [chars, remainingDeletes, settings?.writingMode])

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

  async function chooseJournalView(next: 'list' | 'grid'): Promise<void> {
    setSettings((prev) => (prev ? { ...prev, journalView: next } : prev))
    try {
      setSettings(await window.api.updateSettings({ journalView: next }))
    } catch {
      // Remembering the choice is a nicety; the view itself already switched.
    }
  }

  async function applySettings(patch: Partial<Settings>): Promise<void> {
    try {
    const updated = await window.api.updateSettings(patch)
    setSettings(updated)
    document.documentElement.setAttribute('data-theme', updated.theme)
    // Switching the writing mode (or its quill budget) resets the current
    // entry's remaining-deletes count fresh -- the budget is meant to be
    // "how forgiving is this mode", not a pool that survives a mode swap.
    if (patch.writingMode !== undefined || patch.quillDeleteLimit !== undefined) {
      setRemainingDeletes(budgetForMode(updated.writingMode, updated.quillDeleteLimit))
    }
    } catch { setActionError('Settings could not be saved. Please retry.') }
  }

  // Load the offline dictionary once settings (and so the personal words)
  // are known. Failure just means no underlines.
  const spellWordsLoaded = settings !== null
  useEffect(() => {
    if (!spellWordsLoaded) return
    void loadSpellcheck(settings?.spellcheckWords ?? []).then(() => setSpellVersion((v) => v + 1))
  }, [spellWordsLoaded])

  // Debounced, off the keystroke path: only re-checks after ~300ms idle,
  // and per-word results are cached, so long entries stay cheap.
  useEffect(() => {
    if (!spellReady()) return
    const timer = window.setTimeout(() => {
      setSpellResult({ chars, ranges: findMisspellings(chars) })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [chars, spellVersion])

  // Ranges stay valid for the untouched prefix of the text while a fresh
  // check is pending, so only the words near an edit lose their underline
  // for a moment.
  const misspellRanges = useMemo<SpellRange[]>(() => {
    if (!spellResult || chars.length === 0) return []
    if (spellResult.chars === chars) return spellResult.ranges
    const old = spellResult.chars
    const limit = Math.min(old.length, chars.length)
    let p = 0
    while (p < limit && old[p].ch === chars[p].ch && old[p].struck === chars[p].struck) p++
    return spellResult.ranges.filter((r) => r.end < p)
  }, [spellResult, chars])

  // Like draftRuns, but non-struck runs are further split so a misspelled
  // word is its own span (carrying its char range for the context menu).
  const editorRuns = useMemo(() => {
    const out: { text: string; struck: boolean; spell?: SpellRange }[] = []
    let r = 0
    for (let i = 0; i < chars.length; i++) {
      while (r < misspellRanges.length && misspellRanges[r].end <= i) r++
      const range = r < misspellRanges.length && misspellRanges[r].start <= i ? misspellRanges[r] : undefined
      const last = out[out.length - 1]
      if (last && last.struck === chars[i].struck && last.spell === range) last.text += chars[i].ch
      else out.push({ text: chars[i].ch, struck: chars[i].struck, spell: range })
    }
    return out
  }, [chars, misspellRanges])

  // Any edit invalidates an open menu's range.
  useEffect(() => {
    setSpellMenu(null)
  }, [chars])

  useEffect(() => {
    if (!spellMenu) return
    const close = (): void => setSpellMenu(null)
    const onMouseDown = (e: MouseEvent): void => {
      if (!spellMenuRef.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [spellMenu])

  function handleEditorContextMenu(e: React.MouseEvent<HTMLElement>): void {
    const target = (e.target as HTMLElement).closest?.('[data-spell-start]') as HTMLElement | null
    if (!target) return // no misspelled word here -- leave the default alone
    e.preventDefault()
    const start = Number(target.dataset.spellStart)
    const end = Number(target.dataset.spellEnd)
    const word = chars.slice(start, end).map((c) => c.ch).join('')
    setSpellMenu({
      x: Math.min(e.clientX, window.innerWidth - 190),
      y: Math.min(e.clientY, window.innerHeight - 220),
      start,
      end,
      word,
      suggestions: suggestFor(word.replace(/\u2019/g, "'"))
    })
  }

  // Whether picking a suggestion may change the text right now. Pencil: yes.
  // Quill: only while a correction remains (it spends one). Ink: never --
  // ink doesn't erase or silently replace what you wrote.
  const canReplaceWord =
    settings?.writingMode === 'pencil' || (settings?.writingMode === 'quill' && remainingDeletes > 0)

  function applySuggestion(menu: SpellMenu, suggestion: string): void {
    setSpellMenu(null)
    focusEditor()
    if (!canReplaceWord) return
    const current = chars.slice(menu.start, menu.end)
    if (current.length === 0 || current.map((c) => c.ch).join('') !== menu.word || current.some((c) => c.struck)) return
    const replacement = Array.from(suggestion).map((ch) => ({ ch, struck: false }))
    setChars([...chars.slice(0, menu.start), ...replacement, ...chars.slice(menu.end)])
    if (remainingDeletes !== Infinity) setRemainingDeletes((r) => r - 1)
  }

  function addWordToDictionary(menu: SpellMenu): void {
    setSpellMenu(null)
    focusEditor()
    const word = menu.word.replace(/\u2019/g, "'")
    addPersonalWord(word)
    setSpellVersion((v) => v + 1)
    const existing = settings?.spellcheckWords ?? []
    if (!existing.includes(word)) void applySettings({ spellcheckWords: [...existing, word] })
  }

  const activeMode = settings?.writingMode ?? 'pencil'
  const activeFont: HandwritingFont = settings?.handwriting?.[activeMode] ?? DEFAULT_HANDWRITING[activeMode]
  const plainDraft = useMemo(() => chars.map((c) => c.ch).join(''), [chars])

  useEffect(() => {
    const unsubscribe = window.api.onReflection(({ id, reflection }) => {
      if (id === savedEntryId) setReflection(reflection)
    })
    return unsubscribe
  }, [savedEntryId])

  useEffect(() => {
    const unsubscribe = window.api.onResurfaced(({ id, matches }) => {
      if (id === savedEntryId) {
        setResurfaced(matches)
        setResurfacedDone(true)
      }
    })
    return unsubscribe
  }, [savedEntryId])

  useEffect(() => {
    let cancelled = false
    setReadMemories([])
    if (readEntry) void window.api.getMemories(readEntry.id).then((matches) => {
      if (!cancelled) setReadMemories(matches)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [readEntry?.id])

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

  // Letters written by the auto-fill appear as soon as they're saved, even if
  // the page has been left or the candle turned meanwhile.
  // Subscribed from the first time Letters is opened, and kept after that.
  useEffect(() => {
    if (!lettersOpened) return
    const offWritten = window.api.onLetterWritten((letter) => {
      setLetters((prev) => (prev.some((l) => l.id === letter.id) ? prev
        : [...prev, letter].sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))))
    })
    const offProgress = window.api.onLetterFillProgress(setLetterFill)
    return () => { offWritten(); offProgress() }
  }, [lettersOpened])

  async function handleSave(): Promise<void> {
    if (saveInFlight.current || composing) return
    // Trim on the char array (not the serialized string) so a leading/
    // trailing whitespace char that happens to be struck doesn't leave a
    // dangling, now-empty strike marker behind.
    let start = 0
    let end = chars.length
    while (start < end && /\s/.test(chars[start].ch)) start++
    while (end > start && /\s/.test(chars[end - 1].ch)) end--
    const trimmed = chars.slice(start, end)
    if (trimmed.length === 0) return

    saveInFlight.current = true
    setSaving(true)
    setActionError(null)
    setReflection(null)
    setResurfaced([])
    setResurfacedDone(false)
    try {
      const entry = await window.api.saveEntry(serializeRuns(trimmed), activeFont)
      setSavedEntryId(entry.id)
      setChars([])
      setEntryCount((c) => c + 1)
      if (settings) setRemainingDeletes(budgetForMode(settings.writingMode, settings.quillDeleteLimit))
      focusEditor()
    } catch {
      setActionError('Your entry could not be saved. Your writing is still here — please retry.')
    } finally {
      saveInFlight.current = false
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
  // IME / dead keys / the emoji panel need a real text input, so a visually
  // hidden <textarea> (imeRef) sits at the caret and holds focus. Plain
  // keys are still intercepted here and never reach it; anything the OS
  // composes arrives through onInput / onCompositionEnd and is appended to
  // `chars` as ordinary characters, so every writing mode's rules (which
  // only ever look at `chars`) apply unchanged. The textarea is emptied
  // after every commit, so native editing can never diverge from `chars`.
  function focusEditor(): void {
    imeRef.current?.focus()
  }

  function appendText(text: string): void {
    if (!text || saveInFlight.current) return
    if (savedEntryId) beginNewEntry()
    setChars((prev) => [...prev, ...Array.from(text).map((ch) => ({ ch, struck: false }))])
  }

  function commitIme(el: HTMLTextAreaElement): void {
    const text = el.value.replace(/\r\n?/g, '\n')
    el.value = ''
    setComposing('')
    appendText(text)
  }

  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLElement>): void {
    if (saveInFlight.current) { e.preventDefault(); return }
    // Mid-composition keys (including Backspace) belong to the IME.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleSave()
      return
    }

    const isDeleteKey = e.key === 'Backspace' || e.key === 'Delete'
    // Ctrl+Backspace (Windows/Linux) or Alt/Option+Backspace (macOS) — the
    // usual "delete the previous word" chord. Handled here rather than
    // falling through to the modifier bail-out just below.
    const wordDeleteChord = isDeleteKey && (e.ctrlKey || e.altKey) && !e.metaKey

    if ((e.metaKey || e.ctrlKey || e.altKey) && !wordDeleteChord) return // don't swallow copy/select-all/etc.

    if (isDeleteKey) {
      e.preventDefault()
      if (chars.length === 0) return
      if (savedEntryId) beginNewEntry()
      if (remainingDeletes === Infinity) {
        // Pencil: plain single-character backspace, like any editor --
        // unless the word-delete chord asks for the whole trailing word.
        setChars((prev) =>
          wordDeleteChord
            ? prev.slice(0, wordStartBackward(prev, prev.length - 1, () => true))
            : prev.slice(0, -1)
        )
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
      if (savedEntryId) beginNewEntry()
      setChars((prev) => [...prev, { ch: '\n', struck: false }])
      return
    }

    if (e.key.length === 1) {
      e.preventDefault()
      if (savedEntryId) beginNewEntry()
      setChars((prev) => [...prev, { ch: e.key, struck: false }])
    }
  }

  function handleEditorPaste(e: React.ClipboardEvent<HTMLElement>): void {
    e.preventDefault()
    appendText(e.clipboardData.getData('text/plain'))
  }

  useEffect(() => {
    if (view !== 'patterns') return
    let cancelled = false
    const read = async (): Promise<void> => {
      try {
        const snapshot = await window.api.listPatterns()
        if (!cancelled) { setPatterns(snapshot); setPatternsError(false) }
      } catch { if (!cancelled) setPatternsError(true) }
    }
    void window.api.refreshPatterns().then(read).catch(() => { if (!cancelled) setPatternsError(true) })
    void read()
    const timer = window.setInterval(() => void read(), 2000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [view])

  async function dismissIdea(id: string): Promise<void> {
    setDismissBusy(id)
    try { setPatterns(await window.api.dismissPattern(id)); setExpandedPattern(null) }
    catch { setPatternsError(true) }
    finally { setDismissBusy(null) }
  }

  function turnTo(next: View, entryId?: string): void {
    if (turnPhase !== 'idle') return
    // Capture where we're turning to settings *from* before the view
    // changes, so its back arrow can return there instead of a fixed page.
    if (next === 'settings') setSettingsOrigin(view === 'journal' ? 'journal' : 'write')
    if (next === 'read' && view !== 'read') setReadOrigin(view === 'patterns' ? 'patterns' : 'journal')
    if (next === 'recap') setRecapOrigin(view === 'journal' ? 'journal' : 'write')
    setTurnPhase('leaving')
    window.setTimeout(() => {
      setView(next)
      if (next !== 'read') setSourcePassage(null)
      if (next === 'journal') {
        setTheme(null)
        setImportStatus(null)
        void window.api.listEntries().then((list) => { setEntries(list); setEntryCount(list.length) })
          .catch(() => setActionError('Your journal could not be opened. Please retry.'))
        void window.api.getTheme().then(setTheme).catch(() => setTheme(null))
      }
      if (next === 'read' && entryId) {
        setReadEntry(null)
        setDeleteConfirming(false)
        void window.api.getEntry(entryId).then((entry) => {
          setReadEntry(entry)
          if (!entry) setActionError('This entry is unavailable. It may have been deleted or its file could not be read.')
        }).catch(() => setActionError('This entry could not be opened. Please retry.'))
      }
      if (next === 'recap') {
        void window.api.listLetters().then(setLetters).catch(() => setActionError('Your letters could not be opened. Please retry.'))
        setLettersOpened(true)
        void fillMissingLetters()
      }
      if (next === 'read-letter' && entryId) {
        setReadLetter(null)
        setLetterDeleteConfirming(false)
        void window.api.getLetter(entryId).then((letter) => {
          setReadLetter(letter)
          if (!letter) setActionError('This letter is unavailable. It may have been deleted or its file could not be read.')
        }).catch(() => setActionError('This letter could not be opened. Please retry.'))
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
    try {
      await window.api.deleteEntry(readEntry.id)
      setEntryCount((count) => Math.max(0, count - 1))
      turnTo(readOrigin)
    } catch { setActionError('The entry could not be deleted. Please retry.') }
  }

  async function handleImport(): Promise<void> {
    try {
    const result = await window.api.importEntries()
    if (result.failed > 0) setActionError(`${result.failed} file(s) could not be imported. ${result.imported} entries were added; retry only the failed files.`)
    if (result.imported > 0) {
      setImportStatus(`${result.imported} ${result.imported === 1 ? 'entry' : 'entries'} added.`)
      const list = await window.api.listEntries()
      setEntries(list)
      setEntryCount(list.length)
    }
    } catch { setActionError('Import could not finish. Check the journal before retrying; some files may have been added.') }
  }

  // Runs when Letters opens (and from "try again"). The main process writes
  // every missing eligible letter oldest first; a second call while one runs
  // does nothing, and progress arrives through the events below.
  async function fillMissingLetters(): Promise<void> {
    try {
      const result = await window.api.fillMissingLetters()
      setLetterModelMissing(!!result.modelUnavailable)
      if (result.started) setLetterFillFailed(result.failed > 0)
    } catch {
      setLetterFillFailed(true)
    } finally {
      setLetterFill(null)
    }
    void window.api.listLetters().then(setLetters).catch(() => {})
  }

  async function handleRewriteLetter(): Promise<void> {
    if (!readLetter || letterRewriting) return
    setLetterRewriting(true)
    try {
      const letter = await window.api.regenerateLetter(readLetter.id)
      if (letter) {
        setReadLetter((current) => (current && current.id === letter.id ? letter : current))
        void window.api.listLetters().then(setLetters)
      } else setActionError('The letter could not be written again yet. Your earlier letter is kept.')
    } catch {
      setActionError('The letter could not be written again. Your earlier letter is kept.')
    } finally {
      setLetterRewriting(false)
    }
  }

  async function handleDeleteLetter(): Promise<void> {
    if (!readLetter) return
    try {
      await window.api.deleteLetter(readLetter.id)
      turnTo('recap')
    } catch { setActionError('The letter could not be deleted. Please retry.') }
  }

  const filteredLetters = useMemo(
    () => letters.filter((l) => l.timeframe === letterTimeframe),
    [letters, letterTimeframe]
  )

  // Manual retry from Settings, for when the automatic background download
  // failed (or a file was deleted) -- kicks off the same fetch again.
  function handleDownloadModels(): void {
    setDownloadProgress({})
    void window.api.downloadModels().catch(() => setActionError('Model setup could not start. Please retry.'))
  }

  // Move the model files to a folder the user picks (or back to the default).
  // The main process does the actual move -- ~5GB can take a moment across
  // drives -- so this awaits with a visible "moving" state. chooseModelsDir
  // returns null if the picker was cancelled.
  async function handleChooseModelsDir(): Promise<void> {
    setModelDirBusy(true)
    try {
      const status = await window.api.chooseModelsDir()
      if (!status) return
      setModelStatus(status)
      setSettings(await window.api.getSettings())
    } catch {
      setActionError('The models folder could not be changed. Check the folder permissions and available space, then retry.')
    } finally {
      setModelDirBusy(false)
    }
  }

  async function handleResetModelsDir(): Promise<void> {
    setModelDirBusy(true)
    try {
      setModelStatus(await window.api.resetModelsDir())
      setSettings(await window.api.getSettings())
    } catch {
      setActionError('The default models folder could not be restored. Please retry.')
    } finally {
      setModelDirBusy(false)
    }
  }

  const handleListenAgain = async (): Promise<void> => {
    if (!readEntry || listeningAgain) return
    setListeningAgain(true)
    try {
      const updated = await window.api.regenerateReflection(readEntry.id)
      if (updated) setReadEntry((cur) => (cur && cur.id === updated.id ? updated : cur))
    } catch {
      setActionError('The reflection could not be regenerated. Check Local models in Settings and retry.')
    } finally {
      setListeningAgain(false)
    }
  }

  const modelsMissing = modelStatus !== null && ((modelStatus.reflectionEnabled && !modelStatus.reflectionModelFound) || !modelStatus.embeddingModelFound)

  // The app fetches the models by itself in the background on first run.
  // The writing surface just carries a quiet, non-blocking line about it --
  // "setting up" until progress arrives, then a download line, and a soft
  // fallback note if it failed (Settings has a retry). Nothing here ever
  // gates typing or saving.
  const downloadValues = Object.values(downloadProgress)
  const downloadRunning = downloadValues.length > 0 && downloadValues.some((p) => p && !p.done)
  const downloadFailed = downloadValues.some((p) => p?.error)
  const showModelSetupLine = modelsMissing && !downloadFailed

  // A new writer's first saves find nothing to resurface; say so once, quietly.
  const showMemoryHint = savedEntryId !== null && resurfacedDone && resurfaced.length === 0 &&
    entryCount < 5 && modelStatus?.embeddingModelFound === true

  function beginNewEntry(): void {
    setReflection(null)
    setResurfaced([])
    setResurfacedDone(false)
    setSavedEntryId(null)
    focusEditor()
  }

  return (
    <div className="stage">
      {(actionError || draftWarning) && (
        <div className="app-error" role="alert">
          {actionError || draftWarning}
          {actionError && <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss message">×</button>}
        </div>
      )}
      <div className={`page page--${turnPhase}`}>
        {view === 'write' ? (
          <section className="write" aria-label="Write">
            {showModelSetupLine && (
              <div className="write__consent" role="status">
                <p className="write__consent-text">
                  {downloadRunning
                    ? 'Setting up the local models — downloading in the background. You can keep writing; reflections begin once they finish.'
                    : 'Setting up the local models in the background. You can keep writing; reflections begin once they’re ready.'}
                </p>
              </div>
            )}
            {downloadFailed && (
              <div className="write__consent" role="status">
                <p className="write__consent-text">
                  The local models didn’t finish downloading — Settings → Local models has a retry. Entries
                  still save fine without them.
                </p>
              </div>
            )}
            <InkScroll
              innerRef={editorRef}
              className="write__editor"
              style={handwritingStyle(activeFont, 22)}
              tabIndex={0}
              role="textbox"
              aria-multiline="true"
              aria-label="Write"
              onKeyDown={handleEditorKeyDown}
              onPaste={handleEditorPaste}
              onContextMenu={handleEditorContextMenu}
              onFocus={(e) => {
                setEditorFocused(true)
                if (e.target === e.currentTarget) focusEditor()
              }}
              onBlur={() => setEditorFocused(false)}
            >
              {chars.length === 0 && (
                <span className="write__editor-placeholder">{`What's on your mind ${greeting}?`}</span>
              )}
              {editorRuns.map((run, i) =>
                run.struck ? (
                  <s key={i} className="struck-run">
                    {run.text}
                  </s>
                ) : run.spell ? (
                  <span
                    key={i}
                    className="misspelled"
                    data-spell-start={run.spell.start}
                    data-spell-end={run.spell.end}
                  >
                    {run.text}
                  </span>
                ) : (
                  <span key={i}>{run.text}</span>
                )
              )}
              {composing && <span className="write__composing">{composing}</span>}
              <span className="write__caret-slot">
                {editorFocused && <span className="write__caret" aria-hidden="true" />}
                <textarea
                  ref={imeRef}
                  className="write__ime"
                  tabIndex={-1}
                  aria-label="Write"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  readOnly={saving}
                  onCompositionStart={() => setComposing(' ')}
                  onCompositionUpdate={(e) => setComposing(e.data || ' ')}
                  onCompositionEnd={(e) => commitIme(e.currentTarget)}
                  onInput={(e) => {
                    if (e.nativeEvent instanceof InputEvent && e.nativeEvent.isComposing) return
                    commitIme(e.currentTarget)
                  }}
                />
              </span>
            </InkScroll>

            {spellMenu && (
              <div
                ref={spellMenuRef}
                className="spell-menu"
                role="menu"
                style={{ left: spellMenu.x, top: spellMenu.y }}
                onMouseDown={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
              >
                {spellMenu.suggestions.length === 0 && (
                  <div className="spell-menu__note">no suggestions</div>
                )}
                {spellMenu.suggestions.map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    role="menuitem"
                    className="spell-menu__item"
                    disabled={!canReplaceWord}
                    onClick={() => applySuggestion(spellMenu, sug)}
                  >
                    {sug}
                  </button>
                ))}
                {!canReplaceWord && spellMenu.suggestions.length > 0 && (
                  <div className="spell-menu__note">
                    {settings?.writingMode === 'ink' ? 'ink keeps what you wrote' : 'no corrections left'}
                  </div>
                )}
                <div className="spell-menu__rule" />
                <button
                  type="button"
                  role="menuitem"
                  className="spell-menu__item"
                  onClick={() => addWordToDictionary(spellMenu)}
                >
                  add to dictionary
                </button>
              </div>
            )}

            <div className="write__footer">
              {reflection || resurfaced.length > 0 || showMemoryHint ? (
                <InkScroll className="afterthought" key={savedEntryId}>
                  {reflection && <p className="reflection">{reflection}</p>}
                  {showMemoryHint && (
                    <p className="memory-hint">Words will start remembering after a few entries.</p>
                  )}
                  {resurfaced.map((match) => (
                    <div className="resurfaced" key={match.id}>
                      <button type="button" className="journal__link" onClick={() => {
                        setSourcePassage(match.preview)
                        turnTo('read', match.id)
                      }}>
                        a similar thought on {formatDate(match.createdAt)} — open entry
                      </button>
                      <InkScroll as="blockquote" className="memory-quote">{match.preview}</InkScroll>
                    </div>
                  ))}
                </InkScroll>
              ) : (
                plainDraft.trim() ? (
                  <button type="button" className="journal__link" disabled={saving || !!composing}
                    onClick={() => void handleSave()}>
                    {saving ? 'saving…' : 'save entry · ctrl + enter'}
                  </button>
                ) : <span className="hint" role="status">{savedEntryId ? 'saved' : ' '}</span>
              )}
            </div>

            <PageDock
              current="write"
              showLetter={entryCount >= RECAP_MIN_ENTRIES}
              journalActive={journalIconActive}
              onOpenLetters={() => turnTo('recap')}
              onOpenPatterns={() => turnTo('patterns')}
              onOpenJournal={handleOpenJournal}
            />

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
        ) : view === 'patterns' ? (
          <>
            <InkScroll as="section" className="journal patterns" aria-label="Patterns">
              <button type="button" className="corner corner--write" onClick={() => turnTo('write')}
                aria-label="Back to writing" title="Back to writing">‹</button>
              <p className="patterns__eyebrow">Threads through your writing</p>
              <h1 className="journal__title">Patterns</h1>
              <p className="patterns__intro">Ideas, philosophical questions, and ways of thinking that return in your writing.</p>
              <div role="status" className="patterns__status">
                {patternsError ? 'Patterns could not be loaded. Please try again.' : patterns?.message ||
                  (patterns?.updating ? 'Looking for threads in your writing…' : !patterns ? 'Opening your patterns…' : '')}
              </div>
              {(patternsError || patterns?.message) && <button className="journal__link" onClick={() => {
                setPatternsError(false)
                void window.api.refreshPatterns().catch(() => setPatternsError(true))
              }}>try again</button>}
              {patterns && !patterns.updating && !patterns.message && !patternsError && patterns.patterns.length === 0 && (
                <p className="journal__empty">Patterns will appear as you keep writing. A thread needs to return in at least three entries on different days.</p>
              )}
              {patterns?.patterns.map(pattern => (
                <article className="pattern" key={pattern.id}>
                  <SagRope />
                  <button type="button" className="pattern__heading" aria-expanded={expandedPattern === pattern.id}
                    aria-controls={`pattern-${pattern.id}`} onClick={() => setExpandedPattern(expandedPattern === pattern.id ? null : pattern.id)}>
                    <Knot />
                    <span>{pattern.title}</span><span className="pattern__toggle" aria-hidden="true">{expandedPattern === pattern.id ? '−' : '+'}</span>
                  </button>
                  <p className="pattern__dates">Appeared in {pattern.evidence.length} entries · {formatDate(pattern.evidence[0].createdAt)} – {formatDate(pattern.evidence[pattern.evidence.length - 1].createdAt)}</p>
                  <p className="pattern__description">{pattern.description}</p>
                  {expandedPattern === pattern.id && (
                    <div id={`pattern-${pattern.id}`}>
                      <RopeTimeline>
                        {pattern.evidence.map(evidence => (
                          <li key={evidence.entryId}>
                            <button className="journal__link" onClick={() => {
                              setSourcePassage(evidence.text)
                              turnTo('read', evidence.entryId)
                            }}>{formatDate(evidence.createdAt)}{evidence.isSample ? ' · sample' : ''} — open entry</button>
                            <blockquote>{evidence.text}</blockquote>
                          </li>
                        ))}
                      </RopeTimeline>
                      <button className="journal__link pattern__dismiss" disabled={dismissBusy !== null}
                        onClick={() => void dismissIdea(pattern.id)}>{dismissBusy === pattern.id ? 'setting this aside…' : 'these aren’t related'}</button>
                    </div>
                  )}
                </article>
              ))}
            </InkScroll>
            <PageDock
              current="patterns"
              showLetter={entryCount >= RECAP_MIN_ENTRIES}
              journalActive={journalIconActive}
              onOpenLetters={() => turnTo('recap')}
              onOpenPatterns={() => turnTo('patterns')}
              onOpenJournal={handleOpenJournal}
            />
          </>
        ) : view === 'read' ? (
          <InkScroll as="section" className="read" aria-label="Entry">
            <button
              type="button"
              className="corner corner--write"
              onClick={() => turnTo(readOrigin)}
              aria-label={readOrigin === 'patterns' ? 'Back to patterns' : 'Back to journal'}
              title={readOrigin === 'patterns' ? 'Back to patterns' : 'Back to journal'}
            >
              ‹
            </button>

            {readEntry === null ? (
              <p className="journal__empty"> </p>
            ) : (
              <>
                <div className="read__toolbar">
                  <DeleteControl
                    noun="entry"
                    confirming={deleteConfirming}
                    setConfirming={setDeleteConfirming}
                    onDelete={() => void handleDelete()}
                  />
                </div>
                <ScrollFrame mood={readEntry.mood}>
                  <div className="journal__date read__date">
                    {readEntry.mood !== undefined && (
                      <span
                        className="journal__mood"
                        style={{ opacity: moodMarkOpacity(readEntry.mood) }}
                        aria-hidden="true"
                      />
                    )}
                    {formatDate(readEntry.createdAt)}{readEntry.isSample ? ' · sample' : ''}
                  </div>
                  <p className="read__text" style={handwritingStyle(readEntry.font, 20)}>
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
                  {sourcePassage && (
                    <aside className="memory-source">
                      <p>Passage you followed here</p>
                      <InkScroll as="blockquote" className="memory-quote">{sourcePassage}</InkScroll>
                      <button className="journal__link" onClick={() => setSourcePassage(null)}>dismiss</button>
                    </aside>
                  )}
                  {readMemories.map((match) => (
                    <div className="resurfaced" key={match.id}>
                      <button className="journal__link" onClick={() => {
                        setSourcePassage(match.preview)
                        turnTo('read', match.id)
                      }}>a similar thought on {formatDate(match.createdAt)} — open entry</button>
                      <InkScroll as="blockquote" className="memory-quote">{match.preview}</InkScroll>
                    </div>
                  ))}
                  {readEntry.reflection && <p className="reflection read__reflection">{readEntry.reflection}</p>}
                </ScrollFrame>

                {modelStatus?.reflectionEnabled && modelStatus.reflectionModelFound && (
                  <div className="read__actions">
                    <button
                      type="button"
                      className="journal__link"
                      disabled={listeningAgain}
                      onClick={() => void handleListenAgain()}
                    >
                      {listeningAgain ? 'listening…' : 'listen again'}
                    </button>
                  </div>
                )}
              </>
            )}
          </InkScroll>
        ) : view === 'recap' ? (
          <>
            <InkScroll as="section" className="journal recap" aria-label="Letters">
              <button
                type="button"
                className="corner corner--write"
                onClick={() => turnTo(recapOrigin)}
                aria-label={recapOrigin === 'journal' ? 'Back to journal' : 'Back to writing'}
                title={recapOrigin === 'journal' ? 'Back to journal' : 'Back to writing'}
              >
                ‹
              </button>

              <p className="patterns__eyebrow">From your writing</p>
              <div className="letters__header">
                <h1 className="journal__title">Letters</h1>
                <div className="letters__candles" role="tablist" aria-label="Timeframe">
                {TIMEFRAMES.map((tf) => {
                  const { h: bodyH, w: bodyW } = CANDLE_BODY[tf]
                  const color = CANDLE_COLOR[tf]
                  const lit = letterTimeframe === tf
                  const viewH = bodyH + 30
                  const bodyBot = viewH - 5
                  const bodyTop = bodyBot - bodyH
                  const bx = 18 - bodyW / 2
                  const wickTop = bodyTop - 5
                  return (
                    <button
                      key={tf}
                      type="button"
                      role="tab"
                      aria-selected={lit}
                      className={`letters__candle ${lit ? 'letters__candle--lit' : ''}`}
                      onClick={() => setLetterTimeframe(tf)}
                      aria-label={TIMEFRAME_LABEL[tf]}
                      title={TIMEFRAME_LABEL[tf]}
                    >
                      <svg viewBox={`0 0 36 ${viewH}`} fill="none" aria-hidden="true">
                        <rect x={bx} y={bodyTop} width={bodyW} height={bodyH} rx="2"
                          style={{ fill: color, opacity: lit ? 0.9 : 0.4, transition: 'opacity 300ms ease' }} />
                        {tf !== 'week' && (
                          <path d={`M${bx} ${bodyTop + 12} C${bx - 2.5} ${bodyTop + 14.5} ${bx - 2.5} ${bodyTop + 17.5} ${bx} ${bodyTop + 20}`}
                            style={{ fill: color, opacity: lit ? 0.7 : 0.25, transition: 'opacity 300ms ease' }} />
                        )}
                        {tf === 'year' && (
                          <path d={`M${bx + bodyW} ${bodyTop + 30} C${bx + bodyW + 2.5} ${bodyTop + 32.5} ${bx + bodyW + 2.5} ${bodyTop + 35.5} ${bx + bodyW} ${bodyTop + 38}`}
                            style={{ fill: color, opacity: lit ? 0.7 : 0.25, transition: 'opacity 300ms ease' }} />
                        )}
                        <line x1={18} y1={bodyTop} x2={18} y2={wickTop}
                          strokeWidth="1" strokeLinecap="round"
                          style={{ stroke: 'var(--ink-soft)' }} />
                        {lit && (
                          <g className="letters__flame">
                            <circle cx={18} cy={10} r="14" style={{ fill: color, opacity: 0.08 }} />
                            <path d="M18 20 C13.5 15 13.5 7 18 0 C22.5 7 22.5 15 18 20Z" style={{ fill: color, opacity: 0.8 }} />
                            <path d="M18 18 C15.5 14 15.5 9 18 4 C20.5 9 20.5 14 18 18Z" style={{ fill: 'var(--paper)', opacity: 0.55 }} />
                            <circle cx={18} cy={wickTop} r="1.5" style={{ fill: color, opacity: 0.9 }} />
                          </g>
                        )}
                      </svg>
                      <span className="letters__candle-label">{TIMEFRAME_LABEL[tf]}</span>
                    </button>
                  )
                })}
              </div>
              </div>

              {/* Controls row: generate + layout toggle */}
              <div className="letters__controls">
                <p className="hint letters__status" role="status">
                  {letterFill ? (
                    `writing ${fillLabel(letterFill.currentLabel)}… (${letterFill.done + 1} of ${letterFill.total})`
                  ) : letterModelMissing ? (
                    'letters are written once the local model is ready. Check Local models in Settings.'
                  ) : letterFillFailed ? (
                    <>
                      some letters could not be written yet.{' '}
                      <button type="button" className="journal__link letters__generate" onClick={() => void fillMissingLetters()}>
                        try again
                      </button>
                    </>
                  ) : LETTER_NEEDS[letterTimeframe]}
                </p>

                <div className="letters__layout-toggle">
                  <button
                    type="button"
                    className={`letters__layout-btn ${letterLayout === 'list' ? 'letters__layout-btn--active' : ''}`}
                    onClick={() => setLetterLayout('list')}
                    aria-label="List view"
                    title="List view"
                  >
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <line x1="1" y1="3" x2="15" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <line x1="1" y1="13" x2="15" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={`letters__layout-btn ${letterLayout === 'grid' ? 'letters__layout-btn--active' : ''}`}
                    onClick={() => setLetterLayout('grid')}
                    aria-label="Grid view"
                    title="Grid view"
                  >
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
                      <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
                      <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
                      <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Letter listing */}
              {filteredLetters.length === 0 ? (
                <p className="journal__empty">
                  No {TIMEFRAME_LABEL[letterTimeframe]} letters yet.
                </p>
              ) : letterLayout === 'list' ? (
                <ul className="journal__list letters__list">
                  {filteredLetters.map((letter) => (
                    <li key={letter.id} className="journal__entry">
                      <button
                        type="button"
                        className="journal__entry-button"
                        onClick={() => turnTo('read-letter', letter.id)}
                      >
                        <span className="journal__date">
                          <span className={`letters__timeframe-dot letters__timeframe-dot--${letter.timeframe}`} aria-hidden="true" />
                          {letter.periodLabel}
                        </span>
                        <span className="journal__preview letters__written-on">
                          written {formatDate(letter.createdAt)}
                          {letter.entryCount !== undefined && ` · from ${letter.entryCount} ${letter.entryCount === 1 ? 'entry' : 'entries'}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="letters__grid">
                  {filteredLetters.map((letter) => (
                    <button
                      key={letter.id}
                      type="button"
                      className="letters__card"
                      onClick={() => turnTo('read-letter', letter.id)}
                    >
                      <span className={`letters__timeframe-dot letters__timeframe-dot--${letter.timeframe}`} aria-hidden="true" />
                      <span className="letters__card-period">{letter.periodLabel}</span>
                      <span className="letters__card-date">{formatDate(letter.createdAt)}</span>
                      {letter.entryCount !== undefined && (
                        <span className="letters__card-date">from {letter.entryCount} {letter.entryCount === 1 ? 'entry' : 'entries'}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </InkScroll>
            <PageDock
              current="recap"
              showLetter={entryCount >= RECAP_MIN_ENTRIES}
              journalActive={journalIconActive}
              onOpenLetters={() => turnTo('recap')}
              onOpenPatterns={() => turnTo('patterns')}
              onOpenJournal={handleOpenJournal}
            />
          </>
        ) : view === 'read-letter' ? (
          <InkScroll as="section" className="read" aria-label="Letter">
            <button
              type="button"
              className="corner corner--write"
              onClick={() => turnTo('recap')}
              aria-label="Back to letters"
              title="Back to letters"
            >
              ‹
            </button>

            {readLetter === null ? (
              <p className="journal__empty"> </p>
            ) : (
              <>
                <div className="read__toolbar">
                  {modelStatus?.reflectionEnabled && modelStatus.reflectionModelFound && (
                    <button
                      type="button"
                      className={`letters__feather ${letterRewriting ? 'letters__feather--writing' : ''}`}
                      onClick={() => void handleRewriteLetter()}
                      disabled={letterRewriting}
                      aria-label="write again"
                      title="write again"
                    >
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 4c-6 0-11 3-12.5 9.5L6 18l4.5-1.5C17 15 20 10 20 4z" />
                        <path d="M6 18c2-4 5-7 9-9.5" />
                        <path d="M4 21c1.5-.8 3-1 5-1" />
                      </svg>
                    </button>
                  )}
                  <DeleteControl
                    noun="letter"
                    confirming={letterDeleteConfirming}
                    setConfirming={setLetterDeleteConfirming}
                    onDelete={() => void handleDeleteLetter()}
                  />
                </div>
                <ScrollFrame showSeal={false}>
                  <div className="journal__date read__date">
                    <span className={`letters__timeframe-dot letters__timeframe-dot--${readLetter.timeframe}`} aria-hidden="true" />
                    {readLetter.periodLabel}
                  </div>
                  {readLetter.entryCount !== undefined && (
                    <p className="hint letters__count">
                      from {readLetter.entryCount} {readLetter.entryCount === 1 ? 'entry' : 'entries'}
                    </p>
                  )}
                  <p className="read__text recap__letter">{readLetter.content}</p>
                  <p className="hint" style={{ textAlign: 'right', marginTop: '1em' }}>
                    written {formatDate(readLetter.createdAt)}
                  </p>
                </ScrollFrame>
              </>
            )}
          </InkScroll>
        ) : view === 'settings' ? (
          <InkScroll as="section" className="settings" aria-label="Settings">
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
                Experimental preview. Reflections and connections can be mistaken. Keep a separate backup
                of important writing. Local models download about 5.5 GB on first launch; writing works
                while they set up. Unsaved drafts are recovered on this device when you reopen Words.
              </p>
              <p className="settings__about-line">
                Words is a local-first journal — everything you write stays on this machine; nothing is sent
                anywhere.
              </p>
              <p className="settings__about-line">
                Write freely on the main page, then Ctrl+Enter to set an entry down. A quiet one-line
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
              <h2 className="settings__label">Handwriting</h2>
              {WRITING_MODE_ORDER.map((mode) => (
                <div key={mode} className="settings__hw-row">
                  <span className="settings__hw-mode">{mode}</span>
                  <div className="settings__options">
                    {(Object.keys(HANDWRITING_FONTS) as HandwritingFont[])
                      .filter((id) => HANDWRITING_FONTS[id].mode === mode)
                      .map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={`settings__option settings__option--font ${
                            (settings?.handwriting?.[mode] ?? DEFAULT_HANDWRITING[mode]) === id ? 'settings__option--active' : ''
                          }`}
                          style={{ fontFamily: `'${HANDWRITING_FONTS[id].family}', var(--serif)` }}
                          onClick={() => void applySettings({ handwriting: { [mode]: id } as Settings['handwriting'] })}
                        >
                          {HANDWRITING_FONTS[id].label}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
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
              <p className="settings__about-line">Reflections: Llama 3.1 8B Instruct (~4.9 GB).</p>
              <p className="settings__about-line">Memory: Qwen3 Embedding 0.6B (~639 MB).</p>
              <p className="settings__about-line">Similar thoughts are found in passages, even when phrased differently. Matches suggest related ideas; they do not prove equivalent code.</p>
              <button className="journal__link" disabled={memoryBusy} onClick={async () => {
                setMemoryBusy(true)
                setMemoryStatus('Rebuilding memory… You can keep writing.')
                try {
                  const result = await window.api.rebuildMemory()
                  setMemoryStatus(`${result.indexed} entries indexed. ${result.failed ? `${result.failed} could not be indexed; check the model and retry.` : 'Memory is ready.'}`)
                } catch { setMemoryStatus('Memory could not be rebuilt. Please retry.') }
                finally { setMemoryBusy(false) }
              }}>rebuild memory with the active model</button>
              <p className="settings__about-line" role="status">{memoryStatus}</p>
              {modelStatus ? (
                <>
                  <p className="settings__about-line">models folder: {modelStatus.modelsDir}</p>
                  <p className="settings__about-line">
                    {modelDirBusy ? (
                      <span>moving model files…</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="journal__link"
                          onClick={() => void handleChooseModelsDir()}
                        >
                          change folder
                        </button>
                        {settings?.modelsDir ? (
                          <>
                            {'  ·  '}
                            <button
                              type="button"
                              className="journal__link"
                              onClick={() => void handleResetModelsDir()}
                            >
                              use default location
                            </button>
                          </>
                        ) : null}
                      </>
                    )}
                  </p>
                  <p className="settings__about-line">
                    By default the models live inside the app’s install folder, so uninstalling Words removes
                    them too. Move them elsewhere here and the existing files come with them.
                  </p>
                  <p className="settings__about-line">
                    reflection model: {!modelStatus.reflectionEnabled ? 'off' : modelStatus.reflectionModelFound ? 'found' : 'not found'}
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
                  {((modelStatus.reflectionEnabled && !modelStatus.reflectionModelFound) || !modelStatus.embeddingModelFound) &&
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
          </InkScroll>
        ) : (
          <>
            <InkScroll as="section" className="journal" aria-label="Journal">
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
                  your letters
                </button>
              )}

              {entries === null ? (
                <p className="journal__empty"> </p>
              ) : entries.length === 0 ? (
                <p className="journal__empty">Nothing written yet. It'll gather here quietly, over time.</p>
              ) : (
                <>
                  <div className="journal__view-toggle">
                    <div className="letters__layout-toggle">
                      <button
                        type="button"
                        className={`letters__layout-btn ${journalView === 'list' ? 'letters__layout-btn--active' : ''}`}
                        onClick={() => void chooseJournalView('list')}
                        aria-label="List view"
                        title="List view"
                      >
                        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <line x1="1" y1="3" x2="15" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          <line x1="1" y1="13" x2="15" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={`letters__layout-btn ${journalView === 'grid' ? 'letters__layout-btn--active' : ''}`}
                        onClick={() => void chooseJournalView('grid')}
                        aria-label="Grid view"
                        title="Grid view"
                      >
                        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
                          <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
                          <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
                          <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {journalView === 'grid' ? (
                    <JournalGrid
                      entries={entries}
                      onOpen={(id) => turnTo('read', id)}
                      formatDate={formatDate}
                      moodOpacity={moodMarkOpacity}
                    />
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
                          {formatDate(entry.createdAt)}{entry.isSample ? ' · sample' : ''}
                        </span>
                        <span className="journal__preview">{entry.preview}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                  )}
                </>
              )}
            </InkScroll>
            <PageDock
              current="journal"
              showLetter={entryCount >= RECAP_MIN_ENTRIES}
              journalActive={journalIconActive}
              onOpenLetters={() => turnTo('recap')}
              onOpenPatterns={() => turnTo('patterns')}
              onOpenJournal={handleOpenJournal}
            />
          </>
        )}
      </div>
    </div>
  )
}
