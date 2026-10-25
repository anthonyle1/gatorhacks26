
import { useCallback, useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { useTreeCamera } from '../../tree/useTreeCamera'
import { TopicTree } from '../../tree/TopicTree'
// import WebsiteTopicEditor from '../../tree/WebsiteTopicEditor'
import type { Topic, TreeData } from '../../tree/types'
import { usePrune } from '../../state/prune-context'

// const LEGEND = [
//   { color: '#94aa98', label: 'Not rated' },
//   { color: 'var(--calm-leaf)', label: 'Healthy' },
//   { color: 'var(--some-leaf)', label: 'Some hostility' },
//   { color: 'var(--heavy-leaf)', label: 'Heavy hostility' },
// ]

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

  const viewportRef = useRef<HTMLDivElement>(null)

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
      tree_videos: (taxonomy?.tree_videos ?? []).map(video => {
        const counts = video.analysis?.sentiment?.counts
        const validCounts = counts && typeof counts.positive === 'number' && typeof counts.neutral === 'number' && typeof counts.negative === 'number'
        return { video_id: video.video_id, title: video.title, platform: video.platform,
          analysis: video.analysis ? {
            assessment: video.analysis.assessment,
            sentiment: validCounts ? { counts: { positive: counts.positive!, neutral: counts.neutral!, negative: counts.negative! } } : null,
          } : undefined }
      }),
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

  const camera = useTreeCamera(viewportRef, treeSize)
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

      </div>
      <div className="website-tree-legend" aria-label="Leaf color scale">
        <span><i style={{ background: '#a8c394' }} />Lower</span>
        <span><i style={{ background: '#d8bf86' }} />Some</span>
        <span><i style={{ background: '#cb9582' }} />Higher</span>
        <span><i style={{ background: '#d8ded3' }} />Unrated</span>
      </div>
      <p className="website-tree-color-note">Colors compare warnings and negative-comment shares across your topics, including child topics. Gray means analysis is unavailable.</p>

      {/* Main layout: SVG tree + Chrome-style editor */}
      <div className="website-tree-layout">
        <div className="website-tree-scene">
          <div className="website-tree-zoom" role="group" aria-label="Tree zoom controls">
            <button type="button" onClick={camera.zoomOut} disabled={camera.zoom <= camera.limits.min + 1e-8 || !growingTopics}
              aria-label="Zoom out" title="Zoom out"><ZoomOut size={14} aria-hidden="true" /></button>
            <button type="button" onClick={camera.zoomIn} disabled={camera.zoom >= camera.limits.max - 1e-8 || !growingTopics}
              aria-label="Zoom in" title="Zoom in"><ZoomIn size={14} aria-hidden="true" /></button>
            <button type="button" onClick={camera.fit} disabled={!growingTopics}>Fit tree</button>
          </div>
          <div id="tree" ref={viewportRef} className="website-tree-viewport" tabIndex={0}
            aria-label="Topic tree. Drag to pan. Use the mouse wheel or zoom buttons to zoom.">
            <TopicTree data={treeData} falling={fallingIds} busy={busy} zoom={camera.zoom} loading={loading}
              onPrune={setPruned} onSize={handleSize} onPan={camera.panTo} />
          </div>
        </div>
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
