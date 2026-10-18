// Dragging a divider (or anything else that follows the pointer until released).
//
// The listeners go on the window rather than the handle: a handle can disappear
// mid-drag (e.g. dragging the Manual page's divider far enough collapses the panel
// or opens the Question Board), and then the release never reaches it, leaving the
// drag "stuck" to the cursor. Here any release, cancel, lost focus, or a move with
// no button held ends the drag.

export function followPointer(
  e: React.PointerEvent,
  onMove: (ev: PointerEvent) => void,
  { cursor = 'col-resize', onEnd }: { cursor?: string; onEnd?: () => void } = {},
) {
  if (e.button !== 0) return
  e.preventDefault()
  const body = document.body
  // The cursor stays the same everywhere while dragging (see App.css).
  body.style.setProperty('--drag-cursor', cursor)
  body.classList.add('resizing')

  const move = (ev: PointerEvent) => {
    // A mouse whose button is no longer down was released somewhere we didn't hear.
    if (ev.pointerType === 'mouse' && ev.buttons === 0) return end()
    onMove(ev)
  }
  const end = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('blur', end)
    body.classList.remove('resizing')
    body.style.removeProperty('--drag-cursor')
    onEnd?.()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('blur', end)
}
