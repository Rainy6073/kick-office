import { useEffect } from 'react'

/** How long the merge animation plays, in ms. */
export const MERGE_MS = 2300

/**
 * Played on every screen when the presenter merges the teams: the Effort and Value
 * halves slam together from either side, flash, and burst apart to reveal the
 * combined chart.
 */
export default function MergeBurst({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, MERGE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="merge-burst" role="status" aria-label="The teams merged">
      <div className="mb-half effort">
        <span>Effort</span>
      </div>
      <div className="mb-half value">
        <span>Value</span>
      </div>
      <div className="mb-flash" />
      <div className="mb-ring" />
      <div className="mb-ring late" />
      <div className="mb-title">Merged</div>
    </div>
  )
}
