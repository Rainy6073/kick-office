import { DndContext, DragOverlay } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useMemo, useRef } from 'react'
import ResizeHandle from '../components/ResizeHandle'
import { DropList, Sortable } from '../components/Sortable'
import { useLiveSort } from '../liveSort'
import { cardsFirst, useCardSensors } from '../reorder'
import { useIsPresenter, useLocalState } from '../session'
import { put, useCollection, useDoc } from '../sync/store'
import type { Ability, Priorities, PriorityTier } from '../types'
import ConfirmButton from '../components/ConfirmButton'

const TIERS: { id: PriorityTier; label: string; hint: string }[] = [
  { id: 'needs', label: 'Needs', hint: 'The robot must do these.' },
  { id: 'wants', label: 'Wants', hint: 'Worth doing if we can.' },
  { id: 'nice', label: 'Nice to Haves', hint: 'Only if there’s time.' },
]

const empty = (id: string): Priorities => ({ id, needs: [], wants: [], nice: [] })

/** Where a card can be dropped: a tier (optionally before a card in it), or back to the unsorted list. */
type Target = { tier: PriorityTier | 'unsorted'; before?: string }

/**
 * Sort the season's robot abilities into Needs, Wants and Nice to Haves. Unlike
 * Archetypes, each ability sits in exactly one place: dragging moves it.
 */
export default function NwhPage() {
  const presenter = useIsPresenter()
  const abilities = useCollection('abilities')
  const master = useDoc('priorities', 'master')
  const [mine, setMine] = useLocalState<Priorities>('kickoff.myPriorities', empty('mine'))
  const [view, setView] = useLocalState<'master' | 'mine'>('kickoff.nwhView', 'master')
  const showingMine = !presenter && view === 'mine'
  const editable = presenter || showingMine
  const board = showingMine ? mine : (master ?? empty('master'))
  const save = (p: Priorities) => (showingMine ? setMine(p) : put('priorities', p))

  const byId = useMemo(() => new Map(abilities.map((a) => [a.id, a])), [abilities])
  const sorted = useMemo(() => [...abilities].sort((a, b) => a.createdAt - b.createdAt), [abilities])
  // Abilities deleted on the Effort / Value page simply drop out.
  const tierIds = (t: PriorityTier) => board[t].filter((id) => byId.has(id))
  const placed = new Set(TIERS.flatMap((t) => tierIds(t.id)))
  const unsorted = sorted.filter((a) => !placed.has(a.id))

  const sensors = useCardSensors()
  // The Unsorted list's width, set with the bar beside it (per device).
  const [paletteWidth, setPaletteWidth] = useLocalState('kickoff.nwhPaletteWidth', 250)
  const bodyRef = useRef<HTMLDivElement>(null)

  const move = (abilityId: string, target: Target) => {
    const next: Priorities = { ...board, needs: [...board.needs], wants: [...board.wants], nice: [...board.nice] }
    for (const t of TIERS) next[t.id] = next[t.id].filter((id) => id !== abilityId)
    if (target.tier !== 'unsorted') {
      const list = next[target.tier]
      const at = target.before ? list.indexOf(target.before) : -1
      list.splice(at === -1 ? list.length : at, 0, abilityId)
    }
    save(next)
  }

  // Cards slide out of the way while dragging; the unsorted list keeps its own order.
  const live = useLiveSort({
    lists: { unsorted: unsorted.map((a) => a.id), ...Object.fromEntries(TIERS.map((t) => [t.id, tierIds(t.id)])) },
    onMove: (id, to, before) => move(id, to === 'unsorted' ? { tier: 'unsorted' } : { tier: to as PriorityTier, before }),
  })
  const dragging = live.activeId

  const mineHasItems = mine.needs.length + mine.wants.length + mine.nice.length > 0
  const copyMaster = () => {
    setMine({ ...(master ?? empty('mine')), id: 'mine' })
  }

  const dragged = dragging ? byId.get(dragging) : undefined

  return (
    <div className="nwh-page">
      <header className="arch-toolbar">
        <div>
          <h2>Needs, Wants &amp; Nice to Haves</h2>
          <p className="muted small">
            {editable
              ? 'Drag each ability into one column. Dragging moves it; drag it back to the list to unsort it.'
              : 'The master board, updated live by the presenter.'}
          </p>
        </div>
        <div className="row">
          {!presenter && (
            <div className="segmented" role="radiogroup" aria-label="Board">
              <button role="radio" aria-checked={view === 'master'} onClick={() => setView('master')}>
                Master board
              </button>
              <button role="radio" aria-checked={view === 'mine'} onClick={() => setView('mine')}>
                My board
              </button>
            </div>
          )}
          {showingMine && (
            <ConfirmButton onConfirm={copyMaster} needsConfirm={mineHasItems} confirmLabel="Replace your board?">
              Copy master
            </ConfirmButton>
          )}
        </div>
      </header>

      <DndContext sensors={sensors} collisionDetection={cardsFirst} {...live.handlers}>
        <div className="arch-body" ref={bodyRef} style={{ '--palette-w': `${paletteWidth}px` } as React.CSSProperties}>
          {editable && (
            <DropList group="unsorted" enabled as="aside" className="palette">
              <h3>
                Unsorted <span className="count-pill">{unsorted.length}</span>
              </h3>
              {abilities.length === 0 && <p className="muted small">Add abilities on the Effort / Value page first.</p>}
              {abilities.length > 0 && unsorted.length === 0 && <p className="muted small">Everything is sorted.</p>}
              <SortableContext items={live.items('unsorted')} strategy={() => null}>
                {live.items('unsorted').map((id) => (
                  <Card key={id} ability={byId.get(id)!} editable />
                ))}
              </SortableContext>
            </DropList>
          )}
          {editable && (
            <ResizeHandle
              value={paletteWidth}
              onChange={setPaletteWidth}
              from={bodyRef}
              min={180}
              max={() => (bodyRef.current?.clientWidth ?? 1200) - 300}
              reset={250}
              label="Resize the Unsorted list"
            />
          )}
          <div className="columns nwh-columns">
            {TIERS.map((t) => {
              const items = live.items(t.id).map((id) => byId.get(id)!)
              return (
                <DropList key={t.id} group={t.id} enabled={editable} className={`column nwh-column tier-${t.id}`}>
                  <header className="column-head">
                    <h3>{t.label}</h3>
                    <span className="count-pill">{items.length}</span>
                  </header>
                  <div className="column-totals muted small">
                    <span>{t.hint}</span>
                  </div>
                  <div className="column-totals muted small">
                    <span>
                      Effort <strong>{items.reduce((s, a) => s + (a.effort ?? 0), 0)}</strong>
                    </span>
                    <span>
                      Value <strong>{items.reduce((s, a) => s + (a.value ?? 0), 0)}</strong>
                    </span>
                  </div>
                  <div className="column-cards">
                    <SortableContext items={live.items(t.id)} strategy={verticalListSortingStrategy}>
                      {items.map((a) => (
                        <Card key={a.id} ability={a} editable={editable} onRemove={editable ? () => move(a.id, { tier: 'unsorted' }) : undefined} />
                      ))}
                    </SortableContext>
                    {items.length === 0 && <p className="drop-hint muted small">{editable ? 'Drop abilities here' : 'Empty'}</p>}
                  </div>
                  {editable && unsorted.length > 0 && (
                    <select
                      className="add-select"
                      value=""
                      aria-label={`Add an ability to ${t.label}`}
                      onChange={(e) => e.target.value && move(e.target.value, { tier: t.id })}
                    >
                      <option value="">+ Add ability…</option>
                      {unsorted.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                </DropList>
              )
            })}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{dragged && <CardFace ability={dragged} lifted />}</DragOverlay>
      </DndContext>
    </div>
  )
}

function Card({ ability, editable, onRemove }: { ability: Ability; editable: boolean; onRemove?: () => void }) {
  return (
    <Sortable id={ability.id} enabled={editable} whole className={`drag-src${editable ? '' : ' static'}`}>
      <CardFace ability={ability} onRemove={onRemove} />
    </Sortable>
  )
}

function CardFace({ ability, lifted, onRemove }: { ability: Ability; lifted?: boolean; onRemove?: () => void }) {
  return (
    <div className={`card${lifted ? ' lifted' : ''}`}>
      <span className="card-name">{ability.name}</span>
      <span className="ev-badges">
        <span title="Effort">E {ability.effort ?? '–'}</span>
        <span title="Value">V {ability.value ?? '–'}</span>
      </span>
      {onRemove && (
        <button className="card-remove" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onClick={onRemove} aria-label={`Move ${ability.name} back to unsorted`}>
          ✕
        </button>
      )}
    </div>
  )
}
