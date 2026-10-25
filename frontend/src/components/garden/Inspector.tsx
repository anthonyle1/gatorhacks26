import { useEffect, useMemo, useState } from 'react'
import { GitBranch, Video } from 'lucide-react'
import { usePrune } from '../../state/prune-context'
import RiskOverview from '../../tree/RiskOverview'
import { gardenTreeData } from '../../tree/gardenTreeData'
import { flatten } from '../../tree/types'
import { scaleTopicRisks, topicRisk } from '../../tree/risk'
import WebsiteTopicEditor from '../../tree/WebsiteTopicEditor'

export default function Inspector() {
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const { tree, taxonomy, cuts, videoCount } = usePrune()
  const overview = useMemo(() => {
    const data = gardenTreeData(tree, taxonomy, cuts, videoCount)
    const topics = flatten(data.tree)
    const index = topics.findIndex(topic => topic.id === inspectedId)
    if (index < 0) return null
    const videos = new Map((data.tree_videos ?? []).map(video => [video.video_id, video]))
    const risks = scaleTopicRisks(topics.map(topic => topicRisk(topic, videos)))
    return { topic: topics[index], risk: risks[index] }
  }, [tree, taxonomy, cuts, videoCount, inspectedId])

  useEffect(() => {
    const handleInspect = (event: Event) => {
      const categoryId = (event as CustomEvent<string>).detail

      if (!categoryId) return

      setInspectedId(categoryId)

      window.requestAnimationFrame(() => {
        document
          .getElementById('garden-topic-editor')
          ?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
            block: 'start',
          })
      })
    }

    window.addEventListener('prune:inspect-topic', handleInspect)

    return () => {
      window.removeEventListener('prune:inspect-topic', handleInspect)
    }
  }, [])

  return (
    <section
      className="inspector inspector--topic-editor botanical-topic-editor"
      aria-label="Explore and manage topics"
    >
      <div className="botanical-topic-editor__header">
        <div>
          <span className="botanical-eyebrow">
            CULTIVATE YOUR INTERESTS
          </span>

          <h2>Explore &amp; manage topics</h2>

          <p>
            {inspectedId
              ? 'Explore this topic, its subtopics, and watched videos.'
              : "Explore what's growing in your feed, inspect videos, and prune topics you want to see less often."}
          </p>
        </div>

        {inspectedId ? (
          <button
            type="button"
            className="botanical-topic-editor__close"
            onClick={() => setInspectedId(null)}
          >
            Show all topics ×
          </button>
        ) : (
          <span
            className="botanical-topic-editor__flourish"
            aria-hidden="true"
          >
            ❧
          </span>
        )}
      </div>

      {overview && (
        <section className="garden-topic-overview" aria-label={`Overview of ${overview.topic.name}`}>
          <div className="garden-topic-overview__heading">
            <h3>{overview.topic.name}</h3>
            <span><Video size={15} aria-hidden="true" />{overview.topic.video_count} {overview.topic.video_count === 1 ? 'video' : 'videos'}</span>
            <span><GitBranch size={15} aria-hidden="true" />{overview.topic.children.length} child topics</span>
          </div>
          <RiskOverview risk={overview.risk} />
        </section>
      )}
      <WebsiteTopicEditor inspectedId={inspectedId} />
    </section>
  )
}
