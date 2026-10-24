import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BRANCHES, PRUNABLE_BRANCHES, getBranch } from '../data/sample'
import { PruneContext, type CompostItem, type PilePhase, type PruneState } from './prune-context'

const BURN_MS = 1800
const ASH_MS = 1400

/**
 * Holds prune/snip/compost state for the whole app so the Garden and Calendar
 * pages stay in sync. Currently in-memory only: wire the setters to the backend
 * (and persist) when the API exists.
 */
export function PruneProvider({ children }: { children: ReactNode }) {
  const [pruned, setPrunedMap] = useState<Record<string, boolean>>({})
  const [snipped, setSnippedMap] = useState<Record<string, boolean>>({})
  // Compost keys that were burned. Re-pruning an item brings it back to the pile.
  const [cleared, setCleared] = useState<Record<string, boolean>>({})
  const [selectedId, setSelected] = useState(BRANCHES[0].id)
  const [phase, setPhase] = useState<PilePhase>('idle')
  const timers = useRef<number[]>([])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((t) => window.clearTimeout(t))
  }, [])

  const unclear = useCallback((key: string) => {
    setCleared((c) => {
      if (!c[key]) return c
      const next = { ...c }
      delete next[key]
      return next
    })
  }, [])

  const setPruned = useCallback(
    (branchId: string, value: boolean) => {
      setPrunedMap((p) => ({ ...p, [branchId]: value }))
      unclear(`B:${branchId}`)
    },
    [unclear],
  )

  const setSnipped = useCallback(
    (twigId: string, value: boolean) => {
      setSnippedMap((s) => ({ ...s, [twigId]: value }))
      unclear(`T:${twigId}`)
    },
    [unclear],
  )

  const pruneAll = useCallback(() => {
    setPrunedMap((p) => {
      const next = { ...p }
      PRUNABLE_BRANCHES.forEach((b) => {
        next[b.id] = true
      })
      return next
    })
  }, [])

  const compost = useMemo<CompostItem[]>(() => {
    const items: CompostItem[] = []
    BRANCHES.forEach((b) => {
      const key = `B:${b.id}`
      if (pruned[b.id] && !cleared[key]) {
        items.push({ key, kind: 'branch', label: `Branch: ${b.name}`, restore: () => setPruned(b.id, false) })
      }
    })
    Object.keys(snipped).forEach((twigId) => {
      const key = `T:${twigId}`
      if (!snipped[twigId] || cleared[key]) return
      const branchId = twigId.slice(0, twigId.lastIndexOf('-'))
      const branch = getBranch(branchId)
      // Snipped twigs on a pruned branch are already covered by the branch itself.
      if (!branch || pruned[branch.id]) return
      const n = Number(twigId.slice(twigId.lastIndexOf('-') + 1)) + 1
      items.push({
        key,
        kind: 'twig',
        label: `Twig: [Channel ${n}] on ${branch.name}`,
        restore: () => setSnipped(twigId, false),
      })
    })
    return items
  }, [pruned, snipped, cleared, setPruned, setSnipped])

  const burnPile = useCallback(() => {
    if (compost.length === 0 || phase !== 'idle') return
    const keys = compost.map((c) => c.key)
    setPhase('burning')
    timers.current.push(
      window.setTimeout(() => {
        setCleared((c) => {
          const next = { ...c }
          keys.forEach((k) => {
            next[k] = true
          })
          return next
        })
        setPhase('ash')
      }, BURN_MS),
      window.setTimeout(() => setPhase('idle'), BURN_MS + ASH_MS),
    )
  }, [compost, phase])

  const prunedCount = PRUNABLE_BRANCHES.filter((b) => pruned[b.id]).length

  const value: PruneState = {
    pruned,
    snipped,
    selectedId,
    phase,
    compost,
    prunedCount,
    setSelected,
    setPruned,
    setSnipped,
    pruneAll,
    burnPile,
  }

  return <PruneContext.Provider value={value}>{children}</PruneContext.Provider>
}
