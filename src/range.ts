// How far the effort / value colouring reaches, following the ratings in use.
import { useEffect, useRef, useState } from 'react'

/** The colouring's reach with nothing rated. */
export const EMPTY_RANGE = 60

/**
 * The top of the colour range: about 60 with nothing rated, otherwise just past
 * the highest rating, so it grows past 60 when something is rated higher and
 * shrinks when everything is rated lower.
 */
export const colorRange = (ratings: number[]) => (ratings.length ? Math.max(5, Math.max(...ratings) * 1.1) : EMPTY_RANGE)

/** Follows `target` smoothly (ease-out over `ms`), for animating a changing range. */
export function useTween(target: number, ms = 700) {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const valueRef = useRef(target)
  valueRef.current = value
  useEffect(() => {
    if (Math.abs(valueRef.current - target) < 1e-6) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setValue(target)
    fromRef.current = valueRef.current
    const start = performance.now()
    let frame = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const eased = 1 - (1 - k) ** 3
      setValue(fromRef.current + (target - fromRef.current) * eased)
      if (k < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, ms])
  return value
}
