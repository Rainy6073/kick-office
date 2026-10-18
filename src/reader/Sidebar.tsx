import { useEffect, useRef, useState } from 'react'
import type { GameElement, OutlineItem } from './pdf'
import { followPointer } from '../drag'

const SPLIT_KEY = 'gmr.sidebarSplit'

interface Props {
  outline: OutlineItem[]
  /** Outline entries containing the current page, outermost first. */
  activePath: string[]
  /** Start with every Contents entry expanded. */
  expandAll?: boolean
  onSelectOutline: (item: OutlineItem) => void
  /** null while the manual's text is still being indexed. */
  elements: GameElement[] | null
  elementPageCounts: Map<string, number>
  selectedElement: string | null
  onSelectElement: (element: GameElement | null) => void
}

export default function Sidebar(props: Props) {
  const asideRef = useRef<HTMLElement>(null)
  // Fraction of the sidebar height given to Contents; the rest goes to Game Elements.
  const [split, setSplit] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SPLIT_KEY))
      if (saved > 0 && saved < 1) return saved
    } catch {
      // Storage unavailable; use the default.
    }
    return 0.6
  })

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(split))
    } catch {
      // Ignore.
    }
  }, [split])

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) =>
    followPointer(
      e,
      (ev) => {
        const rect = asideRef.current!.getBoundingClientRect()
        setSplit(Math.min(0.9, Math.max(0.1, (ev.clientY - rect.top) / rect.height)))
      },
      { cursor: 'row-resize' },
    )

  const nudge = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') setSplit((s) => Math.max(0.1, s - 0.05))
    else if (e.key === 'ArrowDown') setSplit((s) => Math.min(0.9, s + 0.05))
  }

  const { elements, selectedElement } = props

  return (
    <aside className="sidebar" ref={asideRef}>
      <section className="sidebar-pane" style={{ flexBasis: `${split * 100}%` }}>
        <h2>Contents</h2>
        {props.outline.length > 0 ? (
          <Outline items={props.outline} activePath={props.activePath} expandAll={!!props.expandAll} onSelect={props.onSelectOutline} />
        ) : (
          <p className="muted pane-note">This PDF has no bookmarks.</p>
        )}
      </section>

      <div
        className="split-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize contents and game elements"
        aria-valuenow={Math.round(split * 100)}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={nudge}
      />

      <section className="sidebar-pane elements-pane">
        <h2>Game Elements</h2>
        {elements == null ? (
          <p className="muted pane-note">Reading manual…</p>
        ) : elements.length === 0 ? (
          <p className="muted pane-note">No ARENA section found in this manual.</p>
        ) : (
          <ul className="elements">
            {elements.map((el) => {
              const selected = el.name === selectedElement
              return (
                <li key={el.name}>
                  <button
                    className={`element-link${selected ? ' selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => props.onSelectElement(selected ? null : el)}
                    title={selected ? 'Show the full manual' : `Show only pages mentioning ${el.name}`}
                  >
                    <span>{el.name}</span>
                    <span className="muted">{props.elementPageCounts.get(el.name) ?? 0} pp</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </aside>
  )
}

interface OutlineProps {
  activePath: string[]
  expandAll: boolean
  onSelect: (item: OutlineItem) => void
}

function Outline({ items, ...rest }: OutlineProps & { items: OutlineItem[] }) {
  return (
    <ul className="outline">
      {items.map((item) => (
        <OutlineNode key={item.id} item={item} {...rest} />
      ))}
    </ul>
  )
}

function OutlineNode({ item, activePath, expandAll, onSelect }: OutlineProps & { item: OutlineItem }) {
  const [expanded, setExpanded] = useState(expandAll)
  const rowRef = useRef<HTMLButtonElement>(null)
  const hasChildren = item.children.length > 0
  const onPath = activePath.includes(item.id)
  // Highlight the deepest visible entry for the current page: this one, unless an
  // expanded child further down the path will show it instead.
  const childOnPath = expanded && item.children.some((c) => activePath.includes(c.id))
  const active = onPath && !childOnPath

  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <li>
      <div className="outline-row">
        {hasChildren ? (
          <button className="twisty" onClick={() => setExpanded((e) => !e)} aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="twisty" />
        )}
        <button
          ref={rowRef}
          className={`outline-link${active ? ' active' : ''}`}
          aria-current={active ? 'location' : undefined}
          disabled={item.page == null}
          onClick={() => onSelect(item)}
        >
          <span>{item.title}</span>
          {item.page != null && <span className="muted">{item.page}</span>}
        </button>
      </div>
      {hasChildren && expanded && <Outline items={item.children} activePath={activePath} expandAll={expandAll} onSelect={onSelect} />}
    </li>
  )
}
