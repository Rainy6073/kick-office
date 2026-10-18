import CycleRatio from '../tools/CycleRatio'
import FieldBoard from '../tools/FieldBoard'
import ReferencesBoard from '../tools/ReferencesBoard'
import ScoreCalculator from '../tools/ScoreCalculator'

const TOOLS = [
  { id: 'references', label: 'Important References', description: 'Clip key parts of the manual onto your own board.' },
  { id: 'field', label: 'Field Board', description: 'Place robots and draw paths on the field.' },
  { id: 'score', label: 'Score Calculator', description: 'Try out scores and see points and ranking points.' },
  { id: 'cycle', label: 'Points per Cycle', description: 'Compare actions by points per second of cycle time.' },
] as const

/** Strategy tools. Each screen uses them on its own; nothing here is shared. */
export default function ToolsPage({ toolId }: { toolId?: string }) {
  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0]
  return (
    <div className="tools-page">
      <nav className="tool-list" aria-label="Tools">
        <h3>Tools</h3>
        {TOOLS.map((t) => (
          <a key={t.id} href={`#/tools/${t.id}`} className="tool-link" aria-current={t === tool ? 'page' : undefined}>
            <strong>{t.label}</strong>
            <span className="muted small">{t.description}</span>
          </a>
        ))}
        <p className="muted small more-tools">Tools are just for this screen; nothing here is shared.</p>
      </nav>
      <section className="tool-main">
        {tool.id === 'references' && <ReferencesBoard />}
        {tool.id === 'field' && <FieldBoard />}
        {tool.id === 'score' && <ScoreCalculator />}
        {tool.id === 'cycle' && <CycleRatio />}
      </section>
    </div>
  )
}
