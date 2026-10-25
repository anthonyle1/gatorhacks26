import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ChevronRight, Scissors, Sprout, Undo2, Video } from 'lucide-react'
import { usePrune } from '../../state/prune-context'
import { gardenTreeData } from '../../tree/gardenTreeData'
import { scaleTopicRisks, topicRisk } from '../../tree/risk'
import { flatten } from '../../tree/types'
import type { Topic } from '../../tree/types'

export default function PruningStation() {
  const { tree, taxonomy, cuts, pruned, busy, videoCount, setPruned, setSelected, pruneAll } = usePrune()
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const data = useMemo(() => gardenTreeData(tree, taxonomy, cuts, videoCount), [tree, taxonomy, cuts, videoCount])
  const risks = useMemo(() => {
    const topics = flatten(data.tree)
    const videos = new Map((data.tree_videos ?? []).map(video => [video.video_id, video]))
    const colors = scaleTopicRisks(topics.map(topic => topicRisk(topic, videos)))
    return new Map(topics.map((topic, index) => [topic.id, colors[index]]))
  }, [data])

  function inspect(id: string) {
    setSelected(id)
    window.dispatchEvent(new CustomEvent('prune:inspect-topic', { detail: id }))
  }

  function topicRow(topic: Topic, depth = 0, ancestorContinues: boolean[] = [], isLast = true) {
    const isCollapsed = collapsed.has(topic.id)
    const childId = `station-children-${encodeURIComponent(topic.id)}`
    return (
      <li key={topic.id} className="station-topic-item">
        <div className={`station-topic-row${topic.reduce ? ' station-topic-row--pruned' : ''}`}
          style={{ '--topic-score-color': risks.get(topic.id)?.fill, '--topic-indent': `${depth * 18}px` } as CSSProperties}>
          {ancestorContinues.map((continues, index) => continues &&
            <span key={index} aria-hidden="true" className="station-vine station-vine--through" style={{ left: 15 + index * 18 }} />)}
          {depth > 0 && <span aria-hidden="true" className={`station-vine station-vine--join${isLast ? ' station-vine--last' : ''}`}
            style={{ left: 15 + (depth - 1) * 18 }}><i /></span>}
          {topic.children.length > 0 && !isCollapsed && <span aria-hidden="true" className="station-vine station-vine--descend" style={{ left: 15 + depth * 18 }} />}
          <div className="station-topic-name">
            {topic.children.length > 0 ? (
              <button type="button" className="station-topic-toggle" aria-expanded={!isCollapsed} aria-controls={childId}
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${topic.name} subtree`}
                onClick={() => setCollapsed(previous => {
                  const next = new Set(previous)
                  if (next.has(topic.id)) next.delete(topic.id)
                  else next.add(topic.id)
                  return next
                })}>
                {isCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <Sprout size={14} aria-hidden="true" />}
              </button>
            ) : <span className="station-topic-toggle-spacer" aria-hidden="true" />}
            <button type="button" className="station-topic-link" title={risks.get(topic.id)?.detail} onClick={() => inspect(topic.id)}>{topic.name}</button>
          </div>
          <span className="station-topic-count" role="img" aria-label={`${topic.video_count} ${topic.video_count === 1 ? 'video' : 'videos'}`}>
            <Video size={14} aria-hidden="true" /><span aria-hidden="true">{topic.video_count}</span>
          </span>
          <button type="button" className="station-topic-prune" disabled={busy || topic.inherited}
            aria-label={topic.inherited ? `${topic.name} included in parent prune` : `${topic.selected ? 'Restore' : 'Prune'} ${topic.name}`}
            title={topic.inherited ? 'Restore the parent branch first' : `${topic.selected ? 'Restore' : 'Prune'} ${topic.name}${topic.selected ? '' : ' and its children'}`}
            onClick={() => setPruned(topic.id, !topic.selected)}>
            {topic.inherited ? 'Pruned' : topic.selected ? <><Undo2 size={13} aria-hidden="true" />Undo</> : <>
              <span className="station-topic-prune-label">Prune</span><Scissors className="station-topic-scissors" size={17} aria-hidden="true" />
            </>}
          </button>
        </div>
        {topic.children.length > 0 && <ul className="station-topic-children" id={childId} hidden={isCollapsed} aria-label={`Children of ${topic.name}`}>
          {topic.children.map((child, index) => topicRow(child, depth + 1, depth > 0 ? [...ancestorContinues, !isLast] : [], index === topic.children.length - 1))}
        </ul>}
      </li>
    )
  }

  return (
    <section className="station" aria-labelledby="station-heading">
      <div className="station__title">
        <Scissors size={24} aria-hidden="true" />
        <h2 id="station-heading" className="h2">Pruning station</h2>
      </div>
      <div className="station__scroll" role="region" aria-label="Topics available for pruning" tabIndex={0}>
        <ul className="station-topics">{data.tree.map((topic, index) => topicRow(topic, 0, [], index === data.tree.length - 1))}</ul>
        {!data.tree.length && <p className="station-topic-empty">Your topics will appear here as your garden grows.</p>}
      </div>
      <div className="station__footer">
        <span>{tree.length} main topics. Every cut includes the child branches.</span>
        <button type="button" className="btn btn--gold" disabled={busy || !tree.some(branch => !pruned[branch.id])} onClick={pruneAll}>Prune all</button>
      </div>
    </section>
  )
}
