import { useEffect, useRef, useState } from 'react'
import type { PDFDoc } from '../reader/pdf'
import { renderThumb, type Box } from './fieldExtract'

/** Width pages are drawn at (they're shown at most this wide). */
const RENDER_WIDTH = 760

/** A part of a page: the page, and a box on it in PDF units (null for the whole page). */
export interface PagePick {
  page: number
  box: Box | null
}

interface Props {
  doc: PDFDoc
  /** Each page's size in PDF units. */
  sizes: { width: number; height: number }[]
  pick: PagePick | null
  onPick: (pick: PagePick | null) => void
  /** Page to start scrolled to. */
  startPage: number
  /** Reports the page at the top of the view while scrolling. */
  onPageInView?: (page: number) => void
  /** For touch screens, where a finger drag scrolls: select on one page instead. */
  onSelectOnPage?: (page: number) => void
  /** Scrolls to a page; a new token repeats the jump. */
  jump?: { page: number; token: number }
}

/**
 * The whole PDF in a scrolling column. Dragging on a page (mouse or pen) selects
 * part of it; pages are drawn as they come into view.
 */
export default function ScrollCrop({ doc, sizes, pick, onPick, startPage, onPageInView, onSelectOnPage, jump }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollTo = (page: number) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-clip-page="${page}"]`)
    if (el) scrollRef.current!.scrollTop = el.offsetTop - 8
  }
  // Start at the remembered page; later, wherever a jump asks.
  useEffect(() => {
    scrollTo(startPage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (jump) scrollTo(jump.page)
  }, [jump])

  // Which page is at the top, for the page counter.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || !onPageInView) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        let page = 1
        for (const el of scroller.querySelectorAll<HTMLElement>('[data-clip-page]')) {
          if (el.offsetTop - scroller.scrollTop <= scroller.clientHeight / 3) page = Number(el.dataset.clipPage)
          else break
        }
        onPageInView(page)
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [onPageInView])

  return (
    <div className="scroll-crop" ref={scrollRef}>
      {sizes.map((size, i) => (
        <ClipPage
          key={i}
          doc={doc}
          page={i + 1}
          size={size}
          root={scrollRef}
          box={pick?.page === i + 1 ? pick.box : null}
          picked={pick?.page === i + 1}
          onBox={(box) => onPick({ page: i + 1, box })}
          onSelectOnPage={onSelectOnPage && (() => onSelectOnPage(i + 1))}
        />
      ))}
    </div>
  )
}

function ClipPage({
  doc,
  page,
  size,
  root,
  box,
  picked,
  onBox,
  onSelectOnPage,
}: {
  doc: PDFDoc
  page: number
  size: { width: number; height: number }
  root: React.RefObject<HTMLDivElement | null>
  box: Box | null
  picked: boolean
  onBox: (box: Box | null) => void
  onSelectOnPage?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [drag, setDrag] = useState<Box | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)

  // Draw the page once it's near the view.
  useEffect(() => {
    const el = ref.current
    if (!el || src) return
    let cancelled = false
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        renderThumb(doc, page, RENDER_WIDTH).then((url) => !cancelled && setSrc(url))
      },
      { root: root.current, rootMargin: '600px 0px' },
    )
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [doc, page, root, src])

  /** The pointer's position on the page, in PDF units. */
  const point = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const k = size.width / r.width
    return { x: Math.max(0, Math.min(size.width, (e.clientX - r.left) * k)), y: Math.max(0, Math.min(size.height, (e.clientY - r.top) * k)) }
  }

  const shown = drag ?? box
  return (
    <div
      ref={ref}
      data-clip-page={page}
      className={`clip-page${picked ? ' picked' : ''}`}
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
      onPointerDown={(e) => {
        // A finger drag scrolls; mouse and pen drags select.
        if (e.pointerType === 'touch' || e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        startRef.current = point(e)
        setDrag({ ...startRef.current, w: 0, h: 0 })
      }}
      onPointerMove={(e) => {
        const s = startRef.current
        if (!s) return
        const p = point(e)
        setDrag({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
      }}
      onPointerUp={() => {
        const d = drag
        startRef.current = null
        setDrag(null)
        // A click (no real drag) picks the whole page.
        onBox(d && d.w > 8 && d.h > 8 ? d : null)
      }}
      onPointerCancel={() => {
        startRef.current = null
        setDrag(null)
      }}
    >
      {src ? <img src={src} alt={`Page ${page}`} draggable={false} /> : <span className="clip-loading muted small">Page {page}</span>}
      <span className="clip-page-num">{page}</span>
      {picked && !shown && <span className="clip-whole">Whole page selected</span>}
      {shown && (
        <div
          className="crop-box"
          style={{
            left: `${(shown.x / size.width) * 100}%`,
            top: `${(shown.y / size.height) * 100}%`,
            width: `${(shown.w / size.width) * 100}%`,
            height: `${(shown.h / size.height) * 100}%`,
          }}
        />
      )}
      {onSelectOnPage && (
        <button type="button" className="small clip-select" onPointerDown={(e) => e.stopPropagation()} onClick={onSelectOnPage}>
          ✂ Select on this page
        </button>
      )}
    </div>
  )
}
