import { useEffect, useState } from 'react'
import ArchetypesPage from './pages/ArchetypesPage'
import EffortValuePage from './pages/EffortValuePage'
import ManualPage from './pages/ManualPage'
import NwhPage from './pages/NwhPage'
import PrototypesPage from './pages/PrototypesPage'
import ToolsPage from './pages/ToolsPage'
import Welcome from './pages/Welcome'
import UpdatePrompt from './components/UpdatePrompt'
import { SessionContext, useLocalState, useStoredSession } from './session'
import { patch, syncMode, useCollection, useSyncStatus } from './sync/store'
import { PROTOTYPE_GROUP } from './types'
import './App.css'

const PAGES = [
  { path: 'manual', label: 'Game Manual', short: 'Manual' },
  { path: 'effort-value', label: 'Effort / Value', short: 'E/V' },
  { path: 'prototypes', label: 'Prototypes', short: 'Prototypes' },
  { path: 'archetypes', label: 'Archetypes', short: 'Archetypes' },
  { path: 'nwh', label: 'NWH', short: 'NWH', title: 'Needs, Wants & Nice to Haves' },
  { path: 'tools', label: 'Tools', short: 'Tools' },
] as const

/** The current route from the URL hash, e.g. "#/prototypes/abc" → ["prototypes", "abc"]. */
function useRoute() {
  const parse = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const onHash = () => setRoute(parse())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

export default function App() {
  const [session, setSession] = useStoredSession()
  const route = useRoute()
  const [status, error] = useSyncStatus()
  const [barHidden, setBarHidden] = useLocalState('kickoff.topbarHidden', false)
  const page = PAGES.find((p) => p.path === route[0]) ?? PAGES[0]

  useEffect(() => {
    document.title = `${page.label} · Kick-Office`
  }, [page])

  useEffect(() => {
    document.documentElement.dataset.role = session?.role ?? ''
  }, [session?.role])

  // Prototypes made before the Question Board's Prototype group existed are moved
  // into it once, so they stay on the Prototypes tab. Later moves are left alone.
  const submissions = useCollection('submissions')
  useEffect(() => {
    for (const s of submissions) {
      if (s.prototype && !s.prototype.grouped) patch('submissions', s.id, { groupId: PROTOTYPE_GROUP, prototype: { ...s.prototype, grouped: true } })
    }
  }, [submissions])

  if (!session)
    return (
      <>
        <Welcome onStart={setSession} />
        <UpdatePrompt />
      </>
    )

  const statusLabel = {
    live: 'Live',
    connecting: 'Connecting…',
    offline: 'Reconnecting…',
    local: 'This device only',
  }[status]

  return (
    <SessionContext.Provider value={session}>
      <div className="shell">
        {barHidden ? (
          <button className="topbar-strip" onClick={() => setBarHidden(false)} title="Show the top bar" aria-label="Show the top bar">
            <span>
              Kick-Office · {page.label} ▾
            </span>
          </button>
        ) : (
          <header className="topbar">
            <button className="logo" onClick={() => setSession(null)} title="Back to the start screen">
              <span className="logo-mark" aria-hidden>
                k.o.
              </span>
              <span className="logo-text">Kick-Office</span>
            </button>
            <nav className="tabs" aria-label="Pages">
              {PAGES.map((p, i) => (
                <a
                  key={p.path}
                  href={`#/${p.path}`}
                  className="tab"
                  aria-current={p === page ? 'page' : undefined}
                  title={'title' in p ? p.title : undefined}
                >
                  <span className="tab-num">{i + 1}</span>
                  <span className="tab-label">{p.label}</span>
                  <span className="tab-short">{p.short}</span>
                </a>
              ))}
            </nav>
            <div className="who">
              <span
                className={`sync-dot ${status}`}
                title={
                  syncMode === 'local'
                    ? 'Supabase is not configured, so changes only sync between tabs on this device.'
                    : statusLabel
                }
              >
                <span className="sync-label">{statusLabel}</span>
              </span>
              <button className="who-chip" onClick={() => setSession(null)} title="Change name or view">
                <span className="who-name">{session.name}</span>
                <span className={`role-badge ${session.role}`}>{session.role === 'presenter' ? 'Presenter' : 'Standard'}</span>
              </button>
              <button className="icon ghost bar-hide" onClick={() => setBarHidden(true)} title="Hide the top bar for more space" aria-label="Hide the top bar">
                ▴
              </button>
            </div>
          </header>
        )}
        {error && <div className="sync-error">{error}</div>}
        <main className="content">
          {page.path === 'manual' && <ManualPage />}
          {page.path === 'effort-value' && <EffortValuePage />}
          {page.path === 'archetypes' && <ArchetypesPage />}
          {page.path === 'nwh' && <NwhPage />}
          {page.path === 'prototypes' && <PrototypesPage openId={route[1]} />}
          {page.path === 'tools' && <ToolsPage toolId={route[1]} />}
        </main>
      </div>
      <UpdatePrompt />
    </SessionContext.Provider>
  )
}
