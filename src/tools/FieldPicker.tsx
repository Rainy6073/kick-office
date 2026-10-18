import { useEffect, useRef, useState } from 'react'
import { isPasswordError, loadPdf, type PDFDoc } from '../reader/pdf'
import { resolveFileUrl, useDoc } from '../sync/store'
import CropEditor from './CropEditor'
import { findFieldCandidates, renderRegion, type Box, type FieldCandidate } from './fieldExtract'

interface Source {
  doc: PDFDoc
  name: string
}

export interface PickedField {
  blob: Blob
  width: number
  height: number
  source: string
}

interface Props {
  onClose: () => void
  onPick: (field: PickedField) => void
}

/** Chooses the field image: found in the shared manual, or uploaded (image or PDF). */
export default function FieldPicker({ onClose, onPick }: Props) {
  const manual = useDoc('meta', 'manual')
  const [source, setSource] = useState<Source | null>(null)
  const [candidates, setCandidates] = useState<FieldCandidate[] | null>(null)
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const [page, setPage] = useState<number | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /** Opens a PDF and looks for the field drawing in it. */
  const openPdf = async (data: string | ArrayBuffer, label: string, password?: string) => {
    setBusy(true)
    setStatus('Looking for the field drawing…')
    setCandidates(null)
    setThumbs({})
    try {
      const doc = await loadPdf(data, password)
      setSource({ doc, name: label })
      const found = await findFieldCandidates(doc)
      setCandidates(found)
      setStatus(found.length ? null : 'No field drawing found automatically. Pick a page below and drag to select the field.')
      if (found[0]) choose(found[0].page, found[0].box)
      else choose(1, null)
      // Previews of each candidate, cropped like they would be used.
      for (const c of found) {
        renderRegion(doc, c.page, c.box, 360).then((blob) => setThumbs((t) => ({ ...t, [c.page]: URL.createObjectURL(blob) })))
      }
    } catch (err) {
      console.error(err)
      setStatus(isPasswordError(err) ? 'That PDF is encrypted. Unlock the manual on the Game Manual page first.' : 'Could not open that PDF.')
    } finally {
      setBusy(false)
    }
  }

  const choose = (p: number, b: Box | null) => {
    setPage(p)
    setBox(b)
  }

  // Start with the shared game manual, if there is one.
  useEffect(() => {
    if (!manual) {
      setStatus('No game manual has been shared yet. Upload a field image or PDF instead.')
      return
    }
    let cancelled = false
    resolveFileUrl(manual.url).then((url) => {
      if (!cancelled) openPdf(url, manual.name, manual.password)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual?.url])

  /** Uses an image as this device's field. */
  const saveImage = async (blob: Blob, label: string) => {
    const bitmap = await createImageBitmap(blob)
    onPick({ blob, width: bitmap.width, height: bitmap.height, source: label })
    onClose()
  }

  const useSelection = async () => {
    if (!source || page == null) return
    setBusy(true)
    setStatus('Saving the field…')
    try {
      await saveImage(await renderRegion(source.doc, page, box), `${source.name}, page ${page}`)
    } catch (err) {
      console.error(err)
      setStatus('Could not save the field image. Try again.')
      setBusy(false)
    }
  }

  const onFile = async (file: File) => {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      openPdf(await file.arrayBuffer(), file.name.replace(/\.pdf$/i, ''))
    } else if (file.type.startsWith('image/')) {
      setBusy(true)
      try {
        await saveImage(file, file.name)
      } catch {
        setStatus('Could not read that image.')
        setBusy(false)
      }
    } else {
      setStatus('Choose an image or a PDF.')
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal field-picker" onClick={(e) => e.stopPropagation()}>
        <header className="row">
          <h3>Choose the field</h3>
          <span className="muted small">{source ? `From ${source.name}` : ''}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}>
            Upload image or PDF…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
              e.target.value = ''
            }}
          />
          <button className="icon ghost" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </header>
        {status && <p className="muted">{status}</p>}

        {candidates && candidates.length > 0 && (
          <div className="candidates">
            {candidates.map((c) => (
              <button key={c.page} className={`candidate${page === c.page ? ' selected' : ''}`} onClick={() => choose(c.page, c.box)}>
                {thumbs[c.page] ? <img src={thumbs[c.page]} alt="" /> : <span className="thumb-loading" />}
                <span className="small">
                  Page {c.page}
                  {c === candidates[0] ? ' · best match' : ''}
                </span>
              </button>
            ))}
          </div>
        )}

        {source && page != null && (
          <CropEditor key={page} doc={source.doc} page={page} box={box} onBox={setBox} onPage={(p) => choose(p, null)} />
        )}

        <footer className="row end">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={useSelection} disabled={busy || !source || page == null}>
            Use this field
          </button>
        </footer>
      </div>
    </div>
  )
}
