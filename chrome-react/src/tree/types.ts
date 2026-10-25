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
}

export interface TreeData {
  tree: Topic[]
  global_video_count: number
  tree_videos?: TopicVideo[]
}

export const flatten = (nodes: Topic[]): Topic[] => nodes.flatMap(node => [node, ...flatten(node.children || [])])
