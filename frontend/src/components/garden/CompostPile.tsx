import { useMemo } from 'react'
import { GitBranch, Undo2 } from 'lucide-react'
import { usePrune } from '../../state/prune-context'
import { compostTopics } from '../../tree/compostTopics'
import type { CompostTopic } from '../../tree/compostTopics'
import { FlameIcon } from '../icons'

const MAX_PIECES = 8
// [left, top, rotation] for each stick on the pile
const SLOTS: Array<[number, number, number]> = [
  [40, 140, -8], [130, 144, 10], [86, 128, 4], [20, 120, -18],
  [150, 124, -6], [64, 108, 16], [118, 104, -12], [92, 88, 6],
]

const FLAME_PATH = 'M30 108 C8 100 4 76 16 54 C20 70 26 72 28 64 C24 44 34 22 30 2 C46 22 58 50 52 78 C50 96 42 106 30 108 Z'
const FLAME_CORE = 'M30 106 C18 100 16 84 24 70 C26 80 32 82 33 74 C32 64 36 54 36 44 C44 58 48 76 42 92 C40 100 36 104 30 106 Z'

function Flame({ width, height, fill, speed, margin }: { width: number; height: number; fill: string; speed: number; margin?: string }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 60 110"
      style={{ transformOrigin: 'bottom center', animation: `pruneFlicker ${speed}s ease-in-out infinite alternate`, margin }}
      aria-hidden="true"
    >
      <path d={FLAME_PATH} fill={fill} />
      <path d={FLAME_CORE} fill="#F6C443" />
    </svg>
  )
}

export default function CompostPile() {
  const { compost, tree, busy, phase, burnPile } = usePrune()
  const restoreById = new Map(compost.map(item => [item.key.slice(2), item.restore]))
  const topics = useMemo(() => compostTopics(tree, new Set(compost.map(item => item.key.slice(2)))), [tree, compost])

  const idle = phase === 'idle'
  const burning = phase === 'burning'
  const ashing = phase === 'ash'
  const canClear = compost.length > 0 && idle
  const phaseLabel = burning ? 'Burning...' : ashing ? 'Cleared' : ''
  const pieces = ashing ? [] : compost.slice(0, MAX_PIECES)

  function topicRow(topic: CompostTopic) {
    const parents = topic.coverage.filter(root => root.id !== topic.id)
    const restore = restoreById.get(topic.id)
    return (
      <li key={topic.id} className="compost-topic-item">
        <div className="compost-topic-row">
          <GitBranch size={15} aria-hidden="true" />
          <span className="compost-topic-label">
            {topic.name}
            {parents.length > 0 && <small>Pruned with {parents.map(parent => parent.name).join(', ')}</small>}
            {!topic.coverage.length && <small>Parent topic</small>}
          </span>
          {restore && !parents.length && (
            <button type="button" className="compost-topic-restore" disabled={busy || !idle}
              title={`Unprune ${topic.name}`} aria-label={`Unprune ${topic.name}`} onClick={restore}>
              Unprune <Undo2 size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        {topic.children.length > 0 && <ul className="compost-topic-children" aria-label={`Child topics of ${topic.name}`}>
          {topic.children.map(topicRow)}
        </ul>}
      </li>
    )
  }

  return (
    <section className="card card--lg compost" aria-labelledby="compost-heading">
      <div className="compost__head">
        <h2 id="compost-heading" className="h3">Compost pile</h2>
        <button type="button" className="btn btn--fire" disabled={!canClear} onClick={burnPile}>
          <FlameIcon size={16} />
          Clear pile
        </button>
      </div>
      <p className="compost__intro">
        Every branch you prune lands here. Restore anything, or burn the pile to clear your pruning history.
      </p>

      <div className="compost__body">
        <div className="pile" role="img" aria-label={`Compost pile with ${compost.length} cut${compost.length === 1 ? '' : 's'}`}>
          {compost.length === 0 && idle && (
            <div className="pile__empty">
              <span>Empty</span>
            </div>
          )}

          {compost.length > 0 && !ashing && (
            <svg width="260" height="200" viewBox="0 0 260 200" style={{ position: 'absolute', left: 0, top: 0 }} aria-hidden="true">
              <path d="M18 186 C40 150 80 132 130 130 C180 132 220 150 242 186 Z" fill={burning ? '#3A2A1E' : '#7A5A3E'} />
            </svg>
          )}

          {pieces.map((item, i) => {
            const [left, top, rot] = SLOTS[i]
            const scale = item.kind === 'twig' ? 0.75 : 1
            return (
              <div
                key={item.key}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  ['--r' as string]: `${rot}deg`,
                  transform: `rotate(${rot}deg) scale(${scale})`,
                  animation: 'pruneDrop 0.5s ease-out',
                  ...(burning ? { filter: 'brightness(0.35) sepia(0.6)', transition: 'filter 1.2s' } : {}),
                }}
              >
                <svg width="72" height="30" viewBox="0 0 72 30" aria-hidden="true">
                  <path d="M4 20 C20 16 40 14 66 10" stroke="#6B4A33" strokeWidth="4" fill="none" strokeLinecap="round" />
                  <path d="M30 15 C34 9 38 6 44 4" stroke="#6B4A33" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                  <ellipse cx="66" cy="9" rx="6" ry="3.5" fill="#8A5A3B" />
                  <ellipse cx="46" cy="4" rx="5" ry="3" fill="#8A5A3B" />
                  <ellipse cx="20" cy="22" rx="5" ry="3" fill="#A9784F" />
                </svg>
              </div>
            )
          })}

          {burning && (
            <div className="pile__fire">
              <Flame width={60} height={110} fill="#E8742A" speed={0.35} />
              <Flame width={74} height={140} fill="#D9541E" speed={0.28} margin="0 -14px" />
              <Flame width={56} height={100} fill="#E8742A" speed={0.4} />
            </div>
          )}

          {ashing && (
            <div className="pile__ash">
              <svg width="260" height="200" viewBox="0 0 260 200" aria-hidden="true">
                <path d="M50 186 C70 168 100 160 130 160 C160 160 190 168 210 186 Z" fill="#9B958C" />
                <circle cx="96" cy="172" r="3" fill="#6F6A63" />
                <circle cx="140" cy="168" r="2.5" fill="#6F6A63" />
                <circle cx="170" cy="176" r="3" fill="#6F6A63" />
              </svg>
              <div className="smoke smoke--a" />
              <div className="smoke smoke--b" />
            </div>
          )}

          {compost.length >= MAX_PIECES && idle && (
            <span className="pile__overflow">Overflowing · {compost.length} cuts</span>
          )}
          <span className="pile__phase">{phaseLabel}</span>
        </div>

        <div className={`compost__list${burning ? ' compost-topic-list--burning' : ''}`} role="region" aria-label="Pruned topics to restore" tabIndex={0}>
          {compost.length === 0 && idle && (
            <span className="compost__none">Nothing in the pile. Prune a branch and it lands here.</span>
          )}
          {!ashing && topics.length > 0 && <ul className="compost-topic-list">{topics.map(topicRow)}</ul>}
        </div>
      </div>
    </section>
  )
}
