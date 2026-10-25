import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Scissors, Undo2 } from 'lucide-react'
import { bushPath, growTree, type Limb } from './layout'
import { flatten, type Topic, type TreeData } from './types'
import './tree.css'
import { scaleTopicRisks, topicRisk } from './risk'

interface Props {
  data: TreeData
  falling: Set<string>
  busy: boolean
  zoom: number
  loading: boolean
  onPrune: (id: string, value: boolean) => void
  onSize: (width: number, height: number) => void
  selectedId: string
  onInspectTopic: (id: string) => void
  onFocusTopic: (x: number, y: number, width: number, height: number) => void
  onPan: (left: number, top: number) => void
}

function PruneAction({ topic, busy, onPrune }: { topic: Topic; busy: boolean; onPrune: Props['onPrune'] }) {
  return <button className={`topic-prune${topic.selected ? ' topic-prune--undo' : ''}`}
    disabled={busy || topic.inherited}
    aria-label={topic.inherited ? `${topic.name} included in parent prune` : `${topic.selected ? 'Restore' : 'Prune'} ${topic.name}`}
    title={topic.inherited ? 'Restore the parent branch first' : topic.selected ? `Restore ${topic.name}` : `Prune ${topic.name} and its children`}
    onClick={() => onPrune(topic.id, !topic.selected)}>
    {topic.inherited ? 'Pruned' : topic.selected ? <><Undo2 size={13} aria-hidden="true" />Undo</> : <>
      <span className="topic-prune__label">Prune</span>
      <Scissors className="topic-prune__scissors" size={17} aria-hidden="true" />
    </>}
  </button>
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

export function TopicTree({ data, falling, busy, zoom, loading, onPrune, onSize, onFocusTopic, onPan, selectedId, onInspectTopic }: Props) {
  const foliageId = useId()
  const [hovered, setHovered] = useState<string | null>(null)
  const [hoverPosition, setHoverPosition] = useState<{ left: number; top: number } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didDrag = useRef(false)
  const showHover = (id: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hovered !== id) setHoverPosition(null)
    setHovered(id)
  }
  const hideHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setHovered(null), 160)
  }
  useEffect(() => {
    const dismiss = () => setHovered(null)
    const outside = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest('.topic-leaf, .living-hover-action')) dismiss()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('blur', dismiss)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('blur', dismiss)
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
  }, [])
  useLayoutEffect(() => {
    if (!hovered) return
    const position = () => {
      const leaf = document.querySelector(`#tree [data-topic-id="${CSS.escape(hovered)}"] > .topic-leaf`)
      const viewport = document.getElementById('tree')!.getBoundingClientRect()
      if (!leaf || falling.has(hovered)) { setHovered(null); return }
      const box = leaf.getBoundingClientRect()
      if (box.bottom < viewport.top || box.top > viewport.bottom || box.right < viewport.left || box.left > viewport.right) {
        setHovered(null); return
      }
      setHoverPosition({ left: Math.max(6, box.right + 78 < window.innerWidth ? box.right + 5 : box.left - 73),
        top: Math.max(viewport.top + 4, Math.min(viewport.bottom - 34, box.top + box.height / 2 - 15)) })
    }
    const frame = requestAnimationFrame(position)
    // Re-anchor the prune action after the hover enlargement finishes.
    const settled = setTimeout(position, 200)
    window.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
    return () => { cancelAnimationFrame(frame); clearTimeout(settled); window.removeEventListener('scroll', position, true); window.removeEventListener('resize', position) }
  }, [hovered, zoom, data.tree, falling])
  const all = useMemo(() => flatten(data.tree), [data.tree])
  const byId = useMemo(() => new Map(all.map(topic => [topic.id, topic])), [all])
  const risks = useMemo(() => {
    const videos = new Map((data.tree_videos || []).map(video => [video.video_id, video]))
    const scaled = scaleTopicRisks(all.map(topic => topicRisk(topic, videos)))
    return new Map(all.map((topic, index) => [topic.id, scaled[index]]))
  }, [all, data.tree_videos])
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
    didDrag.current = false
    drag.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false }
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return
    const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y
    if (Math.hypot(dx, dy) < 4 && !drag.current.moved) return
    drag.current.moved = true
    didDrag.current = true
    setHovered(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    onPan(drag.current.left - dx, drag.current.top - dy)
  }
  const viewLimbs = new Map(layout.limbs.map(limb => [limb.topic.id, limb]))
  const focusBranch = (id: string) => {
    const limb = viewLimbs.get(id)
    if (!limb) return
    onFocusTopic(limb.end.x - bounds.x, limb.end.y - bounds.y, limb.width, limb.height)
  }
  const inspectTopic = (id: string) => { focusBranch(id); onInspectTopic(id) }
  function branch(limb: Limb, carried = false) {
    const { topic, end, start } = limb
    const dropping = falling.has(topic.id) && !carried
    const outline = bushPath(limb.width, limb.height)
    return <g key={topic.id} data-topic-id={topic.id} data-parent-id={limb.parentId || 'trunk'}
      className={`topic-limb${dropping ? ' topic-limb--falling' : ''}`}
      style={{ transformOrigin: `${start.x}px ${start.y}px`, '--fall-turn': end.x < start.x ? '-26deg' : '26deg', '--grow-delay': `${limb.depth * .09}s` } as CSSProperties}>
      <path className="living-wood" d={tapered(limb)} style={{ d: `path("${tapered(limb)}")` } as CSSProperties} fill={limb.depth > 1 ? '#967454' : '#79583e'} />
      <path className="living-branch-growth" d={limb.path} style={{ d: `path("${limb.path}")` } as CSSProperties} pathLength={1} fill="none" stroke="#79583e" strokeWidth={limb.thickness * .6} strokeLinecap="round" />
      <g className="living-children">
        {limb.children.map(child => branch(child, carried || dropping))}
      </g>
      <g className="topic-leaf living-foliage" transform={`translate(${end.x} ${end.y})`} data-depth={limb.depth}
        style={{ transform: `translate(${end.x}px, ${end.y}px)` }}
        role="button" tabIndex={carried || dropping ? -1 : 0} aria-pressed={selectedId === topic.id} aria-label={`Focus ${topic.name}. ${risks.get(topic.id)!.detail}`}
        onMouseEnter={() => { if (!carried && !dropping) showHover(topic.id) }} onMouseLeave={hideHover}
        onFocus={() => { if (!carried && !dropping) showHover(topic.id) }} onBlur={hideHover}
        onClick={() => { if (!didDrag.current && !carried && !dropping) inspectTopic(topic.id) }}
        onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !carried && !dropping) { event.preventDefault(); inspectTopic(topic.id) } }}>
        <g id={`${foliageId}-${encodeURIComponent(topic.id)}`} className={`topic-leaf__content${hovered === topic.id && !carried && !dropping ? ' topic-leaf__content--hovered' : ''}`}>
        <path className="topic-leaf__shape" d={outline} fill={risks.get(topic.id)!.fill} stroke={risks.get(topic.id)!.stroke} strokeWidth={1} />
        <title>{topic.name}: {topic.video_count} videos. {risks.get(topic.id)!.detail}</title>
        <text x="0" y={-(limb.lines.length + 1) * limb.fontSize * 1.3 / 2 + limb.fontSize}
          textAnchor="middle" className="topic-tree__label" fontSize={limb.fontSize}>
          {limb.lines.map((line, index) => <tspan key={index} x="0" dy={index ? limb.fontSize * 1.3 : 0}>{line}</tspan>)}
          <tspan x="0" dy={limb.fontSize * 1.3} className="topic-tree__count" fontSize={limb.fontSize * .9}>{topic.video_count} {topic.video_count === 1 ? 'video' : 'videos'}</tspan>
        </text>
        </g>
      </g>
    </g>
  }
  const hoveredTopic = hovered ? byId.get(hovered) : null
  const hoveredLimb = hovered ? viewLimbs.get(hovered) : null
  const hoveringFallingBranch = (limb: Limb): boolean => falling.has(limb.topic.id) || !!(limb.parentId && viewLimbs.get(limb.parentId) && hoveringFallingBranch(viewLimbs.get(limb.parentId)!))
  return <>
    {layout.limbs.length ? <svg className="living-tree" ref={element => { if (element) onSize(width, height) }}
      viewBox={`${bounds.x} ${bounds.y} ${width} ${height}`} style={{ width: width * zoom, height: height * zoom }}
      role="group" aria-label="Living topic tree. Branches grow recursively from their parent topics. Drag to pan."
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <path className="living-trunk" d={layout.trunk} fill="#79583e" />
      {layout.roots.map(root => branch(root))}
      {/* SVG paints in document order; repeat only the active foliage above all branches. */}
      {hoveredLimb && !hoveringFallingBranch(hoveredLimb) && <use
        href={`#${foliageId}-${encodeURIComponent(hoveredLimb.topic.id)}`}
        transform={`translate(${hoveredLimb.end.x} ${hoveredLimb.end.y})`}
        pointerEvents="none" aria-hidden="true" />}
    </svg> : <p className="note">{loading ? 'Growing your saved topic tree…' : all.length ? 'Your branches are pruned. Restore a topic below to grow it back.' : 'No topics yet. Finish and review a session to grow your tree.'}</p>}
    {hoveredTopic && hoverPosition && createPortal(<div className="living-hover-action" role="group" aria-label={`Actions for ${hoveredTopic.name}`}
      style={{ left: hoverPosition.left, top: hoverPosition.top }}
      onMouseEnter={() => showHover(hoveredTopic.id)} onMouseLeave={hideHover}
      onFocus={() => showHover(hoveredTopic.id)} onBlur={hideHover}>
      <PruneAction topic={hoveredTopic} busy={busy} onPrune={(id, value) => { setHovered(null); onPrune(id, value) }} />
    </div>, document.body)}
  </>
}
