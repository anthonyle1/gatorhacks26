import { createContext, useContext } from 'react'
import type { Branch } from '../types'

export type PilePhase = 'idle' | 'burning' | 'ash'

export interface CompostItem {
  /** Key used to hide the item once the pile is burned. */
  key: string
  kind: 'branch' | 'twig'
  label: string
  restore: () => void
}

export interface PruneState {
  tree: Branch[]
  branches: Branch[]
  falling: Record<string, boolean>
  cuts: Record<string, boolean>
  loading: boolean
  error: string | null
  videoCount: number
  /** Branch ids that have been pruned. Burning the pile does NOT unprune them. */
  pruned: Record<string, boolean>
  selectedId: string
  phase: PilePhase
  compost: CompostItem[]
  /** All removed topics, including descendants of a cut branch. */
  prunedCount: number
  setSelected: (id: string) => void
  setPruned: (branchId: string, value: boolean) => void
  pruneAll: () => void
  /** Burn the compost pile: clears pruning history only; pruned branches stay pruned. */
  burnPile: () => void
}

export const PruneContext = createContext<PruneState | null>(null)

export function usePrune(): PruneState {
  const ctx = useContext(PruneContext)
  if (!ctx) throw new Error('usePrune must be used inside <PruneProvider>')
  return ctx
}
