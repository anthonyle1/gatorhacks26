import type { Branch } from '../types'

export interface TopicVideo {
  video_id: string
  source_id?: string
  platform?: string
  title?: string
  caption?: string
  comments?: string[]
  transcripts?: Array<{
    id?: string
    text: string
    media_start?: number
    media_end?: number
  }>
  dwell_seconds?: number
  watch_count?: number
  sentiment_balance?: number
  context_summary?: string
  synthetic?: boolean
  analysis?: {
    status?: string
    sentiment?: {
      total_comments?: number
      counts?: {
        negative?: number
        neutral?: number
        positive?: number
      }
    }
    assessment?: {
      content_signals?: { id: string; evidence?: string }[]
      signal_polarities?: Record<string, string>
      negative_for_user?: string
      reason?: string
      context_summary?: string
    }
    comments?: Array<{
      id?: string
      text?: string
      sentiment?: string
      confidence?: number
    }>
  }
}

export interface Topic {
  id: string
  name: string
  description: string
  parent_id: string | null
  video_count: number
  video_ids?: string[]
  selected: boolean
  inherited?: boolean
  reduce?: boolean
  synthetic?: boolean
  children: Topic[]
}

export interface TopicTree {
  tree: Topic[]
  global_video_count: number
  tree_videos?: TopicVideo[]
}

const DEMO_URL = '/api/demo/taxonomy'
const LIVE_URL = '/api/local-sessions/taxonomy'

async function fetchTree(url: string): Promise<TopicTree> {
  const response = await fetch(url, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(
      `Could not load taxonomy from ${url} (${response.status})`
    )
  }

  return response.json()
}

function normalizeTopics(
  topics: Topic[],
  source: 'demo' | 'live',
  parentId: string | null = null
): Topic[] {
  return topics.map(topic => {
    const id = source === 'demo'
      ? `demo:${topic.id}`
      : topic.id

    return {
      ...topic,
      id,
      parent_id: parentId,
      synthetic: source === 'demo',
      selected: source === 'demo' ? false : topic.selected,
      inherited: false,
      reduce: source === 'demo' ? false : !!topic.reduce,
      video_ids: topic.video_ids ?? [],
      children: normalizeTopics(
        topic.children ?? [],
        source,
        id
      ),
    }
  })
}

export async function requestTree(
  body?: { category_id: string; reduce: boolean }
): Promise<TopicTree> {
  if (body) {
    if (body.category_id.startsWith('demo:')) {
      throw new Error(
        'Demo branch pruning must be saved locally.'
      )
    }

    const response = await fetch(
      `${LIVE_URL}/preferences`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      throw new Error(
        `Could not save pruning (${response.status})`
      )
    }

    return response.json()
  }

  const demoEnabled =
    localStorage.getItem('prune-demo-enabled') === 'true'

  if (demoEnabled) {
    const demo = await fetchTree(DEMO_URL)

    return {
      ...demo,
      tree: normalizeTopics(demo.tree, 'demo'),
      tree_videos: (demo.tree_videos ?? []).map(video => ({
        ...video,
        synthetic: true,
      })),
    }
  }

  const live = await fetchTree(LIVE_URL)

  return {
    ...live,
    tree: normalizeTopics(live.tree, 'live'),
    tree_videos: (live.tree_videos ?? []).map(video => ({
      ...video,
      synthetic: false,
    })),
  }
}

export function topicBranches(
  topics: Topic[],
  total: number
): Branch[] {
  return topics.map(topic => {
    const share = total
      ? topic.video_count / total
      : 0

    return {
      id: topic.id,
      name: topic.name,
      parentId: topic.parent_id,
      why: topic.description,
      videoCount: topic.video_count,
      level: 'not_rated',
      size:
        share < 0.03
          ? 'Sprout'
          : share <= 0.1
            ? 'Growing'
            : 'Full branch',
      children: topicBranches(
        topic.children ?? [],
        total
      ),
    }
  })
}

export function flattenTree(tree: Branch[]): Branch[] {
  return tree.flatMap(branch => [
    branch,
    ...flattenTree(branch.children ?? []),
  ])
}
