import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { bushPath, growTree, seeded, type Limb } from './layout'
import { flatten, type Topic, type TreeData } from './types'
import './tree.css'

interface Props {
  data: TreeData
  falling: Set<string>
  busy: boolean
  zoom: number
  loading: boolean
  onPrune: (id: string, value: boolean) => void
  onSize: (width: number, height: number) => void
}

function tapered(limb: Limb): string {
  const left: string[] = [], right: string[] = []
  for (let step = 0; step <= 20; step++) {
    const t = step / 20, u = 1 - t
    const { start: a, control1: b, control2: c, end: d } = limb
    const x = u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x
    const y = u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y
    const dx = 3 * u * u * (b.x - a.x) + 6 * u * t * (c.x - b.x) + 3 * t * t * (d.x - c.x)
    const dy = 3 * u * u * (b.y - a.y) + 6 * u * t * (c.y - b.y) + 3 * t * t * (d.y - c.y)
    const radius = limb.thickness * (1 - t * .25) / 2
    const length = Math.hypot(dx, dy) || 1
    left.push(`${x - dy / length * radius},${y + dx / length * radius}`)
    right.unshift(`${x + dy / length * radius},${y - dx / length * radius}`)
  }
  return `M${left.join(' L')} L${right.join(' L')} Z`
}

export function TopicTree({ data, falling, busy, zoom, loading, onPrune, onSize }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<string | null>(null)
  const all = useMemo(() => flatten(data.tree), [data.tree])
  const byId = useMemo(() => new Map(all.map(topic => [topic.id, topic])), [all])
  const signature = [...falling].join(',')
  const layout = useMemo(() => {
    const active = (nodes: Topic[], carried = false): Topic[] => nodes
      .filter(node => (!node.reduce || falling.has(node.id) || carried) && !(carried && node.selected && !falling.has(node.id)))
      .map(node => ({ ...node, children: active(node.children, carried || falling.has(node.id)) }))
    const context = document.createElement('canvas').getContext('2d')!
    return growTree(active(data.tree), (text, fontSize) => {
      context.font = `600 ${fontSize}px Inter, sans-serif`
      return context.measureText(text).width
    })
  // The set is an immutable snapshot; signature records its contents.
  }, [data.tree, signature]) // eslint-disable-line react-hooks/exhaustive-deps
  const { bounds } = layout
  const width = Math.max(340, bounds.width), height = Math.max(440, bounds.height)
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.button !== 1) return
    const viewport = document.getElementById('tree')!
    drag.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false }
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return
    const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y
    if (Math.hypot(dx, dy) < 4 && !drag.current.moved) return
    drag.current.moved = true
    event.currentTarget.setPointerCapture(event.pointerId)
    const viewport = document.getElementById('tree')!
    viewport.scrollLeft = drag.current.left - dx
    viewport.scrollTop = drag.current.top - dy
  }
  const changeCollapse = (id: string) => setCollapsed(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const viewLimbs = new Map(layout.limbs.map(limb => [limb.topic.id, limb]))
  const focusBranch = (id: string) => {
    const limb = viewLimbs.get(id)
    if (!limb) return
    const viewport = document.getElementById('tree')!
    viewport.scrollTo({ left: (limb.end.x - bounds.x) * zoom - viewport.clientWidth / 2,
      top: (limb.end.y - bounds.y) * zoom - viewport.clientHeight / 2, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  function branch(limb: Limb, carried = false) {
    const { topic, end, start } = limb
    const dropping = falling.has(topic.id) && !carried
    const outline = bushPath(limb.width, limb.height)
    return <g key={topic.id} data-topic-id={topic.id} data-parent-id={limb.parentId || 'trunk'}
      className={`topic-limb${dropping ? ' topic-limb--falling' : ''}`}
      style={{ transformOrigin: `${start.x}px ${start.y}px`, '--fall-turn': end.x < start.x ? '-26deg' : '26deg', '--grow-delay': `${limb.depth * .09}s` } as CSSProperties}>
      <path className="living-wood" d={tapered(limb)} style={{ d: `path("${tapered(limb)}")` } as CSSProperties} fill={limb.depth > 1 ? '#967454' : '#79583e'} />
      <path className="living-branch-growth" d={limb.path} style={{ d: `path("${limb.path}")` } as CSSProperties} pathLength={1} fill="none" stroke="#79583e" strokeWidth={limb.thickness * .6} strokeLinecap="round" />
      <g className={`living-children${collapsed.has(topic.id) ? ' living-children--collapsed' : ''}`}
        aria-hidden={collapsed.has(topic.id)} style={{ transformOrigin: `${end.x}px ${end.y}px` }}>
        {limb.children.map(child => branch(child, carried || dropping))}
      </g>
      <g className="topic-leaf living-foliage" transform={`translate(${end.x} ${end.y})`} data-depth={limb.depth}
        style={{ transform: `translate(${end.x}px, ${end.y}px)` }}
>
        <path className="topic-leaf__shape" d={outline} fill="#b7d39b" stroke="#779b65" strokeWidth={1} />
        <g transform={`translate(${-limb.width * .35} ${-limb.height * .24})`} pointerEvents="none">
          <ellipse className="living-sway" rx={limb.fontSize * .5} ry={limb.fontSize * .2} fill="#86a764" style={{ animationDelay: `${-seeded(topic.id, 'sway') * 9}s` }} />
        </g>
        <title>{topic.name}: {topic.video_count} videos.</title>
        <text x="0" y={-(limb.lines.length + 1) * limb.fontSize * 1.3 / 2 + limb.fontSize}
          textAnchor="middle" className="topic-tree__label" fontSize={limb.fontSize}>
          {limb.lines.map((line, index) => <tspan key={index} x="0" dy={index ? limb.fontSize * 1.3 : 0}>{line}</tspan>)}
          <tspan x="0" dy={limb.fontSize * 1.3} className="topic-tree__count" fontSize={limb.fontSize * .9}>{topic.video_count} {topic.video_count === 1 ? 'video' : 'videos'}{collapsed.has(topic.id) ? ' · +' : ''}</tspan>
        </text>
      </g>
    </g>
  }
  const selectedTopic = selected ? byId.get(selected) : null
  const previewTopic = preview ? byId.get(preview) : null
  const videoMap = new Map((data.tree_videos || []).map(video => [video.video_id, video]))
  const inspector = document.getElementById('topic-inspector')!
  const list = document.getElementById('branches')!
  return <>
    {layout.limbs.length ? <svg className="living-tree" ref={element => { if (element) onSize(width, height) }}
      viewBox={`${bounds.x} ${bounds.y} ${width} ${height}`} style={{ width: width * zoom, height: height * zoom }}
      role="group" aria-label="Living topic tree. Branches grow recursively from their parent topics. Drag to pan."
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <path className="living-trunk" d={layout.trunk} fill="#79583e" />
      {layout.roots.map(root => branch(root))}
    </svg> : <p className="note">{loading ? 'Growing your saved topic tree…' : all.length ? 'Your branches are pruned. Restore a topic below to grow it back.' : 'No topics yet. Finish and review a session to grow your tree.'}</p>}
    {createPortal(<>
      {previewTopic && <section className="living-preview" role="alertdialog" aria-modal="false" aria-labelledby="prune-preview-title">
        <h3 id="prune-preview-title">Prune {previewTopic.name}?</h3>
        <p>This cuts {flatten([previewTopic]).length - 1} descendant topics and includes {previewTopic.video_ids ? new Set(previewTopic.video_ids).size : previewTopic.video_count} unique videos. You can undo it.</p>
        <button className="btn btn--dark" autoFocus disabled={busy} onClick={() => { onPrune(previewTopic.id, true); setPreview(null) }}>Confirm prune</button>
        <button className="btn btn--outline" onClick={() => setPreview(null)}>Cancel</button>
      </section>}
      {selectedTopic && <section className="living-inspector" aria-label="Topic details">
        <h3>{selectedTopic.name}</h3><p>{selectedTopic.description}</p>
        <p>{selectedTopic.video_count} videos · {selectedTopic.children.length} child topics · Hostility not rated</p>
        <div className="living-actions">
          <button className="btn btn--outline" onClick={() => focusBranch(selectedTopic.id)}>Focus branch</button>
          {selectedTopic.children.length > 0 && <button className="btn btn--outline" onClick={() => changeCollapse(selectedTopic.id)}>{collapsed.has(selectedTopic.id) ? 'Expand' : 'Collapse'} children</button>}
          <button className="btn btn--dark" disabled={busy || selectedTopic.inherited} onClick={() => selectedTopic.selected ? onPrune(selectedTopic.id, false) : setPreview(selectedTopic.id)}>{selectedTopic.selected ? 'Restore branch' : 'Prune branch'}</button>
        </div>
        {selectedTopic.children.length > 0 && <ul>{selectedTopic.children.map(child => <li key={child.id}><button className="living-topic-link" onClick={() => setSelected(child.id)}>{child.name}</button></li>)}</ul>}
        <ul className="living-videos">{(selectedTopic.video_ids || []).slice(0, 20).map(id => {
          const video = videoMap.get(id)
          const source = id.startsWith('youtube:') ? `https://www.youtube.com/watch?v=${encodeURIComponent(id.slice(8))}` : id.startsWith('instagram:') ? `https://www.instagram.com/reel/${encodeURIComponent(id.slice(10))}/` : null
          return <li key={id}>{source ? <a href={source} target="_blank" rel="noopener noreferrer">{video?.title || id}</a> : video?.title || id}</li>
        })}</ul>
        {(selectedTopic.video_ids?.length || 0) > 20 && <p className="note">Showing the first 20 videos. Open the full summary for all results.</p>}
      </section>}
    </>, inspector)}
    {createPortal(all.map(topic => <div className="branch" key={topic.id} data-topic-id={topic.id}>
      <div className="branch__info"><button className="living-topic-link" onClick={() => setSelected(topic.id)}>{topic.name}</button><span className="note-sm">{topic.video_count} videos{topic.reduce ? ' · Pruned' : ''}</span></div>
      <button className={topic.reduce ? 'btn btn--outline' : 'btn btn--dark'} disabled={busy || topic.inherited}
        aria-label={`${topic.selected ? 'Restore' : 'Prune'} ${topic.name}`}
        onClick={() => topic.selected ? onPrune(topic.id, false) : setPreview(topic.id)}>{topic.inherited ? 'Parent pruned' : topic.selected ? 'Undo prune' : 'Prune'}</button>
    </div>), list)}
  </>
}
