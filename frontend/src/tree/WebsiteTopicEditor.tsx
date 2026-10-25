import { useId, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { usePrune } from '../state/prune-context'
import type { Topic, TopicVideo as VideoRecord } from '../data/topics'
import VideoSummary from './VideoSummary'
import { gardenTreeData } from './gardenTreeData'
import { topicRisk } from './risk'
import { flatten as flattenTree } from './types'
import { sortTopics } from './sortTopics'
import type { TopicSort } from './sortTopics'
import { hasNegativeConcerns } from './videoConcerns'

function flatten(nodes: Topic[]): Topic[] {
  return nodes.flatMap(node => [
    node,
    ...flatten(node.children ?? []),
  ])
}

function findTopic(
  nodes: Topic[],
  id: string
): Topic | undefined {
  for (const node of nodes) {
    if (node.id === id) return node

    const found = findTopic(node.children ?? [], id)
    if (found) return found
  }

  return undefined
}

export default function WebsiteTopicEditor({
  inspectedId,
}: {
  inspectedId?: string | null
}) {
  const {
    taxonomy,
    tree,
    videoCount,
    cuts,
    pruned,
    setPruned,
    setSelected,
    selectedId,
    busy,
  } = usePrune()

  const sortId = useId()
  const [sortOrder, setSortOrder] = useState<TopicSort>('tree')
  const [highlightConcerns, setHighlightConcerns] = useState(false)

  const [expanded, setExpanded] = useState<
    Record<string, boolean>
  >({})

  const [selectedVideo, setSelectedVideo] =
    useState<string | null>(null)

  const allRoots = useMemo(
    () => taxonomy?.tree ?? [],
    [taxonomy]
  )

  const sortedRoots = useMemo(() => {
    const data = gardenTreeData(tree, taxonomy, cuts, videoCount)
    const evidence = new Map((data.tree_videos ?? []).map(video => [video.video_id, video]))
    const scores = new Map(flattenTree(data.tree).map(topic => [topic.id, topicRisk(topic, evidence).score]))
    return sortTopics(allRoots, scores, sortOrder)
  }, [allRoots, tree, taxonomy, cuts, videoCount, sortOrder])

  const topics = useMemo(
    () => flatten(allRoots),
    [allRoots]
  )

  const inspectedTopic = inspectedId
    ? findTopic(sortedRoots, inspectedId)
    : undefined

  const roots = inspectedId
    ? inspectedTopic
      ? [inspectedTopic]
      : []
    : sortedRoots

  const videos = useMemo(() => {
    const result = new Map<string, VideoRecord>()

    const data = taxonomy as (
      typeof taxonomy & {
        tree_videos?: VideoRecord[]
        videos?: VideoRecord[]
      }
    ) | null

    for (const video of [
      ...(data?.tree_videos ?? []),
      ...(data?.videos ?? []),
    ]) {
      result.set(video.video_id, video)
    }

    return result
  }, [taxonomy])

  const concernVideos = useMemo(() => new Set(
    [...videos].filter(([, video]) => hasNegativeConcerns(video.analysis?.assessment)).map(([id]) => id)
  ), [videos])
  const visibleConcernCount = new Set(flatten(roots).flatMap(topic =>
    (topic.video_ids ?? []).filter(id => concernVideos.has(id))
  )).size

  function toggleConcerns() {
    const enabled = !highlightConcerns
    setHighlightConcerns(enabled)
    if (!enabled) return
    // Reveal concerned videos even if their topic or an ancestor was collapsed.
    const reveal: Record<string, boolean> = {}
    function visit(node: Topic): boolean {
      const childMatches = (node.children ?? []).map(visit).some(Boolean)
      const matches = childMatches || (node.video_ids ?? []).some(id => concernVideos.has(id))
      if (matches) reveal[node.id] = true
      return matches
    }
    roots.forEach(visit)
    setExpanded(previous => ({ ...previous, ...reveal }))
  }

  function branch(
    node: Topic,
    depth = 0
  ) {
    const open =
      expanded[node.id] ??
      (depth === 0 || node.id === inspectedId)

    const directVideos = (node.video_ids ?? []).filter(
      id =>
        !(node.children ?? []).some(
          child =>
            (child.video_ids ?? []).includes(id)
        )
    )

    return (
      <li
        key={node.id}
        className={
          `website-topic-editor__category${
            pruned[node.id] ? ' is-pruned' : ''
          }`
        }
      >
        <div
          className={
            `website-topic-editor__category-row${
              selectedId === node.id
                ? ' is-selected'
                : ''
            }`
          }
        >
          <button
            type="button"
            className="website-topic-editor__expand"
            aria-expanded={open}
            aria-label={
              open
                ? `Collapse ${node.name}`
                : `Expand ${node.name}`
            }
            onClick={() =>
              setExpanded(current => ({
                ...current,
                [node.id]: !open,
              }))
            }
          >
            {open ? '▾' : '▸'}
          </button>

          <button
            type="button"
            className="website-topic-editor__name"
            onClick={() => {
              setSelected(node.id)
              setExpanded(current => ({
                ...current,
                [node.id]: true,
              }))
            }}
          >
            {node.name}
          </button>

          <span className="website-topic-editor__count">
            {node.video_count ?? 0} videos
          </span>

          <button
            type="button"
            className={
              `prune-topic-action${
                cuts[node.id]
                  ? ' prune-topic-action--restore'
                  : ''
              }`
            }
            disabled={
              busy ||
              (!!pruned[node.id] && !cuts[node.id])
            }
            onClick={() =>
              setPruned(node.id, !cuts[node.id])
            }
          >
            {cuts[node.id]
              ? 'Restore'
              : pruned[node.id]
                ? 'Parent pruned'
                : 'Prune'}
          </button>
        </div>

        {open && (
          <div className="website-topic-editor__content">
            {node.description && (
              <p className="website-topic-description">
                {node.description}
              </p>
            )}

            {(node.children ?? []).length > 0 && (
              <ul className="website-topic-editor__children">
                {(node.children ?? []).map(child =>
                  branch(child, depth + 1)
                )}
              </ul>
            )}

            {directVideos.length > 0 && (
              <ul className="website-topic-editor__videos">
                {directVideos.map(id => {
                  const video = videos.get(id)
                  const selected = selectedVideo === id

                  return (
                    <li
                      key={id}
                      className={
                        `website-topic-video${
                          selected
                            ? ' website-topic-video--selected'
                            : ''
                        }${highlightConcerns && concernVideos.has(id) ? ' website-topic-video--concern' : ''}`
                      }
                    >
                      <div className="website-topic-video__row">
                        <button
                          type="button"
                          className="website-topic-editor__video"
                          aria-expanded={selected}
                          onClick={() =>
                            setSelectedVideo(
                              selected ? null : id
                            )
                          }
                        >
                          <span
                            className="website-topic-video__chevron"
                            aria-hidden="true"
                          >
                            {selected ? '▾' : '▸'}
                          </span>

                          <span>
                            {video?.title || id}
                          </span>
                          {highlightConcerns && concernVideos.has(id) && (
                            <span className="website-topic-video__concern"><AlertTriangle size={14} aria-hidden="true" />Negative concern</span>
                          )}
                        </button>
                      </div>

                      {selected && (
                        <VideoSummary
                          video={video}
                          videoId={id}
                          onClose={() =>
                            setSelectedVideo(null)
                          }
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <aside
      className="website-topic-editor"
      aria-label="Topic editor"
    >
      <div className="website-topic-editor__organizer">
        <div className="website-topic-editor__sort">
          <label htmlFor={sortId}>Sort by</label>
          <select id={sortId} value={sortOrder} aria-describedby={`${sortId}-hint`}
            onChange={event => setSortOrder(event.target.value as TopicSort)}>
            <option value="tree">Tree order</option>
            <option value="critical-desc">Criticalness: highest first</option>
            <option value="critical-asc">Criticalness: lowest first</option>
          </select>
          <button type="button" className="website-topic-editor__highlight" aria-pressed={highlightConcerns}
            onClick={toggleConcerns}>
            <AlertTriangle size={15} aria-hidden="true" />Highlight concerns
          </button>
          <button type="button" className="website-topic-editor__collapse-all" disabled={!roots.length}
            onClick={() => {
              setExpanded(Object.fromEntries(topics.map(topic => [topic.id, false])))
              setSelectedVideo(null)
            }}>
            Collapse all
          </button>
          <p id={`${sortId}-hint`}>Criticalness uses warnings and negative comment signals. Unrated topics appear last.</p>
          {highlightConcerns && <p role="status">{visibleConcernCount ? `${visibleConcernCount} ${visibleConcernCount === 1 ? 'video with negative concerns' : 'videos with negative concerns'} highlighted.` : 'No videos flagged with negative concerns in these topics.'}</p>}
        </div>
        <ul className="website-topic-editor__categories">
          {roots.map(root => branch(root))}
        </ul>

        {roots.length === 0 && (
          <p>
            {inspectedId
              ? 'This topic is no longer available.'
              : 'No topics available yet. Finish and review a scrolling session to grow your garden.'}
          </p>
        )}
      </div>
    </aside>
  )
}
