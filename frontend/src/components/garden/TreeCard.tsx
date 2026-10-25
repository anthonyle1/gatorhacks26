import { BRANCHES } from '../../data/sample'
import { usePrune } from '../../state/prune-context'
import { LEVEL_LABEL } from '../Chip'
import Tree from '../Tree'

const LEGEND = [
  { color: '#7FA67A', label: 'Calmer content' },
  { color: '#D5B16B', label: 'Mixed sentiment' },
  { color: '#AF8463', label: 'More negative comments' },
]

export default function TreeCard() {
  const { pruned, selectedId, setSelected } = usePrune()

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

      <div className="feed-tree-card__scene">
        <div className="feed-tree-card__sun" aria-hidden="true" />

        <div className="tree-wrap">
          <Tree pruned={pruned} />
        </div>

        <span className="feed-tree-card__scene-note">
          Growing at your own pace
        </span>
      </div>

      <ul className="feed-tree-card__legend" aria-label="Tree color legend">
        {LEGEND.map(item => (
          <li key={item.label}>
            <span
              className="feed-tree-card__legend-leaf"
              style={{ background: item.color }}
              aria-hidden="true"
            />
            {item.label}
          </li>
        ))}
      </ul>

      <div className="feed-tree-card__categories">
        <div className="feed-tree-card__category-heading">
          <h3>Explore your branches</h3>
          <span>{BRANCHES.length} categories</span>
        </div>

        <div className="branch-grid">
          {BRANCHES.map(branch => {
            const selected = branch.id === selectedId
            const label = pruned[branch.id]
              ? LEVEL_LABEL.cut
              : LEVEL_LABEL[branch.level]

            return (
              <button
                key={branch.id}
                type="button"
                className={`branch-tile feed-branch-tile${
                  selected ? ' branch-tile--selected' : ''
                }`}
                aria-pressed={selected}
                onClick={() => setSelected(branch.id)}
              >
                <span
                  className={`feed-branch-tile__dot feed-branch-tile__dot--${branch.level}`}
                  aria-hidden="true"
                />

                <span className="feed-branch-tile__text">
                  <span className="branch-tile__name">
                    {branch.name}
                  </span>

                  <span className="branch-tile__meta">
                    {branch.size} · {label}
                  </span>
                </span>

                <span className="feed-branch-tile__arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <p className="feed-tree-card__footnote">
        This visualization uses example categories until live
        session data is connected. Leaf colors represent the
        available content-analysis categories, not your mood.
      </p>
    </section>
  )
}
