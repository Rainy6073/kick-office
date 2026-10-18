import type { RefObject } from 'react'
import { followPointer } from '../drag'

interface Props {
  /** The width being set, in pixels, measured from the left of `from`. */
  value: number
  onChange: (width: number) => void
  /** The element the width is measured from (its left edge). */
  from: RefObject<HTMLElement | null>
  min: number
  /** The largest width allowed right now (e.g. leaving room for what's beside it). */
  max: () => number
  /** Double-clicking puts it back to this. */
  reset: number
  label: string
}

/** A vertical bar to drag (or nudge with the arrow keys) to resize what's on its left. */
export default function ResizeHandle({ value, onChange, from, min, max, reset, label }: Props) {
  const clamp = (w: number) => Math.round(Math.max(min, Math.min(w, max())))
  return (
    <div
      className="side-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        const left = from.current?.getBoundingClientRect().left ?? 0
        followPointer(e, (ev) => onChange(clamp(ev.clientX - left)))
      }}
      onDoubleClick={() => onChange(clamp(reset))}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onChange(clamp(value - 24))
        else if (e.key === 'ArrowRight') onChange(clamp(value + 24))
      }}
    />
  )
}
