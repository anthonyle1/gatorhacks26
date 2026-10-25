
import { createContext, useContext } from 'react'
import type { Branch } from '../types'
import type { TopicTree } from '../data/topics'

export type PilePhase = 'idle' | 'burning' | 'ash'

export interface CompostItem {
  key: string
  kind: 'branch' | 'twig'
  label: string
  restore: () => void
}

export interface CategoryChange {
  name?: string
  parent_id?: string | null
  move?: boolean
  merge_into?: string
  before_id?: string
  after_id?: string
}

export interface PruneState {
  tree: Branch[]
  branches: Branch[]
  taxonomy: TopicTree | null

  falling: Record<string, boolean>
  cuts: Record<string, boolean>
  loading: boolean
  busy: boolean
  error: string | null
  videoCount: number

  pruned: Record<string, boolean>
  selectedId: string

  phase: PilePhase
  compost: CompostItem[]
  prunedCount: number

  setSelected: (id: string) => void
  setPruned: (branchId: string, value: boolean) => void
  pruneAll: () => void
  burnPile: () => void

  editCategory: (
    categoryId: string,
    change: CategoryChange
  ) => Promise<void>

  moveVideo: (
    videoId: string,
    categoryId: string
  ) => Promise<void>

  refreshTree: () => Promise<void>
}

export const PruneContext =
  createContext<PruneState | null>(null)

export function usePrune(): PruneState {
  const ctx = useContext(PruneContext)

  if (!ctx) {
    throw new Error(
      'usePrune must be used inside <PruneProvider>'
    )
  }

  return ctx
}
