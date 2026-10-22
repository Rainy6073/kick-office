import { useState } from 'react'
import { followPointer } from '../drag'
import { FIB } from '../fib'
import { colorRange, EMPTY_RANGE, useTween } from '../range'
import type { Team } from '../types'

export interface BoardItem {
  id: string
  name: string
  rating: number | null
}

interface Props {
  team: Team
  items: BoardItem[]
  /** When set, abilities can be dragged (or tapped, then a column tapped) to re-rate them. */
  onRate?: (id: string, rating: number | null) => void
  highlight: string | null
  onHighlight: (id: string | null) => void
}

const GREEN = [24, 160, 88]
const YELLOW = [242, 183, 5]
const RED = [208, 16, 27]

/** Green at 0, yellow halfway, red at 1. */
function tint(t: number, alpha: number) {
  const [a, b, u] = t < 0.5 ? [GREEN, YELLOW, t * 2] : [YELLOW, RED, (t - 0.5) * 2]
  return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * u)).join(' ')} / ${alpha})`
}

/**
 * One team's half of the Effort / Value chart: a column per Fibonacci rating with
 * each ability sitting in its column. Columns are shaded by how good the rating is
 * (low effort and high value are green), over a range that follows the ratings in
 * use like the full chart's.
 */
export default function TeamBoard({ team, items, onRate, highlight, onHighlight }: Props) {
  const rated = items.flatMap((i) => (i.rating == null ? [] : [i.rating]))
  const maxUsed = Math.max(0, ...rated)
  const range = useTween(colorRange(rated))
  const top = Math.max(21, FIB.find((f) => f > maxUsed) ?? FIB[FIB.length - 1], rated.length ? 0 : EMPTY_RANGE)
  const columns = FIB.filter((f) => f <= top)
  const [picked, setPicked] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; name: string; x: number; y: number } | null>(null)

  const startDrag = (e: React.PointerEvent, item: BoardItem) => {
    if (!onRate) return
    const start = { x: e.clientX, y: e.clientY }
    let last = start
    let moved = false
    followPointer(
      e,
      (ev) => {
        last = { x: ev.clientX, y: ev.clientY }
        moved ||= Math.hypot(last.x - start.x, last.y - start.y) > 4
        if (moved) setDrag({ id: item.id, name: item.name, ...last })
      },
      {
        cursor: 'grabbing',
        onEnd: () => {
          setDrag(null)
          if (!moved) return setPicked((p) => (p === item.id ? null : item.id))
          const target = document.elementFromPoint(last.x, last.y)?.closest<HTMLElement>('[data-rating]')
          if (target) onRate(item.id, target.dataset.rating ? Number(target.dataset.rating) : null)
          setPicked(null)
        },
      },
    )
  }

  const place = (rating: number | null) => {
    if (!picked || !onRate) return
    onRate(picked, rating)
    setPicked(null)
  }

  const chip = (item: BoardItem) => (
    <span
      key={item.id}
      className={`tb-chip${item.id === highlight ? ' hot' : ''}${item.id === picked ? ' picked' : ''}${drag?.id === item.id ? ' lifting' : ''}`}
      title={onRate ? `${item.name} · drag to re-rate, or tap then tap a column` : item.name}
      onPointerEnter={() => onHighlight(item.id)}
      onPointerLeave={() => onHighlight(null)}
      onPointerDown={(e) => startDrag(e, item)}
    >
      {item.name}
    </span>
  )

  const unrated = items.filter((i) => i.rating == null)

  return (
    <div className={`team-board ${team}${onRate ? ' editable' : ''}${picked ? ' placing' : ''}${drag ? ' dragging' : ''}`}>
      <header className="tb-head">
        <h3>{team === 'effort' ? 'Effort' : 'Value'}</h3>
        <span className="muted small">
          {team === 'effort' ? 'Low effort is good →  high effort is costly' : 'Low value  →  high value is good'}
        </span>
      </header>
      <div className="tb-columns" role="list">
        {columns.map((f) => {
          const t = Math.min(1, f / range)
          const good = team === 'effort' ? t : 1 - t
          const here = items.filter((i) => i.rating === f)
          return (
            <div
              key={f}
              role="listitem"
              className={`tb-col${here.length ? '' : ' empty'}`}
              data-rating={f}
              style={{ background: `linear-gradient(180deg, ${tint(good, 0.32)}, ${tint(good, 0.12)})`, borderColor: tint(good, 0.55) }}
              onClick={() => place(f)}
            >
              <span className="tb-num" style={{ color: tint(good, 1) }}>
                {f}
              </span>
              <div className="tb-stack">{here.map(chip)}</div>
            </div>
          )
        })}
      </div>
      {(unrated.length > 0 || picked) && (
        <div className="tb-unrated" data-rating="" onClick={() => place(null)}>
          <span className="muted small">{onRate ? 'Not rated yet. Drag into a column:' : 'Not rated yet:'}</span>
          {unrated.map(chip)}
        </div>
      )}
      {drag && (
        <div className="tb-ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.name}
        </div>
      )}
    </div>
  )
}
