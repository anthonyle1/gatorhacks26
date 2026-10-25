
import { useCallback, useMemo, useState } from 'react'
import { TopicTree } from '../../tree/TopicTree'
// import WebsiteTopicEditor from '../../tree/WebsiteTopicEditor'
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
    taxonomy,
    branches,
    pruned,
    cuts,
    falling,
    setPruned,
    loading,
    busy,
    error,
    videoCount,
  } = usePrune()

  const [zoom, setZoom] = useState(1)

  const [treeSize, setTreeSize] = useState({
    width: 0,
    height: 0,
  })

  // Index the full taxonomy so the SVG tree
  // can retain video IDs from the backend.
  const treeData = useMemo<TreeData>(() => {
    const taxonomyTopics = new Map<
      string,
      { video_ids?: string[] }
    >()

    function indexTopics(
      nodes: NonNullable<typeof taxonomy>['tree']
    ) {
      for (const topic of nodes) {
        taxonomyTopics.set(topic.id, topic)
        indexTopics(topic.children ?? [])
      }
    }

    indexTopics(taxonomy?.tree ?? [])

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
          video_ids:
            taxonomyTopics.get(branch.id)?.video_ids ?? [],
          selected,
          inherited,
          reduce,
          children: convert(
            branch.children ?? [],
            reduce
          ),
        }
      })
    }

    return {
      tree: convert(tree),
      global_video_count: videoCount,
    }
  }, [tree, taxonomy, cuts, videoCount])

  // Preserve falling-branch animations.
  const fallingIds = useMemo(
    () =>
      new Set(
        Object.entries(falling)
          .filter(([, active]) => active)
          .map(([id]) => id)
      ),
    [falling]
  )

  const handleSize = useCallback(
    (width: number, height: number) => {
      setTreeSize(current =>
        current.width === width &&
        current.height === height
          ? current
          : { width, height }
      )
    },
    []
  )

  // Fit the SVG tree inside its viewport.
  const fitTree = useCallback(() => {
    const viewport = document.getElementById('tree')

    if (
      !viewport ||
      !treeSize.width ||
      !treeSize.height
    ) {
      setZoom(1)
      return
    }

    const widthRatio =
      viewport.clientWidth / treeSize.width

    const heightRatio =
      viewport.clientHeight / treeSize.height

    setZoom(
      Math.max(
        0.15,
        Math.min(1, widthRatio, heightRatio)
      )
    )
  }, [treeSize])

  const growingTopics = useMemo(
    () =>
      branches.filter(
        branch => !pruned[branch.id]
      ).length,
    [branches, pruned]
  )

  return (
    <section
      className="card card--lg tree-card feed-tree-card"
      aria-labelledby="tree-heading"
    >
      {/* Header */}
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
            Explore your feed, organize categories,
            and prune topics you want to see less often.
          </p>
        </div>

        <span
          className="feed-tree-card__flourish"
          aria-hidden="true"
        >
          ❧
        </span>
      </div>

      {/* Error message */}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {/* Tree toolbar */}
      <div className="website-tree-toolbar">
        <span>
          {growingTopics} growing topics
        </span>

        <div className="website-tree-zoom">
          <button
            type="button"
            onClick={() =>
              setZoom(current =>
                Math.max(0.15, current / 1.2)
              )
            }
            aria-label="Zoom out"
          >
            −
          </button>

          <span>
            {Math.round(zoom * 100)}%
          </span>

          <button
            type="button"
            onClick={() =>
              setZoom(current =>
                Math.min(3, current * 1.2)
              )
            }
            aria-label="Zoom in"
          >
            +
          </button>

          <button
            type="button"
            onClick={fitTree}
          >
            Fit
          </button>
        </div>
      </div>

      {/* Main layout: SVG tree + Chrome-style editor */}
      <div className="website-tree-layout">
  <div
    id="tree"
    className="website-tree-viewport"
  >
    <TopicTree
      data={treeData}
      falling={fallingIds}
      busy={busy}
      zoom={zoom}
      loading={loading}
      onPrune={setPruned}
      onSize={handleSize}
    />
  </div>

  {/* <div className="website-tree-details">
    <WebsiteTopicEditor />
  </div> */}
      </div>

      {/* Empty tree state */}
      {!loading && branches.length === 0 && (
        <p role="status">
          Your garden is ready to grow.
          Finish a scrolling session to discover
          your first topics.
        </p>
      )}

      {/* Footer */}
      <p className="note">
        Each branch represents a topic found in your feed.
        Pruning a branch also removes its child topics
        from the growing tree. Restore it from the
        compost pile.
      </p>
    </section>
  )
}
