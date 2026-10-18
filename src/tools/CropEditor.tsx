import { useEffect, useRef, useState } from 'react'
import type { PDFDoc } from '../reader/pdf'
import { renderThumb, type Box } from './fieldExtract'

const EDIT_WIDTH = 760

interface CropProps {
  doc: PDFDoc
  page: number
  box: Box | null
  onBox: (b: Box | null) => void
  onPage: (p: number) => void
  /** What dragging selects, e.g. "just the field". */
  what?: string
}

/** Shows a page of a PDF; dragging on it selects part of the page. */
export default function CropEditor({ doc, page, box, onBox, onPage, what = 'just the field' }: CropProps) {
  const [img, setImg] = useState<{ src: string; scale: number; h: number } | null>(null)
  const [drag, setDrag] = useState<Box | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Bring the selected region into view when the page first appears.
  useEffect(() => {
    const scroller = scrollRef.current
    const area = areaRef.current
    if (!img || !box || !scroller || !area) return
    const shownScale = area.getBoundingClientRect().width / EDIT_WIDTH
    scroller.scrollTop = Math.max(0, box.y * img.scale * shownScale - 24)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const p = await doc.getPage(page)
      const base = p.getViewport({ scale: 1 })
      const src = await renderThumb(doc, page, EDIT_WIDTH)
      if (!cancelled) setImg({ src, scale: EDIT_WIDTH / base.width, h: base.height * (EDIT_WIDTH / base.width) })
    })()
    return () => {
      cancelled = true
    }
  }, [doc, page])

  // iOS can ignore touch-action inside scrolling boxes; stop the page from moving
  // under a finger that is selecting.
  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    const stop = (e: TouchEvent) => startRef.current && e.preventDefault()
    area.addEventListener('touchmove', stop, { passive: false })
    return () => area.removeEventListener('touchmove', stop)
  }, [img])

  const point = (e: React.PointerEvent) => {
    const r = areaRef.current!.getBoundingClientRect()
    // The preview may be shown smaller than it was rendered.
    const k = EDIT_WIDTH / r.width
    return { x: Math.max(0, Math.min(EDIT_WIDTH, (e.clientX - r.left) * k)), y: Math.max(0, Math.min(img!.h, (e.clientY - r.top) * k)) }
  }

  const shown = drag ?? (box && img ? { x: box.x * img.scale, y: box.y * img.scale, w: box.w * img.scale, h: box.h * img.scale } : null)

  return (
    <div className="crop">
      <div className="row">
        <span className="small muted">Drag on the page to select {what}.</span>
        <span style={{ flex: 1 }} />
        <button className="small" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
          ‹ Page
        </button>
        <span className="small crop-page">
          <input
            key={page}
            defaultValue={page}
            inputMode="numeric"
            aria-label="Page number"
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            onBlur={(e) => {
              const n = Math.min(doc.numPages, Math.max(1, parseInt(e.target.value, 10) || page))
              if (n !== page) onPage(n)
              else e.target.value = String(page)
            }}
          />{' '}
          / {doc.numPages}
        </span>
        <button className="small" onClick={() => onPage(Math.min(doc.numPages, page + 1))} disabled={page >= doc.numPages}>
          Page ›
        </button>
        <button className="small" onClick={() => onBox(null)} disabled={!box}>
          Whole page
        </button>
      </div>
      <div className="crop-scroll" ref={scrollRef}>
        {img ? (
          <div
            ref={areaRef}
            className="crop-area"
            onPointerDown={(e) => {
              e.preventDefault()
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch {
                // Capture is best-effort.
              }
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
              if (drag && drag.w > 12 && drag.h > 12) {
                onBox({ x: drag.x / img.scale, y: drag.y / img.scale, w: drag.w / img.scale, h: drag.h / img.scale })
              }
              startRef.current = null
              setDrag(null)
            }}
            onPointerCancel={() => {
              startRef.current = null
              setDrag(null)
            }}
          >
            <img src={img.src} alt={`Page ${page}`} draggable={false} />
            {shown && (
              <div
                className="crop-box"
                style={{
                  left: `${(shown.x / EDIT_WIDTH) * 100}%`,
                  top: `${(shown.y / img.h) * 100}%`,
                  width: `${(shown.w / EDIT_WIDTH) * 100}%`,
                  height: `${(shown.h / img.h) * 100}%`,
                }}
              />
            )}
          </div>
        ) : (
          <div className="thumb-loading big" />
        )}
      </div>
    </div>
  )
}
