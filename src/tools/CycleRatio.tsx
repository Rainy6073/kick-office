import { useMemo, useState } from 'react'
import ConfirmButton from '../components/ConfirmButton'
import { useLocalState } from '../session'
import { useCollection } from '../sync/store'
import { newId } from '../types'

/** Points and cycle time for one action; either may still be blank. */
interface Timing {
  points: number | null
  cycle: number | null
}

/** This device's picks: abilities from the shared list, plus its own extra actions. */
interface CycleState {
  selected: string[]
  timings: Record<string, Timing>
  extra: { id: string; name: string }[]
}

const empty: CycleState = { selected: [], timings: {}, extra: [] }
type SortBy = 'list' | 'ratio'

const perSecond = (t: Timing | undefined) => (t?.points != null && t.cycle != null && t.cycle > 0 ? t.points / t.cycle : null)
const fmt = (n: number) => (n >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.?0+$/, '')

/**
 * Points per cycle: pick robot actions, give each the points it scores and how long
 * one cycle takes, and compare points per second. Just for this screen.
 */
export default function CycleRatio() {
  const abilities = useCollection('abilities')
  const [state, setState] = useLocalState<CycleState>('kickoff.cycleTool', empty)
  const [newAction, setNewAction] = useState('')
  const [sortBy, setSortBy] = useLocalState<SortBy>('kickoff.cycleSort', 'ratio')

  const actions = useMemo(
    () => [
      ...[...abilities].sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt)).map((a) => ({ id: a.id, name: a.name, own: false })),
      ...state.extra.map((x) => ({ ...x, own: true })),
    ],
    [abilities, state.extra],
  )
  const byId = new Map(actions.map((a) => [a.id, a]))
  // Picks whose ability was deleted from the shared list drop out.
  const picked = state.selected.filter((id) => byId.has(id))
  const rows = picked.map((id) => ({ ...byId.get(id)!, timing: state.timings[id], ratio: perSecond(state.timings[id]) }))
  const shown = sortBy === 'ratio' ? [...rows].sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1)) : rows
  const best = Math.max(0, ...rows.map((r) => r.ratio ?? 0))

  const toggle = (id: string) =>
    setState((s) => ({ ...s, selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id] }))
  const setTiming = (id: string, fields: Partial<Timing>) =>
    setState((s) => {
      const current: Timing = s.timings[id] ?? { points: null, cycle: null }
      return { ...s, timings: { ...s.timings, [id]: { ...current, ...fields } } }
    })
  const addAction = () => {
    const name = newAction.trim()
    if (!name) return
    const id = `own-${newId()}`
    setState((s) => ({ ...s, extra: [...s.extra, { id, name }], selected: [...s.selected, id] }))
    setNewAction('')
  }
  const removeOwn = (id: string) =>
    setState((s) => ({ ...s, extra: s.extra.filter((x) => x.id !== id), selected: s.selected.filter((x) => x !== id) }))

  const num = (text: string) => (text.trim() === '' ? null : Math.max(0, Number(text)))

  return (
    <div className="cycle-tool">
      <header className="calc-head">
        <div>
          <h2>Points per Cycle</h2>
          <p className="muted small">Pick robot actions, enter the points each scores and how long one cycle takes, and compare points per second.</p>
        </div>
        {picked.length > 0 && (
          <div className="segmented" role="radiogroup" aria-label="Order">
            <button role="radio" aria-checked={sortBy === 'ratio'} onClick={() => setSortBy('ratio')}>
              Best first
            </button>
            <button role="radio" aria-checked={sortBy === 'list'} onClick={() => setSortBy('list')}>
              As picked
            </button>
          </div>
        )}
      </header>

      <section className="cycle-pick">
        <h3>Robot actions</h3>
        {actions.length === 0 && <p className="muted small">Add abilities on the Effort / Value page, or add your own action below.</p>}
        <div className="cycle-chips">
          {actions.map((a) => (
            <button key={a.id} className={`cycle-chip${picked.includes(a.id) ? ' on' : ''}${a.own ? ' own' : ''}`} aria-pressed={picked.includes(a.id)} onClick={() => toggle(a.id)}>
              {picked.includes(a.id) ? '✓ ' : '+ '}
              {a.name}
            </button>
          ))}
        </div>
        <form
          className="add-row"
          onSubmit={(e) => {
            e.preventDefault()
            addAction()
          }}
        >
          <input value={newAction} onChange={(e) => setNewAction(e.target.value)} placeholder="Another action (just for this tool)" aria-label="New action" />
          <button disabled={!newAction.trim()}>Add</button>
        </form>
      </section>

      {rows.length > 0 ? (
        <div className="calc-scroll">
          <table className="cycle-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Points</th>
                <th>Cycle time (s)</th>
                <th>Points / s</th>
                <th className="cycle-bar-col" />
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={r.ratio != null && r.ratio === best && best > 0 ? 'best' : undefined}>
                  <td className="cycle-name">{r.name}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={r.timing?.points ?? ''}
                      placeholder="–"
                      aria-label={`${r.name} points`}
                      onChange={(e) => setTiming(r.id, { points: num(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={r.timing?.cycle ?? ''}
                      placeholder="–"
                      aria-label={`${r.name} cycle time in seconds`}
                      onChange={(e) => setTiming(r.id, { cycle: num(e.target.value) })}
                    />
                  </td>
                  <td className="cycle-ratio">{r.ratio == null ? '–' : fmt(r.ratio)}</td>
                  <td className="cycle-bar-col">
                    {r.ratio != null && best > 0 && <span className="cycle-bar" style={{ width: `${(r.ratio / best) * 100}%` }} />}
                  </td>
                  <td>
                    {r.own ? (
                      <ConfirmButton className="icon ghost" onConfirm={() => removeOwn(r.id)} confirmLabel="✕" aria-label={`Remove ${r.name}`}>
                        ✕
                      </ConfirmButton>
                    ) : (
                      <button className="icon ghost" onClick={() => toggle(r.id)} aria-label={`Take ${r.name} out`} title="Take out (keeps its numbers)">
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {best > 0 && (
            <p className="muted small cycle-note">
              Best:{' '}
              <strong>
                {rows
                  .filter((r) => r.ratio === best)
                  .map((r) => r.name)
                  .join(', ')}
              </strong>{' '}
              at {fmt(best)} points per second ({fmt(best * 60)} per minute).
            </p>
          )}
        </div>
      ) : (
        <p className="empty muted">Pick actions above to compare them.</p>
      )}
    </div>
  )
}
