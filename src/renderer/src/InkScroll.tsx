import { createElement, useCallback, useEffect, useState, type ReactNode, type Ref } from 'react'

// A themed overlay scrollbar. The native scrollbar is hidden by CSS (.ink-host)
// but native scrolling is untouched. The overlay lives on document.body as a
// fixed-position strip aligned to the host's right edge, so it never shifts
// layout, never scrolls with content, and only takes pointer events while it is
// visible. It is driven imperatively (no React state) so scrolling stays cheap.

const HIDE_DELAY = 1200 // ms after the last scroll before the stroke fades
const MOVING_HOLD = 140 // ms without scroll events before the trail starts fading
const EDGE_ZONE = 14 // px from the host's right edge that reveals on hover
const MIN_THUMB = 36

function attachInkScrollbar(host: HTMLElement): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  const hit = document.createElement('div')
  hit.className = 'ink-scroll'
  hit.setAttribute('aria-hidden', 'true')
  const track = document.createElement('div')
  track.className = 'ink-scroll__track'
  const thumb = document.createElement('div')
  thumb.className = 'ink-scroll__thumb'
  const trail = document.createElement('span')
  trail.className = 'ink-scroll__trail'
  const stroke = document.createElement('span')
  stroke.className = 'ink-scroll__stroke'
  thumb.append(trail, stroke)
  hit.append(track, thumb)
  document.body.appendChild(hit)

  let raf = 0
  let hideTimer = 0
  let movingTimer = 0
  let hovering = false
  let dragging = false
  let lastTop = host.scrollTop
  let thumbH = 0
  let trackH = 0
  let maxScroll = 0

  const layout = () => {
    raf = 0
    const rect = host.getBoundingClientRect()
    const overflow = host.scrollHeight - host.clientHeight
    if (rect.width === 0 || rect.height === 0 || overflow <= 1) {
      hit.dataset.active = 'false'
      return
    }
    hit.dataset.active = 'true'
    maxScroll = overflow
    trackH = rect.height
    hit.style.top = `${rect.top}px`
    hit.style.left = `${rect.right - 10}px`
    hit.style.height = `${trackH}px`
    thumbH = Math.max(MIN_THUMB, (host.clientHeight / host.scrollHeight) * trackH)
    const y = (host.scrollTop / maxScroll) * (trackH - thumbH)
    thumb.style.height = `${thumbH}px`
    thumb.style.transform = `translateY(${Math.max(0, Math.min(trackH - thumbH, y))}px)`
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(layout)
  }

  const show = () => {
    hit.dataset.visible = 'true'
    window.clearTimeout(hideTimer)
    if (!hovering && !dragging) hideTimer = window.setTimeout(hide, HIDE_DELAY)
  }
  const hide = () => {
    if (hovering || dragging) return
    hit.dataset.visible = 'false'
  }

  const settle = (edge: 'top' | 'bottom') => {
    if (reduced.matches) return
    stroke.dataset.edge = edge
    stroke.classList.remove('ink-scroll__stroke--settle')
    void stroke.offsetWidth // restart the animation
    stroke.classList.add('ink-scroll__stroke--settle')
  }

  const onScroll = () => {
    const top = host.scrollTop
    const delta = top - lastTop
    lastTop = top
    layout()
    if (hit.dataset.active !== 'true') return
    show()
    if (delta !== 0 && !reduced.matches) {
      thumb.dataset.dir = delta > 0 ? 'down' : 'up'
      thumb.dataset.moving = 'true'
      window.clearTimeout(movingTimer)
      movingTimer = window.setTimeout(() => {
        thumb.dataset.moving = 'false'
      }, MOVING_HOLD)
    }
    if (delta > 0 && top >= maxScroll - 1) settle('bottom')
    else if (delta < 0 && top <= 0) settle('top')
  }

  const onHostMove = (e: MouseEvent) => {
    if (hit.dataset.active !== 'true') return
    if (host.getBoundingClientRect().right - e.clientX <= EDGE_ZONE) show()
  }

  const onEnter = () => {
    hovering = true
    show()
  }
  const onLeave = () => {
    hovering = false
    if (!dragging) show() // restarts the hide timer
  }

  let dragStartY = 0
  let dragStartScroll = 0
  const onThumbDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragging = true
    dragStartY = e.clientY
    dragStartScroll = host.scrollTop
    thumb.setPointerCapture(e.pointerId)
    hit.dataset.dragging = 'true'
    show()
  }
  const onThumbMove = (e: PointerEvent) => {
    if (!dragging) return
    const room = trackH - thumbH
    if (room <= 0) return
    host.scrollTop = dragStartScroll + ((e.clientY - dragStartY) * maxScroll) / room
  }
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    hit.dataset.dragging = 'false'
    if (thumb.hasPointerCapture(e.pointerId)) thumb.releasePointerCapture(e.pointerId)
    show()
  }
  const onTrackDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.target === thumb || thumb.contains(e.target as Node)) return
    e.preventDefault()
    const thumbTop = thumb.getBoundingClientRect().top
    const dir = e.clientY < thumbTop ? -1 : 1
    host.scrollBy({ top: dir * host.clientHeight * 0.9, behavior: reduced.matches ? 'auto' : 'smooth' })
  }

  host.addEventListener('scroll', onScroll, { passive: true })
  host.addEventListener('mousemove', onHostMove, { passive: true })
  hit.addEventListener('pointerenter', onEnter)
  hit.addEventListener('pointerleave', onLeave)
  thumb.addEventListener('pointerdown', onThumbDown)
  thumb.addEventListener('pointermove', onThumbMove)
  thumb.addEventListener('pointerup', endDrag)
  thumb.addEventListener('pointercancel', endDrag)
  hit.addEventListener('pointerdown', onTrackDown)
  window.addEventListener('resize', schedule)
  // Any scrolling ancestor or layout shift moves the host on screen.
  document.addEventListener('scroll', schedule, { passive: true, capture: true })

  const ro = new ResizeObserver(schedule)
  ro.observe(host)
  const mo = new MutationObserver(schedule)
  mo.observe(host, { childList: true, subtree: true, characterData: true })
  schedule()

  return () => {
    cancelAnimationFrame(raf)
    window.clearTimeout(hideTimer)
    window.clearTimeout(movingTimer)
    host.removeEventListener('scroll', onScroll)
    host.removeEventListener('mousemove', onHostMove)
    window.removeEventListener('resize', schedule)
    document.removeEventListener('scroll', schedule, true)
    ro.disconnect()
    mo.disconnect()
    hit.remove()
  }
}

// Hook form: pass the scroll container element (use a state-backed ref callback).
export function useInkScrollbar(host: HTMLElement | null): void {
  useEffect(() => {
    if (!host) return
    return attachInkScrollbar(host)
  }, [host])
}

type InkScrollProps = {
  as?: 'div' | 'section' | 'blockquote'
  className?: string
  innerRef?: Ref<HTMLElement>
  children?: ReactNode
  [attr: string]: unknown
}

// Wrapper form: renders the scroll container itself, hides its native
// scrollbar, and attaches the ink scrollbar.
export function InkScroll({ as = 'div', className, innerRef, children, ...rest }: InkScrollProps) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      setEl(node)
      if (typeof innerRef === 'function') innerRef(node)
      else if (innerRef) (innerRef as { current: HTMLElement | null }).current = node
    },
    [innerRef]
  )
  useInkScrollbar(el)
  return createElement(as, { ...rest, ref: setRef, className: `${className ?? ''} ink-host`.trim() }, children)
}
