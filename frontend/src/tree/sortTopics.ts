import type { Topic } from '../data/topics'

export type TopicSort = 'tree' | 'critical-desc' | 'critical-asc'

/** Sort siblings while keeping descendants under their parents. Unrated topics stay last. */
export function sortTopics(nodes: Topic[], scores: Map<string, number | null>, order: TopicSort): Topic[] {
  if (order === 'tree') return nodes
  const direction = order === 'critical-desc' ? -1 : 1
  return nodes.map(node => ({ ...node, children: sortTopics(node.children ?? [], scores, order) }))
    .sort((a, b) => {
      const left = scores.get(a.id), right = scores.get(b.id)
      if (left == null) return right == null ? 0 : 1
      if (right == null) return -1
      return direction * (left - right)
    })
}
