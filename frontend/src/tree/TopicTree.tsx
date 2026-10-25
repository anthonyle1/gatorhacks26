import { useMemo, useRef, type CSSProperties, type PointerEvent } from 'react'
import { usePrune } from '../state/prune-context'
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

type HostilityLevel = 'calm' | 'some' | 'heavy'

// Stable demo-only colors until real hostility ratings are available.
function getHostilityLevel(id: string): HostilityLevel {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  const value = (hash >>> 0) % 10
  if (value < 5) return 'calm'
  if (value < 8) return 'some'
  return 'heavy'
}

const LEAF_COLORS: Record<HostilityLevel, { fill: string; stroke: string; accent: string; label: string }> = {
  calm: { fill: '#4e9a63', stroke: '#367747', accent: '#7dbb8b', label: 'Calm' },
  some: { fill: '#e3b44f', stroke: '#b58a32', accent: '#e9c46a', label: 'Some hostility' },
  heavy: { fill: '#8a5a3b', stroke: '#684129', accent: '#a9784f', label: 'Heavy hostility' },
}

function getLeafColor(id: string): string {
  return LEAF_COLORS[getHostilityLevel(id)].fill
}

function getLeafStroke(id: string): string {
  return LEAF_COLORS[getHostilityLevel(id)].stroke
}

export function TopicTree({ data, falling, zoom, loading, onSize }: Props) {
  const { setSelected } = usePrune()
  const all = useMemo(() => flatten(data.tree), [data.tree])
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
  const suppressClick = useRef(false)
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
  function branch(limb: Limb, carried = false) {
    const { topic, end, start } = limb
    const dropping = falling.has(topic.id) && !carried
    const outline = bushPath(limb.width, limb.height)
    return <g key={topic.id} data-topic-id={topic.id} data-parent-id={limb.parentId || 'trunk'}
      className={`topic-limb${dropping ? ' topic-limb--falling' : ''}`}
      style={{ transformOrigin: `${start.x}px ${start.y}px`, '--fall-turn': end.x < start.x ? '-26deg' : '26deg', '--grow-delay': `${limb.depth * .09}s` } as CSSProperties}>
      <path className="living-wood" d={tapered(limb)} style={{ d: `path("${tapered(limb)}")` } as CSSProperties} fill={limb.depth > 1 ? '#967454' : '#79583e'} />
      <path className="living-branch-growth" d={limb.path} style={{ d: `path("${limb.path}")` } as CSSProperties} pathLength={1} fill="none" stroke="#79583e" strokeWidth={limb.thickness * .6} strokeLinecap="round" />
      <g className="living-children"
        style={{ transformOrigin: `${end.x}px ${end.y}px` }}>
        {limb.children.map(child => branch(child, carried || dropping))}
      </g>
      <g className="topic-leaf living-foliage" onClick={() => { if (!suppressClick.current) { setSelected(topic.id); window.dispatchEvent(new CustomEvent('prune:inspect-topic', { detail: topic.id })) }; suppressClick.current = false }} role="button" aria-label={`Select ${topic.name}`} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(topic.id); window.dispatchEvent(new CustomEvent('prune:inspect-topic', { detail: topic.id })) } }} transform={`translate(${end.x} ${end.y})`} data-depth={limb.depth}
        style={{ transform: `translate(${end.x}px, ${end.y}px)` }}
>
        <path
  className="topic-leaf__shape"
  d={outline}
  fill={getLeafColor(topic.id)}
  stroke={getLeafStroke(topic.id)}
  strokeWidth={1}
/>
        <g transform={`translate(${-limb.width * .35} ${-limb.height * .24})`} pointerEvents="none">
          <ellipse className="living-sway" rx={limb.fontSize * .5} ry={limb.fontSize * .2} fill={LEAF_COLORS[getHostilityLevel(topic.id)].accent} style={{ animationDelay: `${-seeded(topic.id, 'sway') * 9}s` }} />
        </g>
        <title>{topic.name}: {topic.video_count} videos. {LEAF_COLORS[getHostilityLevel(topic.id)].label} (demo).</title>
        <text x="0" y={-(limb.lines.length + 1) * limb.fontSize * 1.3 / 2 + limb.fontSize}
          textAnchor="middle" className="topic-tree__label" fontSize={limb.fontSize}>
          {limb.lines.map((line, index) => <tspan key={index} x="0" dy={index ? limb.fontSize * 1.3 : 0}>{line}</tspan>)}
          <tspan x="0" dy={limb.fontSize * 1.3} className="topic-tree__count" fontSize={limb.fontSize * .9}>{topic.video_count} {topic.video_count === 1 ? 'video' : 'videos'}</tspan>
        </text>
      </g>
    </g>
  }
  return <>
    {layout.limbs.length ? <svg className="living-tree" ref={element => { if (element) onSize(width, height) }}
      viewBox={`${bounds.x} ${bounds.y} ${width} ${height}`} style={{ width: width * zoom, height: height * zoom }}
      role="group" aria-label="Living topic tree. Branches grow recursively from their parent topics. Drag to pan."
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { suppressClick.current = !!drag.current?.moved; drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <path className="living-trunk" d={layout.trunk} fill="#79583e" />
      {layout.roots.map(root => branch(root))}
    </svg> : <p className="note">{loading ? 'Growing your saved topic tree…' : all.length ? 'Your branches are pruned. Restore a topic from the compost pile to grow it back.' : 'No topics yet. Finish and review a session to grow your tree.'}</p>}
  </>
}
