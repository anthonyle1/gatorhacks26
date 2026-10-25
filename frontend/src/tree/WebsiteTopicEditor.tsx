import {useMemo, useRef, useState, type DragEvent, type FormEvent,} from 'react'
import {usePrune, type CategoryChange, } from '../state/prune-context'
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

type Dragged = {
  kind: 'category' | 'video'
  id: string
} | null

function flatten(nodes: Topic[]): Topic[] {
  return nodes.flatMap(node => [
    node,
    ...flatten(node.children ?? []),
  ])
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
  canEdit,
  busy,
  assignedCategory,
  destinations,
  onMove,
}: {
  video?: VideoRecord
  videoId: string
  onClose: () => void
  canEdit: boolean
  busy: boolean
  assignedCategory: string
  destinations: Topic[]
  onMove: (videoId: string, categoryId: string) => void
}) {
  const url = video ? videoUrl(video) : null
  const assessment = video?.analysis?.assessment
  const sentiment = video?.analysis?.sentiment
  const comments = video?.analysis?.comments ?? []

  return (
    <section
      className="prune-video-details"
      aria-label={`Details for ${video?.title ?? videoId}`}
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
        <p>Additional details are not available for this video.</p>
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
              {assessmentLabel(
                assessment?.negative_for_user
              )}
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
                  Positive <strong>
                    {sentiment.counts?.positive ?? 0}
                  </strong>
                </span>

                <span>
                  Neutral <strong>
                    {sentiment.counts?.neutral ?? 0}
                  </strong>
                </span>

                <span>
                  Negative <strong>
                    {sentiment.counts?.negative ?? 0}
                  </strong>
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
                      <span>
                        {comment.sentiment}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {canEdit && (
            <div className="prune-video-details__section">
              <label className="prune-video-details__field">
                Move video to category

                <select
                  disabled={busy}
                  value={assignedCategory}
                  onChange={event => {
                    if (event.target.value) {
                      onMove(videoId, event.target.value)
                    }
                  }}
                >
                  <option value="" disabled>
                    Choose category
                  </option>

                  {destinations.map(topic => (
                    <option
                      key={topic.id}
                      value={topic.id}
                    >
                      {topic.name}
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
  inspectedId: string
}) {
  const {
    taxonomy,
    cuts,
    pruned,
    selectedId,
    setSelected,
    setPruned,
    editCategory,
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

  const [dragged, setDragged] = useState<Dragged>(null)
  const dragging = useRef<Dragged>(null)

  const [over, setOver] = useState<string | null>(null)

  const allRoots = taxonomy?.tree ?? []

  function findTopic(nodes: Topic[], id: string): Topic | undefined {
    for (const node of nodes) {
      if (node.id === id) return node
      const child = findTopic(node.children ?? [], id)
      if (child) return child
    }
    return undefined
  }

  const inspectedTopic = findTopic(allRoots, inspectedId)
  const roots = inspectedTopic ? [inspectedTopic] : []

  const topics = useMemo(
    () => flatten(taxonomy?.tree ?? []),
    [taxonomy]
  )

  const parentIds = useMemo(() => {
    const result = new Map<string, string | null>()

    function visit(
      nodes: Topic[],
      parent: string | null
    ) {
      for (const node of nodes) {
        result.set(node.id, parent)
        visit(node.children ?? [], node.id)
      }
    }

    visit(taxonomy?.tree ?? [], null)
    return result
  }, [taxonomy])

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
        const ids = result.get(id) ?? []

        if (!ids.includes(topic.id)) {
          ids.push(topic.id)
        }

        result.set(id, ids)
      }
    }

    return result
  }, [topics])

  async function edit(
    id: string,
    change: CategoryChange
  ) {
    if (isDemo(id)) return

    try {
      setActionError(null)
      await editCategory(id, change)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Could not update category.'
      )
    }
  }

  async function reassign(
    id: string,
    category: string
  ) {
    if (isDemo(id) || isDemo(category)) return

    try {
      setActionError(null)
      await moveVideo(id, category)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Could not move video.'
      )
    }
  }

  function begin(
    event: DragEvent,
    kind: 'category' | 'video',
    id: string
  ) {
    if (busy || isDemo(id)) {
      event.preventDefault()
      return
    }

    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)

    dragging.current = { kind, id }
    setDragged(dragging.current)
  }

  function clear() {
    dragging.current = null
    setDragged(null)
    setOver(null)
  }

  function canDrop(
    parent: string | null,
    target?: string
  ) {
    const active = dragging.current

    if (
      !active ||
      busy ||
      (parent !== null && isDemo(parent))
    ) {
      return false
    }

    if (active.kind === 'video') {
      return parent !== null && !target
    }

    const source = topics.find(
      topic => topic.id === active.id
    )

    const forbidden = new Set(
      source
        ? flatten([source]).map(topic => topic.id)
        : []
    )

    return (
      !forbidden.has(parent ?? '') &&
      target !== active.id &&
      (!target || !isDemo(target))
    )
  }

  function accept(
    event: DragEvent,
    id: string,
    parent: string | null,
    target?: string
  ) {
    if (!canDrop(parent, target)) return

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setOver(id)
  }

  function drop(
    event: DragEvent,
    parent: string | null,
    order?: {
      before_id?: string
      after_id?: string
    }
  ) {
    event.preventDefault()
    event.stopPropagation()

    const active = dragging.current

    if (
      active &&
      canDrop(
        parent,
        order?.before_id ?? order?.after_id
      )
    ) {
      if (active.kind === 'video' && parent) {
        void reassign(active.id, parent)
      }

      if (active.kind === 'category') {
        void edit(active.id, {
          move: true,
          parent_id: parent,
          ...order,
        })
      }
    }

    clear()
  }

  function gap(
    node: Topic,
    position: 'before' | 'after'
  ) {
    const id = `${position}:${node.id}`
    const parent = parentIds.get(node.id) ?? null

    return (
      <div
        className={
          `website-topic-drop-gap${
            over === id ? ' is-over' : ''
          }`
        }
        aria-label={`Drop ${position} ${node.name}`}
        onDragOver={event =>
          accept(event, id, parent, node.id)
        }
        onDragLeave={() => setOver(null)}
        onDrop={event =>
          drop(
            event,
            parent,
            position === 'before'
              ? { before_id: node.id }
              : { after_id: node.id }
          )
        }
      />
    )
  }

  function branch(
    node: Topic,
    siblings: Topic[],
    index: number,
    depth = 0
  ) {
    const open = expanded[node.id] ?? depth === 0
    const demo = isDemo(node.id)
    const parent = parentIds.get(node.id) ?? null

    const descendants = new Set(
      flatten([node]).map(topic => topic.id)
    )

    const destinations = topics.filter(
      topic =>
        !isDemo(topic.id) &&
        !descendants.has(topic.id)
    )

    const directVideos = (
      node.video_ids ?? []
    ).filter(
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
        {!demo && gap(node, 'before')}

        <div
          className={
            `website-topic-editor__category-row${
              selectedId === node.id
                ? ' is-selected'
                : ''
            }${
              over === node.id ? ' is-over' : ''
            }`
          }
          onDragOver={event =>
            accept(event, node.id, node.id)
          }
          onDragLeave={() => setOver(null)}
          onDrop={event => drop(event, node.id)}
        >
          {!demo && (
            <span
              className="website-topic-drag"
              draggable={!busy}
              title="Drag category"
              onDragStart={event =>
                begin(event, 'category', node.id)
              }
              onDragEnd={clear}
            >
              ⠿
            </span>
          )}

          <button
            type="button"
            className="website-topic-editor__expand"
            aria-label={
              open
                ? `Collapse ${node.name}`
                : `Expand ${node.name}`
            }
            aria-expanded={open}
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

          {!demo && (
            <span className="website-topic-order">
              <button
                type="button"
                title="Move up"
                aria-label={`Move ${node.name} up`}
                disabled={
                  busy ||
                  index === 0 ||
                  isDemo(siblings[index - 1].id)
                }
                onClick={() =>
                  void edit(node.id, {
                    move: true,
                    parent_id: parent,
                    before_id:
                      siblings[index - 1].id,
                  })
                }
              >
                ↑
              </button>

              <button
                type="button"
                title="Move down"
                aria-label={`Move ${node.name} down`}
                disabled={
                  busy ||
                  index === siblings.length - 1 ||
                  isDemo(siblings[index + 1].id)
                }
                onClick={() =>
                  void edit(node.id, {
                    move: true,
                    parent_id: parent,
                    after_id:
                      siblings[index + 1].id,
                  })
                }
              >
                ↓
              </button>

              {parent && (
                <button
                  type="button"
                  title="Move to top level"
                  disabled={busy}
                  onClick={() =>
                    void edit(node.id, {
                      move: true,
                      parent_id: null,
                    })
                  }
                >
                  ↰
                </button>
              )}
            </span>
          )}

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
              (
                !!pruned[node.id] &&
                !cuts[node.id]
              )
            }
            onClick={() =>
              setPruned(
                node.id,
                !cuts[node.id]
              )
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
                {(node.children ?? []).map(
                  (child, childIndex) =>
                    branch(
                      child,
                      node.children ?? [],
                      childIndex,
                      depth + 1
                    )
                )}
              </ul>
            )}

            {directVideos.length > 0 && (
              <ul className="website-topic-editor__videos">
                {directVideos.map(id => {
                  const video = videos.get(id)
                  const isSelected =
                    selectedVideo === id
                  const assigned =
                    assignments.get(id) ?? []
                  const canEditVideo = !demo

                  return (
                    <li
                      key={id}
                      className={
                        `website-topic-video${
                          isSelected
                            ? ' website-topic-video--selected'
                            : ''
                        }`
                      }
                    >
                      <div className="website-topic-video__row">
                        {!demo && !isDemo(id) && (
                          <span
                            draggable={!busy}
                            className="website-topic-drag"
                            title="Drag video to another category"
                            onDragStart={event =>
                              begin(
                                event,
                                'video',
                                id
                              )
                            }
                            onDragEnd={clear}
                          >
                            ⠿
                          </span>
                        )}

                        <button
                          type="button"
                          className="website-topic-editor__video"
                          aria-expanded={isSelected}
                          onClick={() =>
                            setSelectedVideo(
                              isSelected
                                ? null
                                : id
                            )
                          }
                        >
                          <span
                            className="website-topic-video__chevron"
                            aria-hidden="true"
                          >
                            {isSelected ? '▾' : '▸'}
                          </span>

                          <span>
                            {video?.title || id}
                          </span>
                        </button>
                      </div>

                      {isSelected && (
                        <VideoDetails
                          video={video}
                          videoId={id}
                          onClose={() =>
                            setSelectedVideo(null)
                          }
                          canEdit={canEditVideo}
                          busy={busy}
                          assignedCategory={
                            assigned.length === 1
                              ? assigned[0]
                              : ''
                          }
                          destinations={topics.filter(
                            topic =>
                              !isDemo(topic.id)
                          )}
                          onMove={(videoId, categoryId) =>
                            void reassign(
                              videoId,
                              categoryId
                            )
                          }
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {!demo && (
              <CategoryManager
                key={`${node.id}:${node.name}:${parent ?? ''}`}
                node={node}
                parent={parent}
                destinations={destinations}
                busy={busy}
                edit={edit}
              />
            )}
          </div>
        )}

        {!demo && gap(node, 'after')}
      </li>
    )
  }

  return (
    <aside
      className="website-topic-editor"
      aria-label="Topic editor"
    >
      <div className="website-topic-editor__heading">
        <h3>Explore &amp; manage topics</h3>
        <p>
          Organize categories, explore videos,
          and prune topics you want to see less often.
        </p>
      </div>

      {actionError && (
        <p role="alert" className="error">
          {actionError}
        </p>
      )}

      <div
        className={
          `website-topic-editor__organizer${
            dragged ? ' is-dragging' : ''
          }`
        }
      >
        <ul className="website-topic-editor__categories">
          {roots.map((node, index) =>
            branch(node, roots, index)
          )}
        </ul>

        {!roots.length && (
          <p>
            No topics available yet. Finish and review
            a scrolling session to create your topic tree.
          </p>
        )}
      </div>
    </aside>
  )
}

function CategoryManager({
  node,
  parent,
  destinations,
  busy,
  edit,
}: {
  node: Topic
  parent: string | null
  destinations: Topic[]
  busy: boolean
  edit: (
    id: string,
    change: CategoryChange
  ) => Promise<void>
}) {
  const [name, setName] = useState(node.name)
  const [newParent, setNewParent] =
    useState(parent ?? '')
  const [mergeTarget, setMergeTarget] =
    useState('')

  function rename(event: FormEvent) {
    event.preventDefault()

    if (name.trim()) {
      void edit(node.id, {
        name: name.trim(),
      })
    }
  }

  return (
    <details className="website-topic-category-manager">
      <summary>Manage category</summary>

      <form onSubmit={rename}>
        <label>
          Display name
          <input
            value={name}
            maxLength={80}
            required
            onChange={event =>
              setName(event.target.value)
            }
          />
        </label>

        <button
          type="submit"
          disabled={busy || !name.trim()}
        >
          Rename
        </button>
      </form>

      <div className="website-topic-manager-action">
        <label>
          Move branch under
          <select
            value={newParent}
            onChange={event =>
              setNewParent(event.target.value)
            }
          >
            <option value="">
              Top level
            </option>

            {destinations.map(topic => (
              <option
                key={topic.id}
                value={topic.id}
              >
                {topic.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void edit(node.id, {
              move: true,
              parent_id:
                newParent || null,
            })
          }
        >
          Move branch
        </button>
      </div>

      <div className="website-topic-manager-action">
        <label>
          Merge into
          <select
            value={mergeTarget}
            onChange={event =>
              setMergeTarget(
                event.target.value
              )
            }
          >
            <option value="">
              Choose category
            </option>

            {destinations.map(topic => (
              <option
                key={topic.id}
                value={topic.id}
              >
                {topic.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={busy || !mergeTarget}
          onClick={() => {
            if (
              window.confirm(
                `Merge "${node.name}" into the selected category?`
              )
            ) {
              void edit(node.id, {
                merge_into: mergeTarget,
              })
            }
          }}
        >
          Merge category
        </button>
      </div>
    </details>
  )
}
