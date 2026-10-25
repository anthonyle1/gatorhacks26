import { BRANCHES } from '../../data/sample'
import { usePrune } from '../../state/prune-context'
import { LEVEL_LABEL } from '../Chip'
import Tree from '../Tree'

const LEGEND = [
  { color: 'var(--calm-leaf)', label: 'Healthy' },
  { color: 'var(--some-leaf)', label: 'Some hostility' },
  { color: 'var(--heavy-leaf)', label: 'Heavy hostility' },
]

export default function TreeCard() {
  const { pruned, selectedId, setSelected } = usePrune()

  return (
    <section className="card card--lg tree-card" aria-labelledby="tree-heading">
      <div className="tree-card__head">
        <h2 id="tree-heading" className="h2">Full tree</h2>
        <ul className="legend">
          {LEGEND.map((l) => (
            <li key={l.label}>
              <span className="legend__dot" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="tree-wrap">
        <Tree pruned={pruned} />
      </div>

      <div className="branch-grid">
        {BRANCHES.map((b) => {
          const selected = b.id === selectedId
          const label = pruned[b.id] ? LEVEL_LABEL.cut : LEVEL_LABEL[b.level]
          return (
            <button
              key={b.id}
              type="button"
              className={`branch-tile${selected ? ' branch-tile--selected' : ''}`}
              aria-pressed={selected}
              onClick={() => setSelected(b.id)}
            >
              <span className="branch-tile__name">{b.name}</span>
              <span className="branch-tile__meta">
                {b.size} · {label}
              </span>
            </button>
          )
        })}
      </div>

      <p className="note">
        Branch size = share of your scrolling. Leaf color = how hostile that category&apos;s comment sections are.
        Select any branch to inspect it.
      </p>
    </section>
  )
}
