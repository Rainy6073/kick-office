import {
  closestCenter,
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useRef, useState } from 'react'
import ResizeHandle from '../components/ResizeHandle'
import { DropList, Sortable } from '../components/Sortable'
import { useLiveSort } from '../liveSort'
import { formatRatio, ratioTone, valuePerEffort } from '../ratio'
import { cardsFirst, useCardSensors } from '../reorder'
import { useIsPresenter, useLocalState } from '../session'
import { put, remove, useCollection } from '../sync/store'
import { newId, type Ability, type Archetype } from '../types'
import ConfirmButton from '../components/ConfirmButton'

/** Where archetypes are read from and saved to: the shared board or this device's own. */
interface Board {
  archetypes: Archetype[]
  editable: boolean
  save: (a: Archetype) => void
  remove: (id: string) => void
}

// Drag ids: "pal:<ability id>" for the ability list (dropping copies it), "card:<item key>" for a card on an archetype.
const PAL = 'pal:'
const CARD = 'card:'
/** Archetype columns themselves are dragged by "arch:<id>" to put them in order. */
const ARCH = 'arch:'

const rankOf = (a: Archetype) => a.order ?? a.createdAt

// Columns only land on columns, and cards only on cards and columns' card lists.
const collision: CollisionDetection = (args) => {
  const movingColumn = String(args.active.id).startsWith(ARCH)
  const droppableContainers = args.droppableContainers.filter((c) => String(c.id).startsWith(ARCH) === movingColumn)
  return movingColumn ? closestCenter({ ...args, droppableContainers }) : cardsFirst({ ...args, droppableContainers })
}

export default function ArchetypesPage() {
  const presenter = useIsPresenter()
  const abilities = useCollection('abilities')
  const master = useCollection('archetypes')
  const [mine, setMine] = useLocalState<Archetype[]>('kickoff.myArchetypes', [])
  const [view, setView] = useLocalState<'master' | 'mine'>('kickoff.archetypeView', 'master')
  const showingMine = !presenter && view === 'mine'

  const board: Board = showingMine
    ? {
        archetypes: mine,
        editable: true,
        save: (a) => setMine((list) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a])),
        remove: (id) => setMine((list) => list.filter((x) => x.id !== id)),
      }
    : {
        archetypes: master,
        editable: presenter,
        save: (a) => put('archetypes', a),
        remove: (id) => remove('archetypes', id),
      }

  const byId = useMemo(() => new Map(abilities.map((a) => [a.id, a])), [abilities])
  const sortedAbilities = useMemo(() => [...abilities].sort((a, b) => a.createdAt - b.createdAt), [abilities])
  const columns = useMemo(() => [...board.archetypes].sort((a, b) => rankOf(a) - rankOf(b)), [board.archetypes])

  const sensors = useCardSensors()
  // The ability list's width, set with the bar beside it (per device).
  const [paletteWidth, setPaletteWidth] = useLocalState('kickoff.archPaletteWidth', 250)
  const bodyRef = useRef<HTMLDivElement>(null)

  /** The archetype a card is on, and the card. */
  const findCard = (key: string) => {
    for (const a of board.archetypes) {
      const item = a.items.find((i) => i.key === key)
      if (item) return { archetype: a, item }
    }
    return null
  }

  // Cards slide between and within archetypes while dragged. Abilities from the
  // list are copies: they drop in where they are let go.
  const live = useLiveSort({
    lists: Object.fromEntries(columns.map((a) => [a.id, a.items.filter((i) => byId.has(i.abilityId)).map((i) => CARD + i.key)])),
    canEnter: () => board.editable,
    onMove: (id, to, before) => {
      const target = board.archetypes.find((a) => a.id === to)
      if (!target) return
      const beforeKey = before?.slice(CARD.length)
      const insert = (items: Archetype['items'], item: Archetype['items'][number]) => {
        const at = beforeKey ? items.findIndex((i) => i.key === beforeKey) : -1
        const next = [...items]
        next.splice(at === -1 ? next.length : at, 0, item)
        return next
      }
      if (id.startsWith(PAL)) {
        board.save({ ...target, items: insert(target.items, { key: newId(), abilityId: id.slice(PAL.length) }) })
        return
      }
      const found = findCard(id.slice(CARD.length))
      if (!found) return
      if (found.archetype.id === target.id) {
        board.save({ ...target, items: insert(target.items.filter((i) => i.key !== found.item.key), found.item) })
      } else {
        board.save({ ...found.archetype, items: found.archetype.items.filter((i) => i.key !== found.item.key) })
        board.save({ ...target, items: insert(target.items, found.item) })
      }
    },
    // Dropping a card back on the ability list removes it from its archetype.
    onDropElsewhere: (id, overId) => {
      if (overId !== 'palette' || !id.startsWith(CARD)) return
      const found = findCard(id.slice(CARD.length))
      if (found) board.save({ ...found.archetype, items: found.archetype.items.filter((i) => i.key !== found.item.key) })
    },
  })

  const addArchetype = () =>
    board.save({
      id: newId(),
      name: `Archetype ${board.archetypes.length + 1}`,
      items: [],
      createdAt: Date.now(),
      order: (columns.at(-1) ? rankOf(columns.at(-1)!) : 0) + 1000,
    })

  /** Copies an archetype (with its abilities) and puts the copy just after it. */
  const duplicate = (a: Archetype) => {
    const next = columns[columns.indexOf(a) + 1]
    board.save({
      ...a,
      id: newId(),
      name: `${a.name} copy`,
      items: a.items.map((i) => ({ ...i, key: newId() })),
      createdAt: Date.now(),
      order: next ? (rankOf(a) + rankOf(next)) / 2 : rankOf(a) + 1000,
    })
  }

  // Dragging an archetype by its grip moves the whole column; the others slide aside.
  const [movingColumn, setMovingColumn] = useState<string | null>(null)
  const moveColumn = (id: string, overId: string) => {
    const from = columns.findIndex((a) => a.id === id)
    const to = columns.findIndex((a) => a.id === overId)
    if (from === -1 || to === -1 || from === to) return
    const rest = columns.filter((a) => a.id !== id)
    // Dropped on a column to its right: goes after it; to its left: before it.
    const at = rest.findIndex((a) => a.id === overId) + (to > from ? 1 : 0)
    const prev = rest[at - 1]
    const next = rest[at]
    const order = prev && next ? (rankOf(prev) + rankOf(next)) / 2 : prev ? rankOf(prev) + 1000 : next ? rankOf(next) - 1000 : 0
    board.save({ ...columns[from], order })
  }
  const handlers = {
    onDragStart: (e: DragStartEvent) => {
      const id = String(e.active.id)
      if (id.startsWith(ARCH)) setMovingColumn(id.slice(ARCH.length))
      else live.handlers.onDragStart(e)
    },
    onDragOver: (e: DragOverEvent) => {
      if (!String(e.active.id).startsWith(ARCH)) live.handlers.onDragOver(e)
    },
    onDragEnd: (e: DragEndEvent) => {
      const id = String(e.active.id)
      if (!id.startsWith(ARCH)) return live.handlers.onDragEnd(e)
      setMovingColumn(null)
      const over = e.over ? String(e.over.id) : null
      if (over?.startsWith(ARCH)) moveColumn(id.slice(ARCH.length), over.slice(ARCH.length))
    },
    onDragCancel: () => {
      setMovingColumn(null)
      live.handlers.onDragCancel()
    },
  }
  const movingArchetype = movingColumn ? columns.find((a) => a.id === movingColumn) : undefined

  // Replaces your board, so it asks for a second click when there is something on it.
  const copyMaster = () => {
    setMine(master.map((a) => ({ ...a, id: newId(), items: a.items.map((i) => ({ ...i, key: newId() })) })))
  }

  const dragAbility = !live.activeId
    ? undefined
    : live.activeId.startsWith(PAL)
      ? byId.get(live.activeId.slice(PAL.length))
      : byId.get(findCard(live.activeId.slice(CARD.length))?.item.abilityId ?? '')

  return (
    <div className="arch-page">
      <header className="arch-toolbar">
        <div>
          <h2>Robot archetypes</h2>
          <p className="muted small">
            {board.editable
              ? 'Drag abilities onto an archetype. Each ability can be used on as many robots as you like. Drag a card back to the list to remove it.'
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
            <ConfirmButton onConfirm={copyMaster} needsConfirm={mine.length > 0} confirmLabel="Replace your board?">
              Copy master
            </ConfirmButton>
          )}
          {board.editable && (
            <button className="primary" onClick={addArchetype}>
              + Archetype
            </button>
          )}
        </div>
      </header>

      <DndContext sensors={sensors} collisionDetection={collision} {...handlers}>
        <div className="arch-body" ref={bodyRef} style={{ '--palette-w': `${paletteWidth}px` } as React.CSSProperties}>
          {board.editable && <Palette abilities={sortedAbilities} editable />}
          {board.editable && (
            <ResizeHandle
              value={paletteWidth}
              onChange={setPaletteWidth}
              from={bodyRef}
              min={180}
              max={() => (bodyRef.current?.clientWidth ?? 1200) - 300}
              reset={250}
              label="Resize the ability list"
            />
          )}
          <div className="columns">
            <SortableContext items={columns.map((a) => ARCH + a.id)} strategy={horizontalListSortingStrategy}>
              {columns.map((a) => (
                <Column key={a.id} archetype={a} byId={byId} abilities={sortedAbilities} board={board} cards={live.items(a.id)} onDuplicate={() => duplicate(a)} />
              ))}
            </SortableContext>
            {columns.length === 0 && (
              <div className="empty-board muted">
                {board.editable ? 'Create an archetype to start combining abilities.' : 'No archetypes yet.'}
              </div>
            )}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragAbility && <CardFace ability={dragAbility} lifted />}
          {movingArchetype && (
            <div className="column column-lifted">
              <header className="column-head">
                <span className="column-grip">⠿</span>
                <h3>{movingArchetype.name}</h3>
              </header>
              <div className="column-totals muted small">{movingArchetype.items.length} abilities</div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function Palette({ abilities, editable }: { abilities: Ability[]; editable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'palette', disabled: !editable })
  return (
    <aside ref={setNodeRef} className={`palette${isOver ? ' over' : ''}`}>
      <h3>Abilities</h3>
      {abilities.length === 0 && <p className="muted small">Add abilities on the Effort / Value page first.</p>}
      {abilities.map((a) => (
        <PaletteItem key={a.id} ability={a} editable={editable} />
      ))}
    </aside>
  )
}

function PaletteItem({ ability, editable }: { ability: Ability; editable: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: PAL + ability.id, disabled: !editable })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`drag-src${isDragging ? ' ghost' : ''}${editable ? '' : ' static'}`}>
      <CardFace ability={ability} />
    </div>
  )
}

function CardFace({ ability, lifted, onRemove }: { ability: Ability; lifted?: boolean; onRemove?: () => void }) {
  return (
    <div className={`card${lifted ? ' lifted' : ''}`}>
      <span className="card-name">{ability.name}</span>
      <span className="ev-badges">
        <span title="Effort">E {ability.effort ?? '–'}</span>
        <span title="Value">V {ability.value ?? '–'}</span>
        <span title="Value ÷ effort" className={`ratio-badge ${ratioTone(valuePerEffort(ability.effort, ability.value))}`}>
          {formatRatio(valuePerEffort(ability.effort, ability.value))}
        </span>
      </span>
      {onRemove && (
        <button
          className="card-remove"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={onRemove}
          aria-label={`Remove ${ability.name}`}
        >
          ✕
        </button>
      )}
    </div>
  )
}

interface ColumnProps {
  archetype: Archetype
  byId: Map<string, Ability>
  abilities: Ability[]
  board: Board
  /** Its cards' drag ids, in the order shown (rearranged while dragging). */
  cards: string[]
  onDuplicate: () => void
}

function Column({ archetype, byId, abilities, board, cards, onDuplicate }: ColumnProps) {
  const sort = useSortable({ id: ARCH + archetype.id, disabled: !board.editable })
  const items = archetype.items.filter((i) => byId.has(i.abilityId))
  const total = (k: 'effort' | 'value') => items.reduce((sum, i) => sum + (byId.get(i.abilityId)?.[k] ?? 0), 0)

  return (
    <div
      ref={sort.setNodeRef}
      style={{ transform: CSS.Translate.toString(sort.transform), transition: sort.transition }}
      className={`column-slot${sort.isDragging ? ' placeholder' : ''}`}
    >
    <DropList group={archetype.id} enabled={board.editable} className="column">
      <header className="column-head">
        {board.editable && (
          <span
            ref={sort.setActivatorNodeRef}
            {...sort.listeners}
            {...sort.attributes}
            role={undefined}
            className="column-grip"
            title="Drag to move this archetype"
            aria-label={`Move ${archetype.name}`}
          >
            ⠿
          </span>
        )}
        {board.editable ? (
          <input
            key={archetype.name}
            defaultValue={archetype.name}
            aria-label="Archetype name"
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== archetype.name) board.save({ ...archetype, name: v })
              else e.target.value = archetype.name
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        ) : (
          <h3>{archetype.name}</h3>
        )}
        {board.editable && (
          <button className="icon ghost" onClick={onDuplicate} aria-label={`Duplicate ${archetype.name}`} title="Duplicate this archetype">
            ⧉
          </button>
        )}
        {board.editable && (
          <ConfirmButton className="icon ghost" aria-label={`Delete ${archetype.name}`} onConfirm={() => board.remove(archetype.id)} confirmLabel="✕">
            ✕
          </ConfirmButton>
        )}
      </header>
      <div className="column-totals muted small">
        <span>{items.length} abilities</span>
        <span>
          Effort <strong>{total('effort')}</strong>
        </span>
        <span>
          Value <strong>{total('value')}</strong>
        </span>
        <span className={`ratio-total ${ratioTone(valuePerEffort(total('effort'), total('value')))}`} title="Total value ÷ total effort">
          V/E <strong>{formatRatio(valuePerEffort(total('effort'), total('value')))}</strong>
        </span>
      </div>
      <div className="column-cards">
        <SortableContext items={cards} strategy={verticalListSortingStrategy}>
          {cards.map((id) => {
            const found = findItem(id.slice(CARD.length))
            return found && byId.has(found.item.abilityId) ? (
              <ColumnCard key={id} archetype={found.archetype} itemKey={found.item.key} ability={byId.get(found.item.abilityId)!} board={board} />
            ) : null
          })}
        </SortableContext>
        {cards.length === 0 && <p className="drop-hint muted small">{board.editable ? 'Drop abilities here' : 'Empty'}</p>}
      </div>
      {board.editable && abilities.length > 0 && (
        <select
          className="add-select"
          value=""
          aria-label={`Add an ability to ${archetype.name}`}
          onChange={(e) => {
            if (!e.target.value) return
            board.save({ ...archetype, items: [...archetype.items, { key: newId(), abilityId: e.target.value }] })
          }}
        >
          <option value="">+ Add ability…</option>
          {abilities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
    </DropList>
    </div>
  )

  /** A card may be shown here while being dragged in from another archetype. */
  function findItem(key: string) {
    for (const a of board.archetypes) {
      const item = a.items.find((i) => i.key === key)
      if (item) return { archetype: a, item }
    }
    return null
  }
}

function ColumnCard({ archetype, itemKey, ability, board }: { archetype: Archetype; itemKey: string; ability: Ability; board: Board }) {
  return (
    <Sortable id={CARD + itemKey} enabled={board.editable} whole className={`drag-src${board.editable ? '' : ' static'}`} insertFor={(id) => id.startsWith(PAL)}>
      <CardFace
        ability={ability}
        onRemove={board.editable ? () => board.save({ ...archetype, items: archetype.items.filter((i) => i.key !== itemKey) }) : undefined}
      />
    </Sortable>
  )
}
