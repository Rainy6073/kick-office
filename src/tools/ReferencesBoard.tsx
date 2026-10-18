import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmButton from '../components/ConfirmButton'
import { followPointer } from '../drag'
import { isPasswordError, loadPdf, type PDFDoc } from '../reader/pdf'
import { useLocalState } from '../session'
import { resolveFileUrl, useDoc } from '../sync/store'
import { newId } from '../types'
import CropEditor from './CropEditor'
import { renderRegion } from './fieldExtract'
import { removeLocalFile, saveLocalFile, useLocalFileUrl } from './localFiles'
import ScrollCrop, { type PagePick } from './ScrollCrop'

/** One picture on the board; x, y and w are in board pixels (height follows the picture). */
interface RefItem {
  id: string
  /** The picture, kept on this device (see localFiles.ts). */
  key: string
  x: number
  y: number
  w: number
  /** Height ÷ width of the picture. */
  ratio: number
  z: number
  /** The manual page it was clipped from, if any. */
  page?: number
  note?: string
}

const MIN_W = 80
const BOARD_W = 2400
const BOARD_H = 1600

/**
 * A personal pin-board of important bits of the manual (or any picture): clip parts
 * of manual pages, paste or drop images, then move, resize and label them.
 * Kept on this device only.
 */
export default function ReferencesBoard() {
  const [items, setItems] = useLocalState<RefItem[]>('kickoff.refBoard', [])
  const [zoom, setZoom] = useLocalState('kickoff.refZoom', 1)
  const [selected, setSelected] = useState<string | null>(null)
  const [clipping, setClipping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cascadeRef = useRef(0)

  // The board grows to fit whatever is placed beyond its starting size.
  const width = Math.max(BOARD_W, ...items.map((i) => i.x + i.w + 200))
  const height = Math.max(BOARD_H, ...items.map((i) => i.y + i.w * i.ratio + 200))
  const topZ = Math.max(0, ...items.map((i) => i.z))

  const update = (id: string, fields: Partial<RefItem>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...fields } : i)))
  const bringFront = (id: string) => {
    setSelected(id)
    const item = items.find((i) => i.id === id)
    if (item && item.z !== topZ) update(id, { z: topZ + 1 })
  }
  const removeItem = (id: string) => {
    const item = items.find((i) => i.id === id)
    setItems((list) => list.filter((i) => i.id !== id))
    if (item) removeLocalFile(item.key).catch(() => {})
    setSelected(null)
  }

  /** Adds a picture in the middle of what's on screen (each next one a little offset). */
  const addPicture = async (blob: Blob, page?: number) => {
    try {
      const bitmap = await createImageBitmap(blob)
      const key = `ref-${newId()}`
      await saveLocalFile(key, blob)
      const stage = stageRef.current
      const w = Math.min(460, bitmap.width)
      const ratio = bitmap.height / bitmap.width
      const step = (cascadeRef.current++ % 6) * 28
      const cx = stage ? (stage.scrollLeft + stage.clientWidth / 2) / zoom : 400
      const cy = stage ? (stage.scrollTop + stage.clientHeight / 2) / zoom : 300
      const item: RefItem = {
        id: newId(),
        key,
        x: Math.max(16, Math.round(cx - w / 2 + step)),
        y: Math.max(16, Math.round(cy - (w * ratio) / 2 + step)),
        w,
        ratio,
        z: topZ + 1,
        ...(page ? { page } : {}),
      }
      setItems((list) => [...list, item])
      setSelected(item.id)
      setError(null)
    } catch (err) {
      console.error(err)
      setError('Could not add that picture.')
    }
  }

  // Paste a picture (e.g. a screenshot) straight onto the board.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea')) return
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      files.forEach((f) => addPicture(f))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  // Delete / Backspace removes the selected picture; Escape deselects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault()
        removeItem(selected)
      } else if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const startMove = (e: React.PointerEvent, item: RefItem) => {
    if ((e.target as HTMLElement).closest('input, textarea, button, .ref-resize')) return
    bringFront(item.id)
    const start = { x: e.clientX, y: e.clientY, ix: item.x, iy: item.y }
    followPointer(
      e,
      (ev) =>
        update(item.id, {
          x: Math.max(0, Math.round(start.ix + (ev.clientX - start.x) / zoom)),
          y: Math.max(0, Math.round(start.iy + (ev.clientY - start.y) / zoom)),
        }),
      { cursor: 'grabbing' },
    )
  }
  const startResize = (e: React.PointerEvent, item: RefItem) => {
    e.stopPropagation()
    bringFront(item.id)
    const start = { x: e.clientX, w: item.w }
    followPointer(e, (ev) => update(item.id, { w: Math.max(MIN_W, Math.round(start.w + (ev.clientX - start.x) / zoom)) }), { cursor: 'nwse-resize' })
  }

  const zoomTo = (next: number) => setZoom(Math.round(Math.min(2, Math.max(0.25, next)) * 100) / 100)

  return (
    <div className="ref-board">
      <div className="fb-toolbar">
        <button className="primary" onClick={() => setClipping(true)}>
          ✂ Clip from the manual
        </button>
        <button onClick={() => fileRef.current?.click()}>Add picture…</button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            ;[...(e.target.files ?? [])].forEach((f) => addPicture(f))
            e.target.value = ''
          }}
        />
        <span className="fb-sep" />
        <button className="icon" onClick={() => zoomTo(zoom / 1.25)} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <span className="muted small">{Math.round(zoom * 100)}%</span>
        <button className="icon" onClick={() => zoomTo(zoom * 1.25)} aria-label="Zoom in" title="Zoom in">
          +
        </button>
        <span style={{ flex: 1 }} />
        {error && <span className="error-text small">{error}</span>}
        <span className="muted small">
          {items.length} {items.length === 1 ? 'picture' : 'pictures'} · just on this device
        </span>
        {items.length > 0 && (
          <ConfirmButton
            onConfirm={() => {
              items.forEach((i) => removeLocalFile(i.key).catch(() => {}))
              setItems([])
            }}
            confirmLabel="Clear everything?"
          >
            Clear board
          </ConfirmButton>
        )}
      </div>

      <div
        className="ref-stage"
        ref={stageRef}
        onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          ;[...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')).forEach((f) => addPicture(f))
        }}
      >
        <div className="ref-canvas" style={{ width: width * zoom, height: height * zoom }} onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          <div className="ref-layer" style={{ width, height, transform: `scale(${zoom})` }} onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
            {items.length === 0 && (
              <div className="ref-empty">
                <h3>Your important references</h3>
                <p className="muted">
                  Clip key rules, diagrams and tables from the game manual and arrange them here. You can also add, paste (⌘V) or drop in
                  pictures. Drag to move, use the corner to resize, and add a note under each.
                </p>
                <button className="primary" onClick={() => setClipping(true)}>
                  ✂ Clip from the manual
                </button>
              </div>
            )}
            {items.map((item) => (
              <RefCard
                key={item.id}
                item={item}
                selected={item.id === selected}
                onPointerDown={(e) => startMove(e, item)}
                onResize={(e) => startResize(e, item)}
                onNote={(note) => update(item.id, { note })}
                onRemove={() => removeItem(item.id)}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="muted small fb-hint">Drag pictures to move them · drag the corner to resize · select one and press Delete to remove it · paste or drop pictures to add them.</p>

      {clipping && <ClipPicker onClose={() => setClipping(false)} onClip={(blob, page) => addPicture(blob, page)} />}
    </div>
  )
}

function RefCard({
  item,
  selected,
  onPointerDown,
  onResize,
  onNote,
  onRemove,
}: {
  item: RefItem
  selected: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onResize: (e: React.PointerEvent) => void
  onNote: (note: string) => void
  onRemove: () => void
}) {
  const url = useLocalFileUrl(item.key)
  return (
    <figure
      className={`ref-card${selected ? ' selected' : ''}`}
      style={{ left: item.x, top: item.y, width: item.w, zIndex: item.z }}
      onPointerDown={onPointerDown}
    >
      <div className="ref-img" style={{ aspectRatio: `${1 / item.ratio}` }}>
        {url ? <img src={url} alt={item.note || (item.page ? `Manual page ${item.page}` : 'Reference')} draggable={false} /> : <span className="thumb-loading" />}
      </div>
      <figcaption>
        {item.page && <span className="ref-page">p. {item.page}</span>}
        <input
          defaultValue={item.note ?? ''}
          key={item.note ?? ''}
          placeholder="Add a note…"
          aria-label="Note"
          onBlur={(e) => e.target.value !== (item.note ?? '') && onNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </figcaption>
      <ConfirmButton className="ref-remove icon" onConfirm={onRemove} confirmLabel="✕" aria-label="Remove picture" title="Remove">
        ✕
      </ConfirmButton>
      <span className="ref-resize" onPointerDown={onResize} title="Drag to resize" aria-hidden />
    </figure>
  )
}

/**
 * Picks part of a page of the shared manual to clip onto the board: scroll through
 * the manual and drag a box on any page (or click a page to take all of it).
 */
function ClipPicker({ onClose, onClip }: { onClose: () => void; onClip: (blob: Blob, page: number) => Promise<void> | void }) {
  const manual = useDoc('meta', 'manual')
  const [doc, setDoc] = useState<PDFDoc | null>(null)
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([])
  const [status, setStatus] = useState<string | null>('Opening the manual…')
  const [lastPage, setLastPage] = useLocalState('kickoff.refClipPage', 1)
  const [pageInView, setPageInView] = useState(lastPage)
  const [pick, setPick] = useState<PagePick | null>(null)
  // On a touch screen a finger scrolls, so a page is opened on its own to select on it.
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  const [single, setSingle] = useState<number | null>(null)
  const [jump, setJump] = useState<{ page: number; token: number } | undefined>()
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(0)

  useEffect(() => {
    if (!manual) {
      setStatus('No game manual has been shared yet.')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const d = await loadPdf(await resolveFileUrl(manual.url), manual.password)
        const all = await Promise.all(
          Array.from({ length: d.numPages }, async (_, i) => {
            const vp = (await d.getPage(i + 1)).getViewport({ scale: 1 })
            return { width: vp.width, height: vp.height }
          }),
        )
        if (cancelled) return
        setSizes(all)
        setDoc(d)
        setStatus(null)
      } catch (err) {
        if (!cancelled) setStatus(isPasswordError(err) ? 'The manual is still locked. Unlock it on the Game Manual page first.' : 'Could not open the manual.')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual?.url, manual?.password])

  const onPageInView = useCallback(
    (page: number) => {
      setPageInView(page)
      setLastPage(page)
    },
    [setLastPage],
  )

  const clip = async () => {
    if (!doc || !pick) return
    setBusy(true)
    try {
      await onClip(await renderRegion(doc, pick.page, pick.box, 1600), pick.page)
      setAdded((n) => n + 1)
      setPick(null)
    } finally {
      setBusy(false)
    }
  }

  const startPage = Math.min(Math.max(1, lastPage), Math.max(1, sizes.length))
  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal field-picker clip-picker" onClick={(e) => e.stopPropagation()}>
        <header className="row">
          <h3>Clip from the manual</h3>
          <span className="muted small">{manual?.name}</span>
          <span style={{ flex: 1 }} />
          {doc && single == null && (
            <span className="small crop-page">
              Page{' '}
              <input
                key={pageInView}
                defaultValue={pageInView}
                inputMode="numeric"
                aria-label="Go to page"
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                onBlur={(e) => {
                  const n = Math.min(sizes.length, Math.max(1, parseInt(e.target.value, 10) || pageInView))
                  if (n !== pageInView) setJump({ page: n, token: Date.now() })
                  else e.target.value = String(pageInView)
                }}
              />{' '}
              / {sizes.length}
            </span>
          )}
          <button className="icon ghost" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </header>
        {status && <p className="muted">{status}</p>}
        {doc && single != null && (
          <>
            <button className="small clip-back" onClick={() => setSingle(null)}>
              ← All pages
            </button>
            <CropEditor
              key={single}
              doc={doc}
              page={single}
              box={pick?.page === single ? pick.box : null}
              onBox={(box) => setPick({ page: single, box })}
              onPage={(p) => {
                setSingle(p)
                setPick({ page: p, box: null })
              }}
              what="what to clip (or keep the whole page)"
            />
          </>
        )}
        {doc && single == null && (
          <>
            <p className="muted small clip-hint">
              {touch ? 'Scroll to the page you want, then tap “Select on this page”.' : 'Scroll through the manual and drag a box around what you want, or click a page to take all of it.'}
            </p>
            <ScrollCrop
              doc={doc}
              sizes={sizes}
              pick={pick}
              onPick={setPick}
              startPage={startPage}
              onPageInView={onPageInView}
              jump={jump}
              onSelectOnPage={
                touch
                  ? (p) => {
                      setSingle(p)
                      setPick({ page: p, box: null })
                    }
                  : undefined
              }
            />
          </>
        )}
        <footer className="row end">
          {added > 0 && <span className="muted small">Added {added} ✓ Keep clipping, or close when done.</span>}
          <button onClick={onClose} disabled={busy}>
            {added > 0 ? 'Done' : 'Cancel'}
          </button>
          <button className="primary" onClick={clip} disabled={busy || !pick}>
            {busy ? 'Adding…' : !pick ? 'Select something to clip' : pick.box ? `Add clip from page ${pick.page}` : `Add page ${pick.page}`}
          </button>
        </footer>
      </div>
    </div>
  )
}
