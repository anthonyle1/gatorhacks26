import { Link } from 'react-router-dom'
import CompostPile from '../components/garden/CompostPile'
import Inspector from '../components/garden/Inspector'
import PruningStation from '../components/garden/PruningStation'
import TreeCard from '../components/garden/TreeCard'
import { PRUNABLE_BRANCHES, SAMPLE_SHORTS_LAST_30_DAYS } from '../data/sample'
import { usePrune } from '../state/prune-context'

function treeHealth(pruned: number, total: number) {
  if (pruned === 0) return { label: 'Wilting', className: 'stat__value--wilting' }
  if (pruned < total) return { label: 'Recovering', className: 'stat__value--recovering' }
  return { label: 'Thriving', className: 'stat__value--thriving' }
}

export default function Garden() {
  const { prunedCount } = usePrune()
  const total = PRUNABLE_BRANCHES.length
  const health = treeHealth(prunedCount, total)

  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__text">
          <h1 className="h1">Your feed garden</h1>
          <p className="lede">
            Every category you watched in the last 30 days. Cut the withered branches to clean up what your feed
            shows you.
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="stat__label">Tree health</span>
            <span className={`stat__value ${health.className}`}>{health.label}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Branches pruned</span>
            <span className="stat__value">
              {prunedCount} of {total} withered
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Shorts, last 30 days</span>
            {/* Sample number: replace with the real count from the API. */}
            <span className="stat__value">{SAMPLE_SHORTS_LAST_30_DAYS}</span>
          </div>
        </div>
      </div>

      <div className="columns">
        <TreeCard />
        <div className="side">
          <PruningStation />
          <Inspector />
        </div>
      </div>

      <div className="row">
        <CompostPile />
        <section className="card card--lg change" aria-labelledby="change-heading">
          <h2 id="change-heading" className="h3">How your garden changed</h2>
          <p className="compost__intro">After each prune, we track whether your feed gets calmer.</p>
          <div className="change__grid">
            <div className="change__cell">
              <span className="change__label">Before pruning</span>
              {/* Placeholder: fill from real before/after hostility levels. */}
              <span className="change__value">[level]</span>
            </div>
            <div className="change__cell change__cell--after">
              <span className="change__label">Since pruning</span>
              <span className="change__value">[level]</span>
            </div>
          </div>
          <Link to="/calendar" className="link-strong">Open your calendar</Link>
        </section>
      </div>
    </div>
  )
}
