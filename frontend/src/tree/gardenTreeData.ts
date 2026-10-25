import type { Branch } from '../types'
import type { TopicTree } from '../data/topics'
import type { Topic, TreeData } from './types'

// Share taxonomy evidence and optimistic prune state between the tree and topic list.
export function gardenTreeData(tree: Branch[], taxonomy: TopicTree | null, cuts: Record<string, boolean>, videoCount: number): TreeData {
    const taxonomyTopics = new Map<
      string,
      { video_ids?: string[] }
    >()

    function indexTopics(
      nodes: TopicTree['tree']
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
}
