import { usePrune } from '../../state/prune-context'
import { LEVEL_LABEL } from '../Chip'
import Tree from '../Tree'

const LEGEND = [
  { color: '#94aa98', label: 'Not rated' },
  { color: 'var(--calm-leaf)', label: 'Healthy' },
  { color: 'var(--some-leaf)', label: 'Some hostility' },
  { color: 'var(--heavy-leaf)', label: 'Heavy hostility' },
]

export default function TreeCard() {
  const { branches, pruned, selectedId, setSelected, loading, error } = usePrune()

  return (
    <section
      className="card card--lg tree-card feed-tree-card"
      aria-labelledby="tree-heading"
    >
      <div className="feed-tree-card__heading">
        <div>
          <span className="botanical-eyebrow">YOUR LITTLE ECOSYSTEM</span>
          <h2 id="tree-heading">The story of your feed</h2>
          <p>
            Every branch represents a topic. Select one to
            explore its details.
          </p>
        </div>

        <span className="feed-tree-card__flourish" aria-hidden="true">
          ❧
        </span>
      </div>

      {loading && <p role="status">Loading your topic tree…</p>}
      {error && <p role="alert">{error} Check that the backend is running.</p>}
      {!loading && !error && !branches.length && <p role="status">Your garden is ready to grow. Finish and review a scrolling session to discover your first topics.</p>}
      {branches.length > 0 && <div className="tree-wrap"><Tree /></div>}

      <div className="branch-grid">
        {branches.map((b) => {
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
                {b.videoCount ?? 0} videos · {b.size} · {label}
              </span>
            </button>
          )
        })}
      </div>

      <p className="note">
        Branch size reflects its share of videos across completed sessions. Gray-green leaves mean hostility is not rated.
        Select a topic to inspect it. Pruning drops that branch and all its children.
      </p>
    </section>
  )
}
