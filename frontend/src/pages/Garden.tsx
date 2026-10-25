import { Link } from 'react-router-dom'
import CompostPile from '../components/garden/CompostPile'
import Inspector from '../components/garden/Inspector'
import PruningStation from '../components/garden/PruningStation'
import TreeCard from '../components/garden/TreeCard'
import { usePrune } from '../state/prune-context'

export default function Garden() {
  const { prunedCount, branches, videoCount } = usePrune()
  const total = branches.length

  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__text">
          <h1 className="h1">Your feed garden</h1>
          <p className="lede">
            Topics discovered across your completed scrolling sessions. Prune a branch to remove it and its children from your garden.
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="stat__label">Growing topics</span>
            <span className="stat__value">{total - prunedCount}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Branches pruned</span>
            <span className="stat__value">
              {prunedCount} of {total} topics
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Videos in your topic tree</span>
            <span className="stat__value">{videoCount}</span>
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
          <h2 id="change-heading" className="h3">Your garden now</h2>
          <p className="compost__intro">A cut removes every topic below it. Restore a branch from the compost pile.</p>
          <div className="change__grid">
            <div className="change__cell">
              <span className="change__label">Growing topics</span>
              <span className="change__value">{total - prunedCount}</span>
            </div>
            <div className="change__cell change__cell--after">
              <span className="change__label">Removed topics</span>
              <span className="change__value">{prunedCount}</span>
            </div>
          </div>
          <Link to="/calendar" className="link-strong">Open your calendar</Link>
        </section>
      </div>
    </div>
  )
}
