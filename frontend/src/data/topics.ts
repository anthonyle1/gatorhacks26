
import type { Branch } from '../types'

export interface Topic {
  id: string
  name: string
  description: string
  parent_id: string | null
  video_count: number
  selected: boolean
  children: Topic[]
}

export interface TopicTree {
  tree: Topic[]
  global_video_count: number
}

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

export function topicBranches(topics: Topic[], total: number): Branch[] {
  return topics.map(topic => {
    const share = total ? topic.video_count / total : 0

    return {
      id: topic.id,
      name: topic.name,
      parentId: topic.parent_id,
      why: topic.description,
      videoCount: topic.video_count,

      // Topic discovery does not establish a category's hostility rating.
      level: 'not_rated',

      size:
        share < 0.03
          ? 'Sprout'
          : share <= 0.1
            ? 'Growing'
            : 'Full branch',

      children: topicBranches(topic.children, total),
    }
  })
}

export function flattenTree(tree: Branch[]): Branch[] {
  return tree.flatMap(branch => [
    branch,
    ...flattenTree(branch.children ?? []),
  ])
}

export async function requestTree(
  body?: { category_id: string; reduce: boolean },
): Promise<TopicTree> {

  if (DEMO_MODE) {
    if (body) {
      throw new Error(
        'Saving topic preferences is not enabled in demo mode yet.',
      )
    }

    const response = await fetch('/api/demo/taxonomy')

    if (!response.ok) {
      throw new Error(
        `Could not load demo topics (${response.status}).`,
      )
    }

    return response.json()
  }

  const response = await fetch(
    `/api/local-sessions/taxonomy${body ? '/preferences' : ''}`,
    {
      method: body ? 'PATCH' : 'GET',
      headers: body
        ? { 'Content-Type': 'application/json' }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  )

  if (!response.ok) {
    throw new Error(
      `Could not ${body ? 'save pruning' : 'load topics'} (${response.status}).`,
    )
  }

  return response.json()
}
