
import { useCallback, useMemo, useState } from 'react'
import { TopicTree } from '../../tree/TopicTree'
import type { Topic, TreeData } from '../../tree/types'
import { usePrune } from '../../state/prune-context'
import { LEVEL_LABEL } from '../Chip'
import Tree from '../Tree'

const LEGEND = [
  { color: '#94aa98', label: 'Not rated' },
  { color: 'var(--calm-leaf)', label: 'Healthy' },
  { color: 'var(--some-leaf)', label: 'Some hostility' },
  { color: 'var(--heavy-leaf)', label: 'Heavy hostility' },
]

export default function TreeCard() {
  const {
    tree,
    branches,
    pruned,
    cuts,
    falling,
    selectedId,
    setSelected,
    setPruned,
    loading,
    error,
    videoCount,
  } = usePrune()

  const [zoom, setZoom] = useState(1)
  const [treeSize, setTreeSize] = useState({
    width: 0,
    height: 0,
  })

  const treeData = useMemo<TreeData>(() => {
    function convert(
      nodes: typeof tree,
      inherited = false
    ): Topic[] {
      return nodes.map(branch => {
        const selected = !!cuts[branch.id]
        const reduce = inherited || selected

        return {
          id: branch.id,
          name: branch.name,
          description: branch.why || '',
          video_count: branch.videoCount ?? 0,
          video_ids: [],
          selected,
          inherited,
          reduce,
          children: convert(branch.children ?? [], reduce),
        }
      })
    }

    return {
      tree: convert(tree),
      global_video_count: videoCount,
    }
  }, [tree, cuts, videoCount])

  const fallingIds = useMemo(
    () => new Set(
      Object.entries(falling)
        .filter(([, active]) => active)
        .map(([id]) => id)
    ),
    [falling]
  )

  const handleSize = useCallback(
    (width: number, height: number) => {
      setTreeSize(current =>
        current.width === width && current.height === height
          ? current
          : { width, height }
      )
    },
    []
  )

  const fitTree = () => {
    const viewport = document.getElementById('tree')

    if (!viewport || !treeSize.width || !treeSize.height) {
      setZoom(1)
      return
    }

    setZoom(
      Math.max(
        0.15,
        Math.min(
          1,
          viewport.clientWidth / treeSize.width,
          viewport.clientHeight / treeSize.height
        )
      )
    )
  }

  return (
    <section
      className="card card--lg tree-card feed-tree-card"
      aria-labelledby="tree-heading"
    >
      <div className="feed-tree-card__heading">
        <div>
          <span className="botanical-eyebrow">
            YOUR LITTLE ECOSYSTEM
          </span>

          <h2 id="tree-heading">
            The story of your feed
          </h2>

          <p>
            Every branch represents a topic.
            Select one to explore its details.
          </p>
        </div>

        <span
          className="feed-tree-card__flourish"
          aria-hidden="true"
        >
          ❧
        </span>
      </div>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <div className="website-tree-toolbar">
        <span>
          {branches.filter(branch => !pruned[branch.id]).length}
          {' '}growing topics
        </span>

        <div className="website-tree-zoom">
          <button
            type="button"
            onClick={() =>
              setZoom(value => Math.max(0.15, value / 1.2))
            }
            aria-label="Zoom out"
          >
            −
          </button>

          <span>{Math.round(zoom * 100)}%</span>

          <button
            type="button"
            onClick={() =>
              setZoom(value => Math.min(3, value * 1.2))
            }
            aria-label="Zoom in"
          >
            +
          </button>

          <button type="button" onClick={fitTree}>
            Fit
          </button>
        </div>
      </div>

      <div className="website-tree-layout">
        <div id="tree" className="website-tree-viewport">
          <TopicTree
            data={treeData}
            falling={fallingIds}
            busy={false}
            zoom={zoom}
            loading={loading}
            onPrune={setPruned}
            onSize={handleSize}
          />
        </div>

        <div className="website-tree-details">
          <div id="topic-inspector" />

          <div id="branches" />
        </div>
      </div>

      {!loading && !branches.length && (
        <p role="status">
          Your garden is ready to grow. Finish a scrolling
          session to discover your first topics.
        </p>
      )}

      <div className="branch-grid">
        {branches.map(branch => (
          <button
            key={branch.id}
            type="button"
            className={`branch-tile${
              selectedId === branch.id
                ? ' branch-tile--selected'
                : ''
            }`}
            aria-pressed={selectedId === branch.id}
            onClick={() => setSelected(branch.id)}
          >
            <span className="branch-tile__name">
              {branch.name}
            </span>

            <span className="branch-tile__meta">
              {branch.videoCount ?? 0} videos
              {' · '}
              {pruned[branch.id] ? 'Pruned' : 'Growing'}
            </span>
          </button>
        ))}
      </div>

      <p className="note">
        Each branch represents a topic found in your feed.
        Pruning a branch also removes its child topics from
        the growing tree. Restore it from the compost pile.
      </p>
    </section>
  )
}
