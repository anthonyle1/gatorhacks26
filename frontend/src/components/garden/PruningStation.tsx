import { PRUNABLE_BRANCHES } from '../../data/sample'
import { usePrune } from '../../state/prune-context'
import Chip from '../Chip'
import { ScissorsIcon } from '../icons'

export default function PruningStation() {
  const { pruned, setPruned, setSelected, pruneAll } = usePrune()

  return (
    <section className="station" aria-labelledby="station-heading">
      <div className="station__title">
        <ScissorsIcon size={24} color="#FFFFFF" />
        <h2 id="station-heading" className="h2">Pruning station</h2>
      </div>
      <p className="station__intro">
        Suggested cuts, worst first. Prune a whole branch, or open it and snip single channels.
      </p>

      {PRUNABLE_BRANCHES.map((b) => {
        const isPruned = !!pruned[b.id]
        return (
          <div key={b.id} className="station__row">
            <div className="station__info">
              <span className="station__name">{b.name}</span>
              <Chip level={isPruned ? 'cut' : b.level} />
            </div>
            <div className="station__actions">
              <button type="button" className="btn btn--ghost-dark" onClick={() => setSelected(b.id)}>
                Inspect
              </button>
              {isPruned ? (
                <button type="button" className="btn btn--dashed-dark" onClick={() => setPruned(b.id, false)}>
                  Pruned · Undo
                </button>
              ) : (
                <button type="button" className="btn btn--light" onClick={() => setPruned(b.id, true)}>
                  Prune branch
                </button>
              )}
            </div>
          </div>
        )
      })}

      <div className="station__footer">
        <span>Prune all {PRUNABLE_BRANCHES.length} and your tree goes from Wilting to Thriving.</span>
        <button type="button" className="btn btn--gold" onClick={pruneAll}>
          Prune all
        </button>
      </div>
    </section>
  )
}
