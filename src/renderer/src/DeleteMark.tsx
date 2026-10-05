import { useEffect, useRef, useState } from 'react'

// Ink-line wastebasket, same stroke style as the feather. The lid is its own
// group so CSS can lift / close it.
export function DeleteMark({
  label,
  open,
  dropping,
  onClick
}: {
  label: string
  open: boolean
  dropping: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`delete-mark${open ? ' delete-mark--open' : ''}${dropping ? ' delete-mark--dropping' : ''}`}
      onClick={onClick}
      disabled={dropping}
      aria-label={label}
      title={label}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9l1 11h10l1-11" />
        <path d="M10 12v5M14 12v5" />
        <g className="delete-mark__lid">
          <path d="M4.5 7h15" />
          <path d="M9.5 7V5h5v2" />
        </g>
      </svg>
    </button>
  )
}

// The two-step delete: icon, then a quiet "delete this X? yes · never mind"
// line beside it. Confirming plays a short drop-in before onDelete runs.
export function DeleteControl({
  noun,
  confirming,
  setConfirming,
  onDelete
}: {
  noun: 'letter' | 'entry'
  confirming: boolean
  setConfirming: (v: boolean) => void
  onDelete: () => void
}): JSX.Element {
  const [dropping, setDropping] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    if (!confirming) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setConfirming(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming, setConfirming])

  function confirm(): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDelete()
      return
    }
    setDropping(true)
    timer.current = window.setTimeout(() => {
      setDropping(false)
      onDelete()
    }, 300)
  }

  return (
    <>
      {confirming && (
        <span className="delete-confirm">
          <span className="hint">delete this {noun}?</span>
          <button type="button" className="journal__link" disabled={dropping} onClick={confirm}>
            yes
          </button>
          <span className="hint" aria-hidden="true">·</span>
          <button type="button" className="journal__link" disabled={dropping} onClick={() => setConfirming(false)}>
            never mind
          </button>
        </span>
      )}
      <DeleteMark
        label={`delete this ${noun}`}
        open={confirming}
        dropping={dropping}
        onClick={() => setConfirming(!confirming)}
      />
    </>
  )
}
