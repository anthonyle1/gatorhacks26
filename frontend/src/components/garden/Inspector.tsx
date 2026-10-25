// import { usePrune } from '../../state/prune-context'
// import Chip from '../Chip'

// export default function Inspector() {
//   const { branches, pruned, selectedId, setSelected, setPruned } = usePrune()
//   const branch = branches.find(item => item.id === selectedId) ?? branches[0]
//   if (!branch) return <section className="card card--lg inspector"><h3 className="h2">Inspect a topic</h3><p>Topics appear after you finish and review a scrolling session.</p></section>
//   const inherited = !!branch.parentId && !!pruned[branch.parentId]
//   return (
//     <section className="card card--lg inspector" aria-labelledby="inspect-heading">
//       <span className="eyebrow">Inspecting topic</span>
//       <div className="inspector__head">
//         <h3 id="inspect-heading" className="h2">{branch.name}</h3>
//         <Chip level={pruned[branch.id] ? 'cut' : branch.level} size="md" />
//       </div>
//       <p className="inspector__why">{branch.why || 'A topic discovered from your completed sessions.'}</p>
//       <p className="fine">{branch.videoCount ?? 0} videos · {branch.children?.length ?? 0} child topics</p>
//       <button type="button" className="btn btn--outline" disabled={inherited}
//         onClick={() => setPruned(branch.id, !pruned[branch.id])}>
//         {inherited ? 'Restore the parent branch first' : pruned[branch.id] ? 'Restore branch' : 'Prune branch and children'}
//       </button>
//       <span className="inspector__sub">Child topics</span>
//       {(branch.children ?? []).map(child => (
//         <div key={child.id} className="twig">
//           <button type="button" className="btn btn--outline-soft" onClick={() => setSelected(child.id)}>{child.name}</button>
//           <Chip level={pruned[child.id] ? 'cut' : child.level} />
//         </div>
//       ))}
//       <span className="fine">Pruning removes this branch and its descendants from your garden. Restore it from compost. Saved preferences do not yet change platform recommendations.</span>
//     </section>
//   )
// }


import WebsiteTopicEditor from '../../tree/WebsiteTopicEditor'

export default function Inspector() {
  return (
    <section
      className="card card--lg inspector inspector--topic-editor"
      aria-label="Explore and manage topics"
    >
      <WebsiteTopicEditor />
    </section>
  )
}
