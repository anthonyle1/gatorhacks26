import { createContext, useContext } from 'react'

export type PilePhase = 'idle' | 'burning' | 'ash'

export interface CompostItem {
  /** Key used to hide the item once the pile is burned. */
  key: string
  kind: 'branch' | 'twig'
  label: string
  restore: () => void
}

export interface PruneState {
  /** Branch ids that have been pruned. Burning the pile does NOT unprune them. */
  pruned: Record<string, boolean>
  /** Twig (channel) ids that have been snipped. */
  snipped: Record<string, boolean>
  selectedId: string
  phase: PilePhase
  compost: CompostItem[]
  /** Prunable (non-calm) branches pruned so far. */
  prunedCount: number
  setSelected: (id: string) => void
  setPruned: (branchId: string, value: boolean) => void
  setSnipped: (twigId: string, value: boolean) => void
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
