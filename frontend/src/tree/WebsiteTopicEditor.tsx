import { useMemo, useState } from 'react'
import { usePrune } from '../state/prune-context'
import type { Topic } from '../data/topics'

type VideoRecord = {
  video_id: string
  source_id?: string
  title?: string
  caption?: string
  platform?: string
  analysis?: {
    status?: string
    sentiment?: {
      total_comments?: number
      counts?: {
        positive?: number
        neutral?: number
        negative?: number
      }
    } | null
    assessment?: {
      reason?: string
      context_summary?: string
      negative_for_user?: string
    }
    comments?: {
      text: string
      sentiment?: string
    }[]
  }
}

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

function isDemo(id: string) {
  return id.startsWith('demo:')
}

function videoUrl(video: VideoRecord): string | null {
  if (!video.source_id) return null

  if (video.platform === 'youtube') {
    if (video.source_id.startsWith('demo_')) return null
    return `https://www.youtube.com/watch?v=${encodeURIComponent(video.source_id)}`
  }

  if (video.platform === 'instagram') {
    return `https://www.instagram.com/reel/${encodeURIComponent(video.source_id)}/`
  }

  return null
}

function assessmentLabel(value?: string) {
  switch (value) {
    case 'yes':
      return 'Potential warning'
    case 'no':
      return 'No concern identified'
    case 'uncertain':
      return 'Uncertain assessment'
    default:
      return 'Not assessed'
  }
}

function VideoDetails({
  video,
  videoId,
  onClose,
  busy,
  canEdit,
  categoryId,
  categories,
  onMove,
}: {
  video?: VideoRecord
  videoId: string
  onClose: () => void
  busy: boolean
  canEdit: boolean
  categoryId: string
  categories: Topic[]
  onMove: (videoId: string, categoryId: string) => void
}) {
  const assessment = video?.analysis?.assessment
  const sentiment = video?.analysis?.sentiment
  const comments = video?.analysis?.comments ?? []
  const url = video ? videoUrl(video) : null

  return (
    <section
      className="prune-video-details"
      aria-label={`Video details: ${video?.title ?? videoId}`}
    >
      <div className="prune-video-details__header">
        <div>
          <span className="botanical-eyebrow">
            VIDEO DETAILS
          </span>
          <h4>{video?.title || videoId}</h4>
        </div>

        <button
          type="button"
          className="prune-video-details__close"
          onClick={onClose}
          aria-label="Close video details"
        >
          ×
        </button>
      </div>

      {!video && (
        <p>Additional information is unavailable for this video.</p>
      )}

      {video && (
        <>
          <div className="prune-video-details__meta">
            <span className="prune-video-details__pill">
              {video.platform === 'youtube'
                ? 'YouTube'
                : video.platform === 'instagram'
                  ? 'Instagram'
                  : video.platform || 'Video'}
            </span>

            <span
              className={
                `prune-video-details__pill prune-video-details__pill--${
                  assessment?.negative_for_user === 'yes'
                    ? 'warning'
                    : 'status'
                }`
              }
            >
              {assessmentLabel(assessment?.negative_for_user)}
            </span>
          </div>

          {url && (
            <a
              className="prune-video-details__link"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open original video ↗
            </a>
          )}

          {video.caption && (
            <div className="prune-video-details__section">
              <h5>Caption</h5>
              <p>{video.caption}</p>
            </div>
          )}

          {assessment && (
            <div className="prune-video-details__section">
              <h5>AI assessment</h5>

              {assessment.context_summary && (
                <p>{assessment.context_summary}</p>
              )}

              {assessment.reason && (
                <p>{assessment.reason}</p>
              )}

              {!assessment.context_summary &&
                !assessment.reason && (
                  <p>No explanation is available.</p>
                )}
            </div>
          )}

          {sentiment && (
            <div className="prune-video-details__section">
              <h5>Comment sentiment</h5>

              <div className="prune-video-details__sentiment">
                <span>
                  Positive
                  <strong>{sentiment.counts?.positive ?? 0}</strong>
                </span>
                <span>
                  Neutral
                  <strong>{sentiment.counts?.neutral ?? 0}</strong>
                </span>
                <span>
                  Negative
                  <strong>{sentiment.counts?.negative ?? 0}</strong>
                </span>
              </div>
            </div>
          )}

          {comments.length > 0 && (
            <div className="prune-video-details__section">
              <h5>Comments</h5>

              <div className="prune-video-details__comments">
                {comments.map((comment, index) => (
                  <div
                    key={index}
                    className="prune-video-details__comment"
                  >
                    <p>{comment.text}</p>
                    {comment.sentiment && (
                      <span>{comment.sentiment}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {canEdit && (
            <div className="prune-video-details__section">
              <label className="prune-video-details__field">
                Move video to another category

                <select
                  disabled={busy}
                  value={categoryId}
                  onChange={event => {
                    if (event.target.value) {
                      onMove(videoId, event.target.value)
                    }
                  }}
                >
                  <option value="" disabled>
                    Choose category
                  </option>

                  {categories.map(category => (
                    <option
                      key={category.id}
                      value={category.id}
                    >
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default function WebsiteTopicEditor({
  inspectedId,
}: {
  inspectedId?: string | null
}) {
  const {
    taxonomy,
    cuts,
    pruned,
    setPruned,
    setSelected,
    selectedId,
    moveVideo,
    busy,
  } = usePrune()

  const [expanded, setExpanded] = useState<
    Record<string, boolean>
  >({})

  const [selectedVideo, setSelectedVideo] =
    useState<string | null>(null)

  const [actionError, setActionError] =
    useState<string | null>(null)

  const allRoots = useMemo(
    () => taxonomy?.tree ?? [],
    [taxonomy]
  )

  const topics = useMemo(
    () => flatten(allRoots),
    [allRoots]
  )

  const inspectedTopic = inspectedId
    ? findTopic(allRoots, inspectedId)
    : undefined

  const roots = inspectedId
    ? inspectedTopic
      ? [inspectedTopic]
      : []
    : allRoots

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

  const assignments = useMemo(() => {
    const result = new Map<string, string[]>()

    for (const topic of topics) {
      for (const id of topic.video_ids ?? []) {
        const existing = result.get(id) ?? []

        if (!existing.includes(topic.id)) {
          existing.push(topic.id)
        }

        result.set(id, existing)
      }
    }

    return result
  }, [topics])

  async function reassign(
    videoId: string,
    categoryId: string
  ) {
    if (
      isDemo(videoId) ||
      isDemo(categoryId)
    ) {
      return
    }

    try {
      setActionError(null)
      await moveVideo(videoId, categoryId)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Could not move video.'
      )
    }
  }

  function branch(
    node: Topic,
    depth = 0
  ) {
    const open =
      expanded[node.id] ??
      (depth === 0 || node.id === inspectedId)

    const demo = isDemo(node.id)

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
                  const assigned = assignments.get(id) ?? []

                  return (
                    <li
                      key={id}
                      className={
                        `website-topic-video${
                          selected
                            ? ' website-topic-video--selected'
                            : ''
                        }`
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
                        </button>
                      </div>

                      {selected && (
                        <VideoDetails
                          video={video}
                          videoId={id}
                          busy={busy}
                          canEdit={!demo}
                          categoryId={
                            assigned.length === 1
                              ? assigned[0]
                              : ''
                          }
                          categories={topics.filter(
                            topic => !isDemo(topic.id)
                          )}
                          onMove={(videoId, categoryId) =>
                            void reassign(
                              videoId,
                              categoryId
                            )
                          }
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
      {actionError && (
        <p role="alert" className="error">
          {actionError}
        </p>
      )}

      <div className="website-topic-editor__organizer">
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
