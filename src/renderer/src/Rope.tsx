import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

// A loose overhand knot in a 16x16 box: a loop with crossing strands. The paper
// under-stroke leaves a small gap where one strand passes over the other.
const KNOT = 'M6 0C6 5 12.5 5 11.5 9C10.5 13.5 3.5 12 5 7.5C6.5 3.5 11.5 6 10 16'

function KnotShape() {
  return (
    <>
      <path d={KNOT} className="knot__gap" />
      <path d={KNOT} className="knot__ink" />
    </>
  )
}

export function Knot({ size = 16 }: { size?: number }) {
  return (
    <svg className="knot" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <KnotShape />
    </svg>
  )
}

// Faint, slightly sagging rope that separates one pattern from the next.
export function SagRope() {
  return (
    <svg className="sagrope" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 1.5C25 8 75 8 100 1.5" />
    </svg>
  )
}

const GUTTER = 32 // px reserved at the left of the timeline for the rope
const ROPE_X = 14
const SWAY = [0, 5, -3, 4, -5, 2, -2, 4]
const KNOT_SCALE = 0.75
const KNOT_DROP = 11 // distance from an item's top to the centre of its first line
const TAIL = 30

// Builds a smooth, gently irregular path: S-curves with vertical tangents, so the
// rope hangs straight through each knot and sways between them.
function ropePath(points: Array<[number, number]>): string {
  let d = `M${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]
    const [x1, y1] = points[i]
    const ym = (y0 + y1) / 2
    d += `C${x0} ${ym} ${x1} ${ym} ${x1} ${y1}`
  }
  return d
}

// A rope hung from a peg, tied in a knot at each list item. Knot positions come from
// the rendered offsets of the items, re-measured whenever the list resizes.
export function RopeTimeline({ children }: { children: ReactNode }) {
  const listRef = useRef<HTMLOListElement>(null)
  const [layout, setLayout] = useState<{ ys: number[]; height: number }>({ ys: [], height: 0 })
  const clipId = useId()

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const ys = Array.from(list.children).map(li => (li as HTMLElement).offsetTop + KNOT_DROP)
      setLayout(prev =>
        prev.height === list.offsetHeight && prev.ys.length === ys.length && prev.ys.every((y, i) => y === ys[i])
          ? prev
          : { ys, height: list.offsetHeight }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [children])

  const { ys, height } = layout
  const knots: Array<[number, number]> = ys.map((y, i) => [ROPE_X + SWAY[(i + 1) % SWAY.length], y])
  const last = knots[knots.length - 1]
  const points: Array<[number, number]> = [[ROPE_X, 5], ...knots]
  if (last) points.push([last[0] + 3, last[1] + TAIL])
  const svgHeight = (last ? last[1] + TAIL : 0) + 6
  const end = points[points.length - 1]
  const d = last ? ropePath(points) : ''

  return (
    <div className="rope">
      {last && (
        <svg className="rope__svg" width={GUTTER} height={Math.max(svgHeight, height)} aria-hidden="true" focusable="false">
          <defs>
            <clipPath id={clipId}>
              <rect className="rope__clip" x="-10" y="0" width={GUTTER + 20} height={svgHeight} />
            </clipPath>
          </defs>
          <g className="rope__peg">
            <circle cx={ROPE_X} cy="4" r="2.2" />
            <path d={`M${ROPE_X - 5} 2.5H${ROPE_X + 5}`} />
          </g>
          <g clipPath={`url(#${clipId})`}>
            <g className="rope__hang">
              <path className="rope__body" d={d} />
              <path className="rope__twist" d={d} />
              <g className="rope__fray">
                <path d={`M${end[0]} ${end[1] - 4}L${end[0] - 3} ${end[1] + 3}`} />
                <path d={`M${end[0]} ${end[1] - 4}L${end[0] + 0.5} ${end[1] + 4}`} />
                <path d={`M${end[0]} ${end[1] - 4}L${end[0] + 3.5} ${end[1] + 2}`} />
              </g>
              {knots.map(([x, y], i) => (
                <g key={i} className="rope__knot" transform={`translate(${x - 8 * KNOT_SCALE} ${y - 8 * KNOT_SCALE}) scale(${KNOT_SCALE})`}>
                  <KnotShape />
                </g>
              ))}
            </g>
          </g>
        </svg>
      )}
      <ol className="pattern__timeline" ref={listRef}>{children}</ol>
    </div>
  )
}
