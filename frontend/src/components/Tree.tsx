import { useMemo, type CSSProperties } from 'react'
import type { Branch } from '../types'
import { usePrune } from '../state/prune-context'

interface Point { x: number; y: number }
interface Limb { branch: Branch; point: Point; children: Limb[] }

function layout(tree: Branch[]) {
  const countLeaves = (nodes: Branch[]): number => nodes.reduce((sum, node) =>
    sum + (node.children?.length ? countLeaves(node.children) : 1), 0)
  const maxDepth = (nodes: Branch[]): number => nodes.length ? 1 + Math.max(...nodes.map(node => maxDepth(node.children ?? []))) : 0
  const width = Math.max(640, countLeaves(tree) * 150 + 100)
  const height = Math.max(520, maxDepth(tree) * 110 + 180)
  const slots = Math.max(1, countLeaves(tree))
  let leaf = 0
  function place(branch: Branch, depth: number): Limb {
    const children = (branch.children ?? []).map(child => place(child, depth + 1))
    const x = children.length
      ? (children[0].point.x + children[children.length - 1].point.x) / 2
      : 50 + (leaf++ + 0.5) * (width - 100) / slots
    return { branch, children, point: { x, y: height - 175 - depth * 110 } }
  }
  return { width, height, roots: tree.map(branch => place(branch, 0)) }
}

function LimbView({ limb, from, carried = false }: { limb: Limb; from: Point; carried?: boolean }) {
  const { pruned, cuts, falling, selectedId, setSelected } = usePrune()
  const { branch, point, children } = limb
  const dropping = !!falling[branch.id] && !carried
  // A previously removed child must not reappear inside a falling parent.
  if (carried && cuts[branch.id] && !falling[branch.id]) return null
  if (pruned[branch.id] && !dropping && !carried) return null
  const radius = branch.size === 'Sprout' ? 10 : branch.size === 'Growing' ? 15 : 20
  const color = branch.level === 'heavy' ? '#a9784f' : branch.level === 'some' ? '#d5ab4d' : branch.level === 'calm' ? '#4e9a63' : '#94aa98'
  const cut = !!pruned[branch.id] || carried
  return (
    <g className={dropping ? 'topic-limb topic-limb--falling' : 'topic-limb'}
      style={{ transformOrigin: `${from.x}px ${from.y}px`, '--fall-turn': point.x < from.x ? '-24deg' : '24deg' } as CSSProperties}>
      <path d={`M${from.x} ${from.y} C${from.x} ${point.y + 45} ${point.x} ${from.y - 45} ${point.x} ${point.y}`}
        stroke="#6b4a33" strokeWidth={Math.min(12, 3 + Math.sqrt(branch.videoCount ?? 0))} fill="none" strokeLinecap="round" />
      <g className="topic-node" role="button" tabIndex={cut ? -1 : 0}
        aria-label={`${branch.name}, ${branch.videoCount ?? 0} videos. Inspect topic.`}
        aria-pressed={selectedId === branch.id}
        onClick={() => { if (!cut) setSelected(branch.id) }}
        onKeyDown={event => {
          if (!cut && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelected(branch.id) }
        }}>
        <title>{branch.name}: {branch.videoCount ?? 0} videos</title>
        <circle cx={point.x} cy={point.y} r={radius + 7} fill={selectedId === branch.id ? '#e3b44f' : 'transparent'} />
        <circle cx={point.x} cy={point.y} r={radius} fill={color} />
        <ellipse cx={point.x - radius} cy={point.y - 6} rx={radius * 0.7} ry={radius * 0.45} fill={color} />
        <rect x={point.x - 68} y={point.y + radius + 5} width="136" height="34" rx="8" fill="#f6f8f1" fillOpacity="0.95" />
        <text x={point.x} y={point.y + radius + 19} textAnchor="middle" className="topic-node__label">
          {branch.name.length > 20 ? `${branch.name.slice(0, 19)}…` : branch.name}
        </text>
        <text x={point.x} y={point.y + radius + 32} textAnchor="middle" className="topic-node__count">{branch.videoCount ?? 0} videos</text>
      </g>
      {children.map(child => <LimbView key={child.branch.id} limb={child} from={point} carried={carried || dropping} />)}
    </g>
  )
}

export default function Tree() {
  const { tree } = usePrune()
  const { roots, width, height } = useMemo(() => layout(tree), [tree])
  const origin = { x: width / 2, y: height - 90 }
  return (
    <svg className="tree topic-tree" style={{ minWidth: width }} viewBox={`0 0 ${width} ${height}`}
      role="group" aria-label="Your topic tree. Pruning a topic drops its branch and all child topics.">
      <ellipse cx={width / 2} cy={height - 28} rx={Math.min(width / 2 - 20, 230)} ry="14" fill="#e3eadf" />
      <path d={`M${width / 2} ${height - 30} Q${width / 2 - 8} ${height - 70} ${origin.x} ${origin.y - 30}`}
        stroke="#6b4a33" strokeWidth="26" fill="none" strokeLinecap="round" />
      {roots.map(limb => <LimbView key={limb.branch.id} limb={limb} from={origin} />)}
    </svg>
  )
}
