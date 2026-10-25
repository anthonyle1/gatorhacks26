import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { usePrune } from '../../state/prune-context'
import CompostPile from './CompostPile'
import PruningStation from './PruningStation'

export default function GardenTools() {
  const { branches, prunedCount } = usePrune()

  return (
    <aside className="card card--lg garden-tools-panel" aria-label="Prune and restore your garden">
      <PruningStation />
      <CompostPile />
      <section className="garden-tools-summary" aria-labelledby="garden-tools-summary-heading">
        <div className="garden-tools-summary__heading">
          <h3 id="garden-tools-summary-heading">Your garden now</h3>
          <Link to="/calendar">View journal <ArrowUpRight size={13} aria-hidden="true" /></Link>
        </div>
        <dl>
          <div><dt>Growing topics</dt><dd>{Math.max(0, branches.length - prunedCount)}</dd></div>
          <div><dt>Pruned topics</dt><dd>{prunedCount}</dd></div>
        </dl>
      </section>
    </aside>
  )
}
