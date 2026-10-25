
import { usePrune } from '../../state/prune-context'
import Chip from '../Chip'
import { ScissorsIcon } from '../icons'

export default function PruningStation() {
  const { tree, pruned, setPruned, setSelected, pruneAll } = usePrune()

  return (
    <section className="station" aria-labelledby="station-heading">
      {/* FIXED HEADER */}
      <div className="station__title">
        <ScissorsIcon size={24} color="#FFFFFF" />
        <h2 id="station-heading" className="h2">
          Pruning station
        </h2>
      </div>

      {/* ONLY THE TOPIC LIST SCROLLS */}
      <div className="station__scroll">
        {tree.map((b) => {
          const isPruned = !!pruned[b.id]

          return (
            <div key={b.id} className="station__row">
              <div className="station__info">
                <span className="station__name">{b.name}</span>
                <Chip level={isPruned ? 'cut' : b.level} />
              </div>

              <div className="station__actions">
                <button
                  type="button"
                  className="btn btn--ghost-dark"
                  onClick={() => {
                    setSelected(b.id)
                    window.dispatchEvent(
                      new CustomEvent('prune:inspect-topic', {
                        detail: b.id,
                      })
                    )
                  }}
                >
                  Inspect
                </button>

                {isPruned ? (
                  <button
                    type="button"
                    className="btn btn--dashed-dark"
                    onClick={() => setPruned(b.id, false)}
                  >
                    Pruned · Undo
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--light"
                    onClick={() => setPruned(b.id, true)}
                  >
                    Prune branch
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* FIXED FOOTER */}
      <div className="station__footer">
        <span>
          {tree.length} main topics. Every cut includes the child branches.
        </span>

        <button
          type="button"
          className="btn btn--gold"
          disabled={!tree.some((branch) => !pruned[branch.id])}
          onClick={pruneAll}
        >
          Prune all
        </button>
      </div>
    </section>
  )
}
