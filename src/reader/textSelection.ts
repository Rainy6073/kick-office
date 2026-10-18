// Smooth text selection in PDF text layers (adapted from pdf.js's own viewer,
// TextLayerBuilder in pdfjs-dist/web/pdf_viewer.mjs).
//
// A text layer is a pile of absolutely positioned spans with gaps between them.
// When the pointer drifts into a gap while selecting, browsers extend the
// selection to the end of the layer, so it suddenly "highlights everything
// below". Each layer gets an invisible `.endOfContent` block that covers the gaps
// while selecting (see pdf_viewer.css), and, where the browser needs it, is moved
// right after the selection's end so the gaps can't grab the selection.

const layers = new Map<HTMLElement, HTMLElement>()
let listening: AbortController | null = null

/** Makes selecting text in this layer behave; call `forget` when it goes away. */
export function registerTextLayer(layer: HTMLElement) {
  const end = document.createElement('div')
  end.className = 'endOfContent'
  layer.append(end)
  layer.addEventListener('mousedown', () => layer.classList.add('selecting'))
  layers.set(layer, end)
  listen()
  return () => {
    layers.delete(layer)
    if (layers.size === 0) {
      listening?.abort()
      listening = null
    }
  }
}

function reset(end: HTMLElement, layer: HTMLElement) {
  layer.append(end)
  end.style.width = ''
  end.style.height = ''
  end.style.userSelect = ''
  layer.classList.remove('selecting')
}

function listen() {
  if (listening) return
  listening = new AbortController()
  const { signal } = listening
  let pointerDown = false
  let prevRange: Range | null = null
  let nativeFix: boolean | undefined

  document.addEventListener('pointerdown', () => (pointerDown = true), { signal })
  document.addEventListener(
    'pointerup',
    () => {
      pointerDown = false
      layers.forEach(reset)
    },
    { signal },
  )
  window.addEventListener(
    'blur',
    () => {
      pointerDown = false
      layers.forEach(reset)
    },
    { signal },
  )
  document.addEventListener('keyup', () => !pointerDown && layers.forEach(reset), { signal })

  document.addEventListener(
    'selectionchange',
    () => {
      const selection = document.getSelection()
      if (!selection || selection.rangeCount === 0) {
        layers.forEach(reset)
        return
      }
      const active = new Set<HTMLElement>()
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i)
        for (const layer of layers.keys()) if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer)
      }
      for (const [layer, end] of layers) {
        if (active.has(layer)) layer.classList.add('selecting')
        else reset(end, layer)
      }

      // Firefox and Chromium 148+ handle the gaps themselves (as in pdf.js);
      // Safari and older Chromium need the end block moved.
      if (nativeFix === undefined) {
        const first = layers.keys().next().value
        nativeFix = !!first && getComputedStyle(first).getPropertyValue('-moz-user-select') === 'none'
        if (!nativeFix) {
          const version = /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1]
          nativeFix = !!version && parseInt(version, 10) >= 148
        }
      }
      if (nativeFix) return

      // Put the end block right after the end being dragged.
      const range = selection.getRangeAt(0)
      const modifyStart =
        !!prevRange &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0)
      let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer
      if (anchor?.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode
      if ((anchor as HTMLElement | null)?.classList?.contains('highlight')) anchor = anchor!.parentNode
      if (!modifyStart && range.endOffset === 0 && anchor) {
        do {
          while (anchor && !anchor.previousSibling) anchor = anchor.parentNode
          anchor = anchor?.previousSibling ?? null
        } while (anchor && !anchor.childNodes.length)
      }
      const layer = anchor?.parentElement?.closest<HTMLElement>('.textLayer')
      const end = layer ? layers.get(layer) : undefined
      if (anchor && layer && end) {
        end.style.width = layer.style.width
        end.style.height = layer.style.height
        end.style.userSelect = 'text'
        anchor.parentElement!.insertBefore(end, modifyStart ? anchor : anchor.nextSibling)
      }
      prevRange = range.cloneRange()
    },
    { signal },
  )
}
