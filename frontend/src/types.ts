/** Hostility levels returned by GET /hostility/{video_id} (plus "not_rated"). */
export type Level = 'calm' | 'some' | 'heavy'

/** What a chip can show: a real level, a pruned/snipped item, or a video with no rating yet. */
export type DisplayLevel = Level | 'cut' | 'not_rated'

export type BranchSize = 'Sprout' | 'Growing' | 'Full branch'

export interface Branch {
  id: string
  name: string
  level: Level | 'not_rated'
  size: BranchSize
  /** One-line explanation shown in the inspector. */
  why: string
  children?: Branch[]
  parentId?: string | null
  videoCount?: number
}

export interface Twig {
  id: string
  name: string
  level: Level
}

/** One category's slice of a single day (Calendar page). */
export interface DayCategory {
  branchId: string
  /** Percent of that day's Shorts. */
  share: number
  shorts: number
}

export interface Day {
  id: string
  /** e.g. "Thursday, Oct 22" */
  label: string
  level: Level
  shorts: number
  summary: { names: string[]; detail: string }
  categories: DayCategory[]
}
