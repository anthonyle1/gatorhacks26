import { BRANCHES, twigsFor } from '../../data/sample'
import { usePrune } from '../../state/prune-context'
import Chip from '../Chip'

export default function Inspector() {
  const { pruned, snipped, selectedId, setSnipped } = usePrune()
  const branch = BRANCHES.find((b) => b.id === selectedId) ?? BRANCHES[0]
  const branchPruned = !!pruned[branch.id]

  return (
    <section className="card card--lg inspector" aria-labelledby="inspect-heading">
      <span className="eyebrow">Inspecting</span>
      <div className="inspector__head">
        <h3 id="inspect-heading" className="h2">{branch.name}</h3>
        <Chip level={branchPruned ? 'cut' : branch.level} size="md" />
      </div>
      <p className="inspector__why">
        {branchPruned ? 'You pruned this branch. Shorts from it are hidden from your feed.' : branch.why}
      </p>

      <span className="inspector__sub">Twigs on this branch (channels)</span>
      {twigsFor(branch).map((twig) => {
        const isSnipped = !!snipped[twig.id]
        const gone = isSnipped || branchPruned
        return (
          <div key={twig.id} className="twig">
            <div className="twig__info">
              <span className="twig__name">{twig.name}</span>
              <Chip level={gone ? 'cut' : twig.level} label={gone ? 'Snipped' : undefined} />
            </div>
            {!gone && twig.level !== 'calm' && (
              <button type="button" className="btn btn--outline" onClick={() => setSnipped(twig.id, true)}>
                Snip
              </button>
            )}
            {isSnipped && !branchPruned && (
              <button type="button" className="btn btn--dashed" onClick={() => setSnipped(twig.id, false)}>
                Snipped · Undo
              </button>
            )}
          </div>
        )
      })}

      <span className="fine">
        Snipping hides one channel but keeps the rest of the branch. Good for a category you like with one bad corner.
      </span>
    </section>
  )
}
