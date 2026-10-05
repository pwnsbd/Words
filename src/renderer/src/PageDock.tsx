// The three page-switching marks (letters, patterns, journal) pinned to the
// bottom-right corner. Rendered on the write page and on the Journal, Letters
// and Patterns pages at identical spots so you can hop between them directly.
// The page's own mark stays in place but dimmed and inert, so the dock never
// shifts. The wrapper covers its positioned parent (.page / .write) without
// catching clicks, and sits outside the scroll container, so the icons stay
// put while the page content scrolls.

export type DockPage = 'write' | 'recap' | 'patterns' | 'journal'

type PageDockProps = {
  current: DockPage
  showLetter: boolean
  journalActive: boolean
  onOpenLetters: () => void
  onOpenPatterns: () => void
  onOpenJournal: () => void
}

export function PageDock({
  current, showLetter, journalActive, onOpenLetters, onOpenPatterns, onOpenJournal
}: PageDockProps) {
  const here = (page: DockPage) => (current === page ? ({ 'aria-current': 'page', disabled: true } as const) : {})
  return (
    <div className="page-dock">
      {showLetter && (
        <button type="button" className={`corner letter-icon ${current === 'recap' ? 'dock-icon--here' : ''}`}
          onClick={onOpenLetters} aria-label="A letter from the past" title="A letter from the past" {...here('recap')}>
          <svg viewBox="0 0 34 42" fill="none" aria-hidden="true">
            {/* A folded letter — slightly irregular edges like hand-torn
                parchment, with a small wax seal holding it closed. */}
            <path d="M5 3 C6 2 27 1.5 29 3 C30 4 30.5 14 30 20 C29.5 26 30 34 29 38 C28 39.5 7 40 5 38 C3.5 36.5 3.5 10 5 3Z"
              stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" className="letter-icon__paper" />
            <path d="M8 13 C10 12.8 22 13 24 13" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.35" />
            <path d="M8 18 C11 17.7 20 17.8 23 18" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.3" />
            <path d="M8 23 C10 22.8 17 22.7 19 23" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.25" />
            <circle cx="17" cy="32" r="4" className="letter-icon__seal" />
          </svg>
        </button>
      )}

      <button type="button" className={`corner patterns-icon ${current === 'patterns' ? 'dock-icon--here' : ''}`}
        onClick={onOpenPatterns} aria-label="Open patterns" title="Patterns" {...here('patterns')}>
        <svg viewBox="0 0 40 46" fill="none" aria-hidden="true">
          <path d="M12 41C4 31 33 29 27 18S9 13 14 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="14" cy="8" r="3" /><circle cx="25" cy="23" r="3" /><circle cx="12" cy="37" r="3" />
        </svg>
      </button>

      <button
        type="button"
        className={`corner corner--journal notebook-icon ${journalActive ? 'notebook-icon--active' : ''} ${current === 'journal' ? 'dock-icon--here' : ''}`}
        onClick={onOpenJournal}
        aria-label="Open your journal"
        title="Your journal"
        {...here('journal')}
      >
        <span className="notebook-icon__spine" aria-hidden="true" />
        <span className="notebook-icon__body" aria-hidden="true" />
        <span className="notebook-icon__pen" aria-hidden="true" />
      </button>
    </div>
  )
}
