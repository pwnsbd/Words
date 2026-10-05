import { useEffect, useMemo, useState } from 'react'
import type { EntryCardText, EntryEcho, EntrySummary } from '../../shared/types'
import { parseRuns, stripStruckMarkup } from '../../shared/textMarkup'
import { Knot } from './Rope'

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

// First sentence of the (struck-free) text, and what follows it.
export function splitHint(text: string): { hint: string; rest: string } {
  const clean = text.trim()
  const end = clean.search(/[.!?…]+(\s|$)|\n/)
  if (end === -1) return { hint: squash(clean), rest: '' }
  const stop = clean.slice(end).match(/^[.!?…]*/)![0].length
  return { hint: squash(clean.slice(0, end + stop)), rest: clean.slice(end + stop).trim() }
}

// What the card shows under the hint: the echoing passage (with the hint line
// taken off its front if it opens the entry) or, failing that, the next lines.
export function cardBody(
  stripped: string, echo: EntryEcho | undefined
): { text: string; echo: EntryEcho | null } {
  const { hint, rest } = splitHint(stripped)
  if (echo) {
    let passage = squash(echo.passage)
    if (hint && passage.startsWith(hint)) passage = passage.slice(hint.length).trim()
    if (passage && passage !== hint && !hint.startsWith(passage)) return { text: passage, echo }
  }
  return { text: rest, echo: null }
}

interface Props {
  entries: EntrySummary[]
  onOpen: (id: string) => void
  formatDate: (iso: string) => string
  moodOpacity: (mood: number) => number
}

export function JournalGrid({ entries, onOpen, formatDate, moodOpacity }: Props) {
  const [texts, setTexts] = useState<Map<string, EntryCardText>>(new Map())
  const [echoes, setEchoes] = useState<Record<string, EntryEcho>>({})

  useEffect(() => {
    let live = true
    void window.api.getEntryCardTexts()
      .then((list) => { if (live) setTexts(new Map(list.map((t) => [t.id, t]))) })
      .catch(() => {})
    return () => { live = false }
  }, [entries])

  // Echoes never block the grid: cards start on their next lines and the
  // echoes fill in as the main process finishes (or immediately if cached).
  useEffect(() => {
    let live = true
    const load = (): void => {
      void window.api.getEntryEchoes().then((found) => { if (live) setEchoes(found) }).catch(() => {})
    }
    load()
    const stop = window.api.onEchoesReady(load)
    return () => { live = false; stop() }
  }, [entries])

  return (
    <ul className="jgrid">
      {entries.map((entry) => (
        <JournalCard
          key={entry.id}
          entry={entry}
          text={texts.get(entry.id)}
          echo={echoes[entry.id]}
          onOpen={onOpen}
          formatDate={formatDate}
          moodOpacity={moodOpacity}
        />
      ))}
    </ul>
  )
}

function JournalCard({ entry, text, echo, onOpen, formatDate, moodOpacity }: {
  entry: EntrySummary
  text: EntryCardText | undefined
  echo: EntryEcho | undefined
  onOpen: (id: string) => void
  formatDate: (iso: string) => string
  moodOpacity: (mood: number) => number
}) {
  const raw = text?.excerpt ?? entry.preview
  const stripped = useMemo(() => stripStruckMarkup(raw), [raw])
  const { hint } = useMemo(() => splitHint(stripped), [stripped])
  const body = useMemo(() => cardBody(stripped, echo), [stripped, echo])
  const runs = useMemo(() => parseRuns(raw), [raw])
  const returns = body.echo ? body.echo.count : 0

  return (
    <li className="jgrid__cell">
      <button type="button" className="jgrid__card" onClick={() => onOpen(entry.id)}>
        <span className="jgrid__date">
          {entry.mood !== undefined && (
            <span className="journal__mood" style={{ opacity: moodOpacity(entry.mood) }} aria-hidden="true" />
          )}
          {formatDate(entry.createdAt)}{entry.isSample ? ' · sample' : ''}
        </span>

        {/* Hint at rest; the same opening unfolds (struck words kept) on hover/focus. */}
        <span className="jgrid__fold jgrid__fold--hint">
          <span className="jgrid__fold-inner"><span className="jgrid__hint">{hint}</span></span>
        </span>
        <span className="jgrid__fold jgrid__fold--open">
          <span className="jgrid__fold-inner">
            <span className="jgrid__unfold">
              {runs.map((run, i) => run.struck
                ? <s key={i} className="struck-run">{run.text}</s>
                : <span key={i}>{run.text}</span>)}
            </span>
          </span>
        </span>

        {body.text && (
          <span
            className={`jgrid__body ${body.echo ? 'jgrid__body--echo' : ''}`}
            title={body.echo ? `this returns in ${returns} other ${returns === 1 ? 'entry' : 'entries'}` : undefined}
          >
            {body.echo && <Knot size={14} />}
            <span className="jgrid__body-text">{body.text}</span>
          </span>
        )}

        {text?.reflection && <span className="jgrid__reflection">{text.reflection}</span>}
      </button>
    </li>
  )
}
