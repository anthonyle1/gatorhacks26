import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, CornerUpLeft, GripVertical, Video as VideoIcon } from 'lucide-react'
import { CategorySelect, VideoLink } from './VideoResult'
import type { Change, Topic, Video } from './types'
import { flatten } from './hierarchy'

function CategoryEditor({ node, options, busy, edit }: { node: Topic; options: Topic[]; busy: boolean; edit: (id: string, change: Change) => Promise<void> }) {
  const [name, setName] = useState(node.name), [parent, setParent] = useState(node.parent_id || ''), [target, setTarget] = useState('')
  const descendants = new Set(flatten([node]).map(topic => topic.id))
  const destinations = options.filter(option => !descendants.has(option.id))
  function rename(event: FormEvent) { event.preventDefault(); void edit(node.id, { name: name.trim() }) }
  return <details className="category-editor"><summary>Manage category</summary>
    <form onSubmit={rename}><label>Display name<input value={name} maxLength={80} required onChange={event => setName(event.target.value)} /></label><button disabled={busy || !name.trim()}>Rename</button></form>
    <label>Move branch under<select value={parent} onChange={event => setParent(event.target.value)}><option value="">Top level</option>{destinations.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>
    <button disabled={busy} onClick={() => void edit(node.id, { parent_id: parent || null, move: true })}>Move branch</button>
    <label>Merge this category into<select value={target} onChange={event => setTarget(event.target.value)}><option value="">Choose a matching category</option>{destinations.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>
    <button disabled={busy || !target} onClick={() => void edit(node.id, { merge_into: target })}>Merge and preserve preferences</button>
  </details>
}

interface Props {
  roots: Topic[]; videos: Map<string, Video>; assignments: Record<string, string[]>; busy: boolean
  edit: (id: string, change: Change) => Promise<void>
  moveVideo: (id: string, category: string) => Promise<void>
}
type Dragged = { kind: 'category' | 'video'; id: string } | null

export function TopicEditor({ roots, videos, assignments, busy, edit, moveVideo }: Props) {
  const [dragged, setDragged] = useState<Dragged>(null)
  const dragging = useRef<Dragged>(null)
  const [over, setOver] = useState<string | null>(null)
  const options = flatten(roots)
  function begin(event: DragEvent, kind: 'category' | 'video', id: string) {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(`application/x-prune-${kind}`, id)
    event.dataTransfer.setData('text/plain', id)
    dragging.current = { kind, id }
    setDragged(dragging.current)
  }
  function clear() { dragging.current = null; setDragged(null); setOver(null) }
  function canDrop(parent: string | null, target?: string) {
    const active = dragging.current
    if (!active || busy) return false
    const source = options.find(topic => topic.id === active.id)
    const forbidden = new Set(source ? flatten([source]).map(topic => topic.id) : [])
    return active.kind === 'video' ? !!parent && !target : !forbidden.has(parent || '') && target !== active.id
  }
  function accept(event: DragEvent, id: string, parent: string | null, target?: string) {
    if (!canDrop(parent, target)) return
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setOver(id)
  }
  function drop(event: DragEvent, parent: string | null, order?: { before_id?: string; after_id?: string }) {
    event.preventDefault(); event.stopPropagation()
    const active = dragging.current
    if (!canDrop(parent, order?.before_id || order?.after_id) || !active) { clear(); return }
    if (active.kind === 'video' && parent) void moveVideo(active.id, parent)
    else if (active.kind === 'category') void edit(active.id, { move: true, parent_id: parent, ...order })
    clear()
  }
  function gap(node: Topic, position: 'before' | 'after') {
    const id = `${position}:${node.id}`
    return <div className={`topic-drop-gap${over === id ? ' is-over' : ''}`} aria-label={`Drop ${position} ${node.name}`}
      onDragOver={event => accept(event, id, node.parent_id, node.id)}
      onDragLeave={() => setOver(null)} onDrop={event => drop(event, node.parent_id, position === 'before' ? { before_id: node.id } : { after_id: node.id })} />
  }
  function branch(node: Topic, siblings: Topic[], index: number) {
    const directIds = Object.keys(assignments).length ? Object.entries(assignments).filter(([, ids]) => ids.includes(node.id)).map(([id]) => id)
      : node.video_ids.filter(id => !node.children.some(child => child.video_ids.includes(id)))
    return <li key={node.id} className={`topic${node.reduce ? ' reduced' : ''}`} data-category-id={node.id}>
      {gap(node, 'before')}
      <details open className="topic-details">
        <summary className={over === node.id ? 'is-over' : ''} onDragOver={event => accept(event, node.id, node.id)}
          onDragLeave={() => setOver(null)} onDrop={event => drop(event, node.id)}>
          <button className="category-drag-handle icon-control" type="button" draggable={!busy} disabled={busy} aria-label={`Drag category ${node.name}`}
            onClick={event => event.preventDefault()} onDragStart={event => begin(event, 'category', node.id)} onDragEnd={clear}><GripVertical size={15} aria-hidden="true" /></button>
          {node.children.length > 0 && <ChevronRight className="topic-chevron" size={15} aria-hidden="true" />}
          <strong className="topic-name">{node.name}</strong><span className="topic-count"><VideoIcon size={13} aria-hidden="true" />{node.video_count}</span>
          {node.inherited && <small>Parent pruned</small>}
          <span className="topic-order-actions">
            <button type="button" className="icon-control" aria-label={`Move ${node.name} up`} title="Move up" disabled={busy || index === 0}
              onClick={event => { event.preventDefault(); void edit(node.id, { move: true, parent_id: node.parent_id, before_id: siblings[index - 1].id }) }}><ArrowUp size={13} /></button>
            <button type="button" className="icon-control" aria-label={`Move ${node.name} down`} title="Move down" disabled={busy || index === siblings.length - 1}
              onClick={event => { event.preventDefault(); void edit(node.id, { move: true, parent_id: node.parent_id, after_id: siblings[index + 1].id }) }}><ArrowDown size={13} /></button>
            {node.parent_id && <button type="button" className="icon-control" aria-label={`Make ${node.name} top level`} title="Make top level" disabled={busy}
              onClick={event => { event.preventDefault(); void edit(node.id, { move: true, parent_id: null }) }}><CornerUpLeft size={13} /></button>}
          </span>
        </summary>
        <div className="topic-body"><p className="analysis-note">{node.description}</p>
          {node.children.length > 0 && <ul className="topic-children">{node.children.map((child, childIndex) => branch(child, node.children, childIndex))}</ul>}
          {directIds.length > 0 && <ul className="branch-videos">{directIds.map(id => <li key={id} className="branch-video" data-video-id={id}>
            <span className="video-drag-handle" draggable={!busy} onDragStart={event => begin(event, 'video', id)} onDragEnd={clear} title="Drag this video onto another category"><GripVertical size={14} aria-hidden="true" /></span>
            <VideoLink video={videos.get(id)} id={id} />
            <CategorySelect videoId={id} categories={options} assignments={assignments[id] || [node.id]} disabled={busy} move={(video, category) => { void moveVideo(video, category) }} />
          </li>)}</ul>}
          <CategoryEditor key={`${node.id}:${node.parent_id}:${node.name}`} node={node} options={options} busy={busy} edit={edit} />
        </div>
      </details>
      {gap(node, 'after')}
    </li>
  }
  return <div className={dragged ? 'topic-editor organizing' : 'topic-editor'}>
    <p className="editor-help">Drag a branch onto another to make it a child. Drop between branches to reorder or move it to that level. Drag a video onto a category, or choose its category from the menu.</p>
    <div className={`root-drop-zone${over === 'root' ? ' is-over' : ''}`} onDragOver={event => accept(event, 'root', null)} onDragLeave={() => setOver(null)} onDrop={event => drop(event, null)}>
      <CornerUpLeft size={14} aria-hidden="true" />Drop a branch here to make it top level
    </div>
    <ul className="topic-tree">{roots.map((node, index) => branch(node, roots, index))}</ul>
    <p className="analysis-note">Moves are saved across sessions. Category menus and arrow buttons provide the same controls without dragging.</p>
  </div>
}
