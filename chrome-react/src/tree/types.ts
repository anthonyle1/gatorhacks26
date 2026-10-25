export interface Topic {
  id: string
  name: string
  description: string
  video_count: number
  video_ids?: string[]
  selected: boolean
  inherited: boolean
  reduce: boolean
  children: Topic[]
}

export interface TopicVideo {
  video_id: string
  title?: string
  url?: string
  platform?: string
  analysis?: {
    assessment?: { content_signals?: { id: string }[]; signal_polarities?: Record<string, string> } | null
    sentiment?: { counts: { positive: number; neutral: number; negative: number } } | null
  }
}

export interface TreeData {
  blacklist_version?: string
  tree: Topic[]
  global_video_count: number
  tree_videos?: TopicVideo[]
}

export const flatten = (nodes: Topic[]): Topic[] => nodes.flatMap(node => [node, ...flatten(node.children || [])])
