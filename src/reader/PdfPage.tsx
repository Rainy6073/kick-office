import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { pdfjs, type HighlightSegment, type PDFDoc } from './pdf'
import { registerTextLayer } from './textSelection'

/** Where a link in the PDF goes: another place in the document, or a web address. */
export type PdfLinkTarget = { dest: unknown } | { url: string }

interface Props {
  doc: PDFDoc
  pageNumber: number
  scale: number
  /** Unscaled page size, used to reserve space before the page renders. */
  baseSize: { width: number; height: number }
  highlights?: HighlightSegment[]
  /** Bumped by the parent to ask this page to scroll its selected match into view. */
  scrollRequest?: number
  /** Briefly marks a spot on the page (PDF-space y); a new token replays it. */
  flash?: { y: number; token: number }
  /** Notes shown in the margin beside the page, next to their highlighted text. */
  asides?: { id: string; text: string }[]
  onAside?: (id: string, rect: DOMRect) => void
  /** Called when a link inside the document (e.g. on the contents page) is clicked. */
  onLink?: (dest: unknown) => void
}

const EMPTY: HighlightSegment[] = []

export default function PdfPage({ doc, pageNumber, scale, baseSize, highlights = EMPTY, scrollRequest = 0, flash, asides, onAside, onLink }: Props) {
  const linkRef = useRef<HTMLDivElement>(null)
  const onLinkRef = useRef(onLink)
  onLinkRef.current = onLink
  // Where each margin note's highlight sits on the page, in pixels from the top.
  const [asideTops, setAsideTops] = useState<Map<string, number>>(new Map())
  const asideRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  // Text spans from the TextLayer, plus their original strings, for highlighting.
  const [textDivs, setTextDivs] = useState<{ divs: HTMLElement[]; strs: string[] } | null>(null)
  const handledScrollRef = useRef(0)

  // Only render pages near the viewport so a 150+ page manual stays fast.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '800px 0px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) {
      setTextDivs(null)
      return
    }
    let cancelled = false
    let renderTask: ReturnType<pdfjs.PDFPageProxy['render']> | null = null
    let textLayer: pdfjs.TextLayer | null = null
    let forgetLayer: (() => void) | null = null

    const run = async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const dpr = window.devicePixelRatio || 1

      // Render offscreen, then swap in, so zooming never flashes a blank page.
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      renderTask = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      })
      try {
        await renderTask.promise
      } catch (err) {
        if (err instanceof pdfjs.RenderingCancelledException) return
        throw err
      }
      if (cancelled) return
      canvasHostRef.current?.replaceChildren(canvas)

      const container = document.createElement('div')
      container.className = 'textLayer'
      textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      })
      try {
        await textLayer.render()
      } catch {
        return
      }
      if (cancelled || !textRef.current) return
      textRef.current.replaceChildren(container)
      forgetLayer = registerTextLayer(container)
      setTextDivs({ divs: textLayer.textDivs, strs: textLayer.textContentItemsStr })

      // Links (e.g. the contents page's entries): clickable boxes over the page.
      const annotations = await page.getAnnotations({ intent: 'display' })
      if (cancelled || !linkRef.current) return
      const links: HTMLElement[] = []
      for (const a of annotations) {
        if (a.subtype !== 'Link' || (!a.dest && !a.url)) continue
        const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1])
        const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3])
        const link = document.createElement('a')
        link.className = 'pdf-link'
        Object.assign(link.style, {
          left: `${Math.min(x1, x2)}px`,
          top: `${Math.min(y1, y2)}px`,
          width: `${Math.abs(x2 - x1)}px`,
          height: `${Math.abs(y2 - y1)}px`,
        })
        if (a.url) {
          link.href = a.url
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          link.title = a.url
        } else {
          link.href = '#'
          link.title = 'Go to this section'
          link.addEventListener('click', (e) => {
            e.preventDefault()
            onLinkRef.current?.(a.dest)
          })
        }
        links.push(link)
      }
      linkRef.current.replaceChildren(...links)
    }

    // Re-renders caused by zooming are debounced so pinch gestures stay smooth;
    // the existing bitmap is stretched by CSS in the meantime.
    const hasContent = !!canvasHostRef.current?.firstChild
    const timer = setTimeout(run, hasContent ? 150 : 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
      renderTask?.cancel()
      textLayer?.cancel()
      forgetLayer?.()
    }
  }, [doc, pageNumber, scale, visible])

  // Apply search highlights to the text layer spans.
  useEffect(() => {
    if (!textDivs) return
    const { divs, strs } = textDivs
    const byItem = new Map<number, HighlightSegment[]>()
    for (const seg of highlights) {
      if (seg.end <= seg.start) continue
      const list = byItem.get(seg.item) ?? []
      list.push(seg)
      byItem.set(seg.item, list)
    }

    for (const [item, segs] of byItem) {
      const div = divs[item]
      const str = strs[item]
      if (!div || str === undefined) continue
      // Search matches come after element matches, so on overlap the search highlight wins.
      segs.sort((a, b) => a.start - b.start || Number(!!a.element) - Number(!!b.element))
      const nodes: Node[] = []
      let cursor = 0
      for (const seg of segs) {
        const start = Math.max(seg.start, cursor)
        if (seg.end <= start) continue
        if (start > cursor) nodes.push(document.createTextNode(str.slice(cursor, start)))
        const mark = document.createElement('span')
        mark.className = `highlight${seg.element ? ' element' : ''}${seg.selected ? ' selected' : ''}${seg.note ? (seg.note.hasText ? ' note' : ' marked') : ''}`
        if (seg.note) mark.dataset.note = seg.note.id
        mark.textContent = str.slice(start, seg.end)
        nodes.push(mark)
        cursor = seg.end
      }
      if (cursor < str.length) nodes.push(document.createTextNode(str.slice(cursor)))
      div.replaceChildren(...nodes)
    }

    // Find where each note's text is, for its card in the margin.
    const wrapper = wrapperRef.current
    if (wrapper) {
      const top = wrapper.getBoundingClientRect().top
      const tops = new Map<string, number>()
      for (const mark of textRef.current?.querySelectorAll<HTMLElement>('[data-note]') ?? []) {
        const id = mark.dataset.note!
        if (!tops.has(id)) tops.set(id, mark.getBoundingClientRect().top - top)
      }
      setAsideTops(tops)
    }

    if (scrollRequest !== handledScrollRef.current) {
      const selected = textRef.current?.querySelector('.highlight.selected')
      if (selected) {
        handledScrollRef.current = scrollRequest
        selected.scrollIntoView({ block: 'center', inline: 'nearest' })
      }
    }

    return () => {
      for (const item of byItem.keys()) {
        if (divs[item]) divs[item].textContent = strs[item]
      }
    }
  }, [textDivs, highlights, scrollRequest])

  const width = baseSize.width * scale
  const height = baseSize.height * scale

  // Margin notes sit beside their text, pushed down so they never overlap.
  const shownAsides = (asides ?? []).filter((a) => asideTops.has(a.id)).sort((a, b) => asideTops.get(a.id)! - asideTops.get(b.id)!)
  useLayoutEffect(() => {
    let bottom = -Infinity
    for (const card of asideRef.current?.querySelectorAll<HTMLElement>('[data-aside]') ?? []) {
      const top = Math.max(asideTops.get(card.dataset.aside!) ?? 0, bottom + 8)
      card.style.top = `${top}px`
      bottom = top + card.offsetHeight
    }
  })

  return (
    <div
      ref={wrapperRef}
      className="page"
      data-page={pageNumber}
      style={
        {
          width,
          height,
          '--scale-factor': scale,
          '--user-unit': 1,
          '--total-scale-factor': scale,
        } as React.CSSProperties
      }
    >
      {visible && (
        <>
          <div ref={canvasHostRef} className="canvas-host" />
          <div ref={textRef} className="text-host" />
          <div ref={linkRef} className="link-host" />
        </>
      )}
      {shownAsides.length > 0 && (
        <div className="page-aside" ref={asideRef}>
          {shownAsides.map((a) => (
            <button key={a.id} data-aside={a.id} className="aside-note" onClick={(e) => onAside?.(a.id, e.currentTarget.getBoundingClientRect())} title="Edit note">
              {a.text}
            </button>
          ))}
        </div>
      )}
      {flash && (
        <div
          key={flash.token}
          className="rule-flash"
          style={{ top: (baseSize.height - flash.y - 16) * scale, height: 24 * scale }}
          aria-hidden
        />
      )}
    </div>
  )
}
