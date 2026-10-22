import { DndContext, DragOverlay } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useMemo, useRef, useState } from 'react'
import ConfirmButton from '../components/ConfirmButton'
import FibInput from '../components/FibInput'
import MergeBurst, { MERGE_MS } from '../components/MergeBurst'
import ScatterChart from '../components/ScatterChart'
import TeamBoard from '../components/TeamBoard'
import { FIB } from '../fib'
import { followPointer } from '../drag'
import { useLiveSort } from '../liveSort'
import { deviceId, useOnline } from '../presence'
import { formatRatio, ratioTone, valuePerEffort } from '../ratio'
import { cardsFirst, useCardSensors } from '../reorder'
import { useIsPresenter, useLocalState, useSession } from '../session'
import { patch, put, remove, useCollection } from '../sync/store'
import { newId, type Ability, type EvSplit, type Presence, type Proposal, type Team, type TeamMember } from '../types'

/** How many suggestions can wait for the presenter at once. */
const QUEUE_MAX = 3

const rankOf = (a: Ability) => a.order ?? a.createdAt
const ratio = (a: Ability) => formatRatio(valuePerEffort(a.effort, a.value))
const ratioClass = (a: Ability) => `ratio ${ratioTone(valuePerEffort(a.effort, a.value))}`

/** An ability's ratings at some moment, for undo. */
type Rating = { id: string; effort: number | null; value: number | null }
const UNDO_LIMIT = 100

const TEAMS: Team[] = ['effort', 'value']
const teamName = (t: Team) => (t === 'effort' ? 'Effort' : 'Value')

const rating = (e: number | null, v: number | null) => (e == null || v == null ? 'not rated' : `E${e} · V${v}`)

type SortKey = 'name' | 'value' | 'effort' | 'ratio'
const SORTS: { id: SortKey; label: string; compare: (a: Ability, b: Ability) => number }[] = [
  { id: 'ratio', label: 'Best value for effort', compare: (a, b) => (b.value ?? 0) / (b.effort ?? 99) - (a.value ?? 0) / (a.effort ?? 99) },
  { id: 'value', label: 'Highest value', compare: (a, b) => (b.value ?? -1) - (a.value ?? -1) },
  { id: 'effort', label: 'Lowest effort', compare: (a, b) => (a.effort ?? 999) - (b.effort ?? 999) },
  { id: 'name', label: 'Name (A–Z)', compare: (a, b) => a.name.localeCompare(b.name) },
]

export default function EffortValuePage() {
  const presenter = useIsPresenter()
  const { name: me } = useSession()
  const abilities = useCollection('abilities')
  const proposals = useCollection('proposals')
  const [name, setName] = useState('')
  // The list's width, set by dragging the divider beside the chart (per device).
  const [listWidth, setListWidth] = useLocalState('kickoff.evListWidth', 440)
  const pageRef = useRef<HTMLDivElement>(null)
  const clampWidth = (w: number) => Math.round(Math.max(300, Math.min(w, (pageRef.current?.clientWidth ?? 1200) - 340)))
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const left = pageRef.current!.getBoundingClientRect().left
    followPointer(e, (ev) => setListWidth(clampWidth(ev.clientX - left)))
  }
  const [highlight, setHighlight] = useState<string | null>(null)
  const sorted = useMemo(() => [...abilities].sort((a, b) => rankOf(a) - rankOf(b)), [abilities])
  const byId = useMemo(() => new Map(abilities.map((a) => [a.id, a])), [abilities])
  // Suggestions for abilities that were since deleted are dropped.
  const queue = useMemo(
    () => proposals.filter((p) => byId.has(p.abilityId)).sort((a, b) => a.createdAt - b.createdAt),
    [proposals, byId],
  )
  const queueFull = queue.length >= QUEUE_MAX

  // Split into teams: each team rates only its own number, kept apart from the
  // abilities' ratings until the presenter merges them back together.
  const split = useCollection('evSplit').find((d) => d.id === 'state')
  const members = useCollection('teamMembers')
  const teamRatings = useCollection('teamRatings')
  const online = useOnline('effort-value')
  const splitOn = !!split?.active
  const myId = deviceId()
  const myTeam = members.find((m) => m.id === myId)?.team
  const isEditor = !!split?.editors.includes(myId)
  const teamRatingById = useMemo(() => new Map(teamRatings.map((r) => [r.id, r])), [teamRatings])
  /** A team's rating for an ability, starting from the ability's own. */
  const teamValue = (team: Team, a: Ability) => {
    const r = teamRatingById.get(`${team}:${a.id}`)
    return r ? r.rating : a[team]
  }
  const rateTeam = (team: Team, abilityId: string, value: number | null) =>
    put('teamRatings', { id: `${team}:${abilityId}`, abilityId, team, rating: value })
  // What the list shows: while split, each column is that team's rating.
  const shown = useMemo(
    () => (splitOn ? sorted.map((a) => ({ ...a, effort: teamValue('effort', a), value: teamValue('value', a) })) : sorted),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [splitOn, sorted, teamRatingById],
  )
  const shownById = useMemo(() => new Map(shown.map((a) => [a.id, a])), [shown])

  const startSplit = () => {
    teamRatings.forEach((r) => remove('teamRatings', r.id))
    members.forEach((m) => remove('teamMembers', m.id))
    put('evSplit', { id: 'state', active: true, editors: split?.editors ?? [], startedAt: Date.now(), mergedAt: split?.mergedAt })
    setProposing(null)
  }
  const joinTeam = (team: Team) => put('teamMembers', { id: myId, name: me, team, joinedAt: Date.now() })
  const toggleEditor = (id: string) =>
    split && patch('evSplit', 'state', { editors: split.editors.includes(id) ? split.editors.filter((e) => e !== id) : [...split.editors, id] })

  // Everyone's screen plays the merge when the split ends while they watch.
  const wasSplit = useRef(false)
  const [burst, setBurst] = useState(false)
  const [entering, setEntering] = useState(false)
  useEffect(() => {
    if (splitOn) wasSplit.current = true
    else if (wasSplit.current) {
      wasSplit.current = false
      setBurst(true)
      setEntering(true)
      const timer = setTimeout(() => setEntering(false), MERGE_MS + 1200)
      return () => clearTimeout(timer)
    }
  }, [splitOn])

  // Presenter: the suggestion being reviewed, with any edits to its numbers.
  const [reviewing, setReviewing] = useState<{ id: string; effort: number | null; value: number | null } | null>(null)
  const reviewed = reviewing ? queue.find((p) => p.id === reviewing.id) : undefined
  // Standard view: the ability someone is suggesting a rating for.
  const [proposing, setProposing] = useState<{ abilityId: string; effort: number | null; value: number | null } | null>(null)

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    put('abilities', { id: newId(), name: trimmed, effort: null, value: null, createdAt: Date.now(), order: (sorted.at(-1) ? rankOf(sorted.at(-1)!) : 0) + 1000 })
    setName('')
  }

  // Rating changes (chart drags, the number boxes, confirmed suggestions) can be
  // undone with ⌘Z / Ctrl+Z and redone with ⇧⌘Z / Ctrl+Y. Kept for this visit.
  const undoRef = useRef<Rating[][]>([])
  const redoRef = useRef<Rating[][]>([])
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 })
  const syncHistory = () => setHistorySize({ undo: undoRef.current.length, redo: redoRef.current.length })
  const snapshot = (ids: string[]): Rating[] =>
    ids.flatMap((id) => {
      const a = byId.get(id)
      return a ? [{ id, effort: a.effort, value: a.value }] : []
    })
  const applyRatings = (ratings: Rating[]) => ratings.forEach((r) => byId.has(r.id) && patch('abilities', r.id, { effort: r.effort, value: r.value }))
  /** Changes ratings, remembering the old ones for undo. */
  const rate = (ratings: Rating[]) => {
    const before = snapshot(ratings.map((r) => r.id))
    if (before.every((b, i) => b.effort === ratings[i]?.effort && b.value === ratings[i]?.value)) return
    undoRef.current = [...undoRef.current.slice(-UNDO_LIMIT + 1), before]
    redoRef.current = []
    applyRatings(ratings)
    syncHistory()
  }
  const step = (from: typeof undoRef, to: typeof undoRef) => {
    const ratings = from.current.pop()
    if (!ratings) return
    to.current.push(snapshot(ratings.map((r) => r.id)))
    applyRatings(ratings)
    syncHistory()
  }
  const undo = () => step(undoRef, redoRef)
  const redo = () => step(redoRef, undoRef)

  /** Writes both teams' ratings into the abilities (undoable) and ends the split. */
  const merge = () => {
    rate(shown.flatMap((a) => (a.effort === byId.get(a.id)?.effort && a.value === byId.get(a.id)?.value ? [] : [{ id: a.id, effort: a.effort, value: a.value }])))
    teamRatings.forEach((r) => remove('teamRatings', r.id))
    members.forEach((m) => remove('teamMembers', m.id))
    if (split) put('evSplit', { ...split, active: false, mergedAt: Date.now() })
  }
  useEffect(() => {
    if (!presenter || splitOn) return
    const onKey = (e: KeyboardEvent) => {
      // Typing in a box keeps the box's own undo.
      if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement).closest('input, textarea, select')) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const startProposal = (id: string) => {
    const a = byId.get(id)
    if (!a || presenter || splitOn) return
    setProposing((p) => (p?.abilityId === id ? null : { abilityId: id, effort: a.effort, value: a.value }))
  }

  const submitProposal = () => {
    if (!proposing || proposing.effort == null || proposing.value == null || queueFull) return
    put('proposals', { id: newId(), abilityId: proposing.abilityId, author: me, effort: proposing.effort, value: proposing.value, createdAt: Date.now() })
    setProposing(null)
  }

  const openReview = (p: Proposal) => setReviewing((r) => (r?.id === p.id ? null : { id: p.id, effort: p.effort, value: p.value }))
  const confirmReview = () => {
    if (!reviewing || !reviewed || reviewing.effort == null || reviewing.value == null) return
    rate([{ id: reviewed.abilityId, effort: reviewing.effort, value: reviewing.value }])
    remove('proposals', reviewed.id)
    setReviewing(null)
  }
  const denyReview = () => {
    if (reviewed) remove('proposals', reviewed.id)
    setReviewing(null)
  }

  // Presenter: drag rows to rearrange the list, or sort it once by a rule.
  const sensors = useCardSensors()
  const live = useLiveSort({
    lists: { abilities: sorted.map((a) => a.id) },
    onMove: (id, _to, before) => {
      const rest = sorted.filter((a) => a.id !== id)
      const at = before ? rest.findIndex((a) => a.id === before) : rest.length
      const prev = rest[at - 1]
      const next = rest[at]
      const order = prev && next ? (rankOf(prev) + rankOf(next)) / 2 : prev ? rankOf(prev) + 1000 : next ? rankOf(next) - 1000 : 0
      patch('abilities', id, { order })
    },
  })
  const dragging = live.activeId
  const sortBy = (key: SortKey) => {
    const rule = SORTS.find((s) => s.id === key)!
    ;[...sorted].sort(rule.compare).forEach((a, i) => a.order !== (i + 1) * 1000 && patch('abilities', a.id, { order: (i + 1) * 1000 }))
  }

  // What the chart shows as a dashed suggestion, and who may move it.
  const chartProposal = reviewing && reviewed
    ? { abilityId: reviewed.abilityId, effort: reviewing.effort, value: reviewing.value }
    : proposing ?? undefined
  const onPropose = reviewing
    ? (effort: number, value: number) => setReviewing((r) => r && { ...r, effort, value })
    : proposing
      ? (effort: number, value: number) => setProposing((p) => p && { ...p, effort, value })
      : undefined
  const focusId = reviewed?.abilityId ?? proposing?.abilityId ?? null

  const myPending = (abilityId: string) => queue.find((p) => p.abilityId === abilityId && p.author === me)

  const mergeOverlay = burst && <MergeBurst onDone={() => setBurst(false)} />

  if (!presenter && splitOn && !myTeam)
    return (
      <div className="ev-page team-pick">
        <div className="team-pick-inner">
          <h2>Pick your team</h2>
          <p className="muted">
            The presenter split Effort / Value into two teams. Each team rates just one number for every ability. Once you join a team you stay on it;
            only the presenter can move you.
          </p>
          <div className="team-pick-options">
            {TEAMS.map((t) => (
              <ConfirmButton key={t} className={`team-option ${t}`} onConfirm={() => joinTeam(t)} confirmLabel={<span className="team-option-confirm">Click again to join {teamName(t)}</span>}>
                <span className="team-option-name">{teamName(t)}</span>
                <span className="team-option-hint">{t === 'effort' ? 'How hard is each ability to build?' : 'How much is each ability worth in a match?'}</span>
                <span className="team-option-count">{members.filter((m) => m.team === t).length} joined</span>
              </ConfirmButton>
            ))}
          </div>
        </div>
      </div>
    )

  if (!presenter && splitOn && myTeam)
    return (
      <div className="ev-page" ref={pageRef} style={{ '--ev-list-w': `${listWidth}px` } as React.CSSProperties}>
        <section className="ev-list">
          <div className={`team-banner ${myTeam}`}>
            <strong>You're on the {teamName(myTeam)} team</strong>
            <span className="small">
              {isEditor
                ? `You're an editor: drag abilities into a column, or use the boxes, to rate their ${myTeam}.`
                : `Rate only ${myTeam}. You're watching for now; the presenter can make you an editor.`}
            </span>
            <span className="muted small">Locked in: only the presenter can move you to the other team.</span>
          </div>
          <div className="ability-table" role="table">
            <div className="ability-row head solo" role="row">
              <span role="columnheader">Ability</span>
              <span role="columnheader" className="h-num">
                {teamName(myTeam)}
              </span>
            </div>
            {sorted.length === 0 && <p className="empty muted">No abilities yet.</p>}
            {sorted.map((a) => (
              <div
                key={a.id}
                role="row"
                className={`ability-row solo${highlight === a.id ? ' hot' : ''}`}
                onPointerEnter={() => setHighlight(a.id)}
                onPointerLeave={() => setHighlight(null)}
              >
                <span className="ability-name" role="cell">
                  {a.name}
                </span>
                {isEditor ? (
                  <FibInput label={teamName(myTeam)} value={teamValue(myTeam, a)} onChange={(v) => rateTeam(myTeam, a.id, v)} />
                ) : (
                  <span className="score" role="cell">
                    {teamValue(myTeam, a) ?? '–'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
        <div
          className="side-resize ev-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the abilities list"
          onPointerDown={startResize}
          onDoubleClick={() => setListWidth(440)}
        />
        <section className="ev-chart ev-teams">
          <TeamBoard
            team={myTeam}
            items={sorted.map((a) => ({ id: a.id, name: a.name, rating: teamValue(myTeam, a) }))}
            onRate={isEditor ? (id, v) => rateTeam(myTeam, id, v) : undefined}
            highlight={highlight}
            onHighlight={setHighlight}
          />
        </section>
      </div>
    )

  return (
    <div className="ev-page" ref={pageRef} style={{ '--ev-list-w': `${listWidth}px` } as React.CSSProperties}>
      <section className="ev-list">
        <header className="section-head">
          <h2>Robot abilities</h2>
          <span className="muted">{sorted.length} total</span>
        </header>
        <p className="muted small">
          Rate effort and value on the Fibonacci scale ({FIB.slice(0, 7).join(', ')}…)
          {presenter ? ', or drag points on the chart.' : '. Click an ability to suggest a rating to the presenter.'}
        </p>

        {presenter && splitOn && split && (
          <TeamsPanel split={split} members={members} online={online} onToggleEditor={toggleEditor} onUnstick={(id) => remove('teamMembers', id)} onMerge={merge} />
        )}

        {presenter && queue.length > 0 && (
          <div className="proposal-queue">
            <h3>
              Suggested ratings <span className="count-pill">{queue.length} / {QUEUE_MAX}</span>
            </h3>
            {queue.map((p) => {
              const a = byId.get(p.abilityId)!
              const open = reviewing?.id === p.id
              return (
                <div key={p.id} className={`proposal-item${open ? ' open' : ''}`}>
                  <button className="proposal-summary" onClick={() => openReview(p)} aria-expanded={open}>
                    <strong>{a.name}</strong>
                    <span className="proposal-change">
                      {rating(a.effort, a.value)} → <b>{rating(p.effort, p.value)}</b>
                    </span>
                    <span className="muted small">from {p.author}</span>
                  </button>
                  {open && reviewing && (
                    <div className="proposal-review">
                      <p className="muted small">Shown dashed on the chart. Change the numbers (or drag the dashed point) before confirming if you like.</p>
                      <div className="proposal-inputs">
                        <label>
                          <span className="muted small">Effort</span>
                          <FibInput label="Effort" value={reviewing.effort} onChange={(effort) => setReviewing({ ...reviewing, effort })} />
                        </label>
                        <label>
                          <span className="muted small">Value</span>
                          <FibInput label="Value" value={reviewing.value} onChange={(value) => setReviewing({ ...reviewing, value })} />
                        </label>
                      </div>
                      <div className="row">
                        <button className="primary" onClick={confirmReview} disabled={reviewing.effort == null || reviewing.value == null}>
                          {reviewing.effort === p.effort && reviewing.value === p.value ? 'Confirm' : 'Confirm edited'}
                        </button>
                        <button className="danger" onClick={denyReview}>
                          Deny
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {presenter && (
          <div className="row ev-tools">
            <form
              className="add-row"
              onSubmit={(e) => {
                e.preventDefault()
                add()
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Climb L2 tower" aria-label="New ability" />
              <button className="primary" disabled={!name.trim()}>
                Add
              </button>
            </form>
            {!splitOn && (
              <button onClick={startSplit} title="Split everyone into an Effort team and a Value team, each rating one number">
                Split into teams
              </button>
            )}
            <select value="" onChange={(e) => e.target.value && sortBy(e.target.value as SortKey)} aria-label="Sort the list" disabled={sorted.length < 2}>
              <option value="">Sort list…</option>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={cardsFirst}
          {...live.handlers}
        >
          <div className="ability-table" role="table">
            <div className="ability-row head" role="row">
              {presenter && <span />}
              <span role="columnheader">Ability</span>
              <span role="columnheader" className="h-num">
                Effort
              </span>
              <span role="columnheader" className="h-num">
                Value
              </span>
              <span role="columnheader" className="h-num" title="Value ÷ effort: how much value each unit of effort buys">
                V/E
              </span>
              {presenter && <span />}
            </div>
            {sorted.length === 0 && (
              <p className="empty muted">{presenter ? 'Add everything a robot could do this season.' : 'No abilities yet.'}</p>
            )}
            <SortableContext items={live.items('abilities')} strategy={verticalListSortingStrategy}>
            {live.items('abilities').map((id) => shownById.get(id)!).map((a) => (
              <AbilityRow
                key={a.id}
                ability={a}
                presenter={presenter}
                onRate={(r) =>
                  splitOn
                    ? (Object.keys(r) as Team[]).forEach((t) => rateTeam(t, a.id, r[t] ?? null))
                    : rate([{ id: a.id, effort: a.effort, value: a.value, ...r }])
                } hot={highlight === a.id || focusId === a.id} onHot={setHighlight} onPick={() => startProposal(a.id)}>
                {!presenter && proposing?.abilityId === a.id && (
                  <div className="proposal-review mine">
                    {myPending(a.id) ? (
                      <p className="small">
                        Your suggestion <b>{rating(myPending(a.id)!.effort, myPending(a.id)!.value)}</b> is waiting for the presenter.{' '}
                        <ConfirmButton className="link danger small" onConfirm={() => remove('proposals', myPending(a.id)!.id)} confirmLabel="Click again to withdraw">
                          Withdraw
                        </ConfirmButton>
                      </p>
                    ) : (
                      <>
                        <p className="muted small">Click the chart (or drag the dashed point) to choose, or pick the numbers here.</p>
                        <div className="proposal-inputs">
                          <label>
                            <span className="muted small">Effort</span>
                            <FibInput label="Effort" value={proposing.effort} onChange={(effort) => setProposing({ ...proposing, effort })} />
                          </label>
                          <label>
                            <span className="muted small">Value</span>
                            <FibInput label="Value" value={proposing.value} onChange={(value) => setProposing({ ...proposing, value })} />
                          </label>
                        </div>
                        {queueFull && <p className="error-text small">The presenter already has {QUEUE_MAX} suggestions to review. Try again in a bit.</p>}
                        <div className="row">
                          <button className="primary" onClick={submitProposal} disabled={queueFull || proposing.effort == null || proposing.value == null}>
                            Submit suggestion
                          </button>
                          <button onClick={() => setProposing(null)}>Cancel</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </AbilityRow>
            ))}
            </SortableContext>
          </div>
          <DragOverlay dropAnimation={null}>
            {dragging && byId.get(dragging) && <div className="ability-row lifted">{byId.get(dragging)!.name}</div>}
          </DragOverlay>
        </DndContext>
      </section>

      <div
        className="side-resize ev-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the abilities list"
        aria-valuenow={listWidth}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={startResize}
        onDoubleClick={() => setListWidth(440)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setListWidth((w) => clampWidth(w - 24))
          else if (e.key === 'ArrowRight') setListWidth((w) => clampWidth(w + 24))
        }}
      />

      {splitOn ? (
        <section className="ev-chart ev-teams">
          {TEAMS.map((t) => (
            <TeamBoard
              key={t}
              team={t}
              items={shown.map((a) => ({ id: a.id, name: a.name, rating: a[t] }))}
              onRate={presenter ? (id, v) => rateTeam(t, id, v) : undefined}
              highlight={highlight}
              onHighlight={setHighlight}
            />
          ))}
        </section>
      ) : (
      <section className="ev-chart">
        <ScatterChart
          entering={entering}
          abilities={sorted}
          highlight={highlight ?? focusId}
          onHighlight={setHighlight}
          onRate={presenter ? (ids, effort, value) => rate(ids.map((id) => ({ id, effort, value }))) : undefined}
          onUndo={presenter ? { undo, redo, canUndo: historySize.undo > 0, canRedo: historySize.redo > 0 } : undefined}
          proposal={chartProposal}
          onPropose={onPropose}
          onPick={presenter ? undefined : startProposal}
        />
      </section>
      )}
      {mergeOverlay}
    </div>
  )
}

/** The presenter's view of the teams: who is on each, who may edit, and merging. */
function TeamsPanel({
  split,
  members,
  online,
  onToggleEditor,
  onUnstick,
  onMerge,
}: {
  split: EvSplit
  members: TeamMember[]
  online: Presence[]
  onToggleEditor: (id: string) => void
  onUnstick: (id: string) => void
  onMerge: () => void
}) {
  const [choosing, setChoosing] = useState(false)
  const here = new Set(online.map((p) => p.id))
  // Standard viewers on this screen now, plus editors who have since left.
  const people = [
    ...online.filter((p) => p.role === 'standard').map((p) => ({ id: p.id, name: p.name })),
    ...members.filter((m) => !here.has(m.id) && split.editors.includes(m.id)),
  ]
  const choosingTeam = online.filter((p) => p.role === 'standard' && !members.some((m) => m.id === p.id))
  return (
    <div className="teams-panel">
      <h3>
        Teams <span className="count-pill">{members.length} joined</span>
      </h3>
      <div className="teams-cols">
        {TEAMS.map((t) => (
          <div key={t} className={`team-list ${t}`}>
            <h4>{teamName(t)} team</h4>
            {members.filter((m) => m.team === t).length === 0 && <p className="muted small">No one yet.</p>}
            {members
              .filter((m) => m.team === t)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((m) => (
                <div key={m.id} className="team-member">
                  <span className={`presence-dot${here.has(m.id) ? ' on' : ''}`} title={here.has(m.id) ? 'On this screen' : 'Not on this screen'} />
                  <span className="team-member-name">{m.name}</span>
                  {split.editors.includes(m.id) && <span className="editor-badge">Editor</span>}
                  <button className="link small" onClick={() => onUnstick(m.id)} title="Take them off this team so they can choose again">
                    Unstick
                  </button>
                </div>
              ))}
          </div>
        ))}
      </div>
      {choosingTeam.length > 0 && <p className="muted small">Still choosing: {choosingTeam.map((p) => p.name).join(', ')}</p>}
      <div className="row teams-actions">
        <button onClick={() => setChoosing((c) => !c)} aria-expanded={choosing}>
          Editors… <span className="count-pill">{split.editors.length}</span>
        </button>
        <ConfirmButton className="primary merge-btn" onConfirm={onMerge} confirmLabel="Click again to merge">
          Merge everyone
        </ConfirmButton>
      </div>
      {choosing && (
        <div className="editor-picker">
          <p className="muted small">People on this screen now. Editors can change their own team's ratings.</p>
          {people.length === 0 && <p className="muted small">No one else is on the Effort / Value screen right now.</p>}
          {people.map((p) => {
            const m = members.find((x) => x.id === p.id)
            return (
              <label key={p.id} className="editor-option">
                <input type="checkbox" checked={split.editors.includes(p.id)} onChange={() => onToggleEditor(p.id)} />
                <span className="team-member-name">{p.name}</span>
                <span className="muted small">{m ? `${teamName(m.team)} team` : 'choosing a team'}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AbilityRow({
  ability: a,
  presenter,
  hot,
  onHot,
  onPick,
  onRate,
  children,
}: {
  ability: Ability
  presenter: boolean
  onRate: (r: Partial<Pick<Ability, 'effort' | 'value'>>) => void
  hot: boolean
  onHot: (id: string | null) => void
  onPick: () => void
  children?: React.ReactNode
}) {
  const drag = useSortable({ id: a.id, disabled: !presenter })
  return (
    <div
      ref={drag.setNodeRef}
      style={{ transform: CSS.Translate.toString(drag.transform), transition: drag.transition }}
      className={`ability-item${drag.isDragging ? ' placeholder' : ''}`}
    >
      <div
        role="row"
        className={`ability-row${hot ? ' hot' : ''}${presenter ? '' : ' pickable'}`}
        onPointerEnter={() => onHot(a.id)}
        onPointerLeave={() => onHot(null)}
        onClick={presenter ? undefined : onPick}
        title={presenter ? undefined : 'Suggest a rating'}
      >
        {presenter ? (
          <>
            <span ref={drag.setActivatorNodeRef} {...drag.listeners} {...drag.attributes} role={undefined} className="row-grip" title="Drag to reorder">
              ⠿
            </span>
            <input
              className="ability-name"
              defaultValue={a.name}
              key={a.name}
              aria-label="Ability name"
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== a.name) patch('abilities', a.id, { name: v })
                else e.target.value = a.name
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <FibInput label="Effort" value={a.effort} onChange={(effort) => onRate({ effort })} />
            <FibInput label="Value" value={a.value} onChange={(value) => onRate({ value })} />
            <span className={ratioClass(a)} title="Value ÷ effort">
              {ratio(a)}
            </span>
            <ConfirmButton
              className="icon ghost"
              aria-label={`Delete ${a.name}`}
              title="Delete (also removes it from archetypes)"
              onConfirm={() => remove('abilities', a.id)}
              confirmLabel="✕"
            >
              ✕
            </ConfirmButton>
          </>
        ) : (
          <>
            <span className="ability-name" role="cell">
              {a.name}
            </span>
            <span className="score" role="cell">
              {a.effort ?? '–'}
            </span>
            <span className="score" role="cell">
              {a.value ?? '–'}
            </span>
            <span className={ratioClass(a)} role="cell" title="Value ÷ effort">
              {ratio(a)}
            </span>
          </>
        )}
      </div>
      {children}
    </div>
  )
}
