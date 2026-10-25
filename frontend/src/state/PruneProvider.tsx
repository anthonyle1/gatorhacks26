import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flattenTree, requestTree, topicBranches, type Topic } from '../data/topics'
import { PruneContext, type CompostItem, type PilePhase, type PruneState } from './prune-context'
import type { Branch } from '../types'

const FALL_MS = 1200

export function PruneProvider({ children }: { children: ReactNode }) {
  const [tree, setTree] = useState<Branch[]>([])
  const [selectedCuts, setSelectedCuts] = useState<Record<string, boolean>>({})
  const [falling, setFalling] = useState<Record<string, boolean>>({})
  const [cleared, setCleared] = useState<Record<string, boolean>>({})
  const [selectedId, setSelected] = useState('')
  const [phase, setPhase] = useState<PilePhase>('idle')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [videoCount, setVideoCount] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const writes = useRef(Promise.resolve())
  const pending = useRef(0)
  const revision = useRef(0)
  const latestChange = useRef<Record<string, number>>({})
  const confirmedCuts = useRef<Record<string, boolean>>({})
  const fallTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    let active = true
    async function load() {
      const version = revision.current
      try {
        const result = await requestTree()
        if (!active || pending.current || version !== revision.current) return
        setTree(topicBranches(result.tree, result.global_video_count))
        setVideoCount(result.global_video_count)
        const cuts: Record<string, boolean> = {}
        function visit(topics: Topic[]) {
          topics.forEach(topic => { cuts[topic.id] = topic.selected; visit(topic.children) })
        }
        visit(result.tree)
        confirmedCuts.current = cuts
        setSelectedCuts(cuts)
        setError(null)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load topics.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    const poll = setInterval(() => { void load() }, 10000)
    const timeouts = timers.current
    return () => { active = false; clearInterval(poll); timeouts.forEach(clearTimeout) }
  }, [])

  const branches = useMemo(() => flattenTree(tree), [tree])
  const pruned = useMemo(() => {
    const result: Record<string, boolean> = {}
    function visit(nodes: Branch[], inherited = false) {
      nodes.forEach(node => {
        result[node.id] = inherited || !!selectedCuts[node.id]
        visit(node.children ?? [], result[node.id])
      })
    }
    visit(tree)
    return result
  }, [tree, selectedCuts])

  const setPruned = useCallback((id: string, value: boolean) => {
    if (!branches.some(branch => branch.id === id)) return
    revision.current++
    const version = revision.current
    latestChange.current[id] = version
    pending.current++
    setSelectedCuts(cuts => ({ ...cuts, [id]: value }))
    setCleared(items => ({ ...items, [id]: false }))
    clearTimeout(fallTimers.current[id])
    if (value && !pruned[id]) {
      setFalling(items => ({ ...items, [id]: true }))
      const timer = setTimeout(() => setFalling(items => ({ ...items, [id]: false })), FALL_MS)
      fallTimers.current[id] = timer
      timers.current.push(timer)
    } else {
      setFalling(items => ({ ...items, [id]: false }))
    }
    // Serialize writes so rapid prune/undo operations reach the backend in order.
    writes.current = writes.current.then(async () => {
      try {
        await requestTree({ category_id: id, reduce: value })
        confirmedCuts.current[id] = value
        setError(null)
      } catch (cause) {
        if (latestChange.current[id] === version) {
          setSelectedCuts(cuts => ({ ...cuts, [id]: !!confirmedCuts.current[id] }))
          setFalling(items => ({ ...items, [id]: false }))
        }
        setError(cause instanceof Error ? cause.message : 'Could not save pruning.')
      } finally { pending.current-- }
    })
  }, [branches, pruned])

  const compost = useMemo<CompostItem[]>(() => branches
    .filter(branch => selectedCuts[branch.id] && !cleared[branch.id])
    .map(branch => ({ key: `B:${branch.id}`, kind: 'branch', label: `Branch: ${branch.name}`,
      restore: () => setPruned(branch.id, false) })), [branches, selectedCuts, cleared, setPruned])

  const burnPile = useCallback(() => {
    if (!compost.length || phase !== 'idle') return
    const ids = compost.map(item => item.key.slice(2))
    setPhase('burning')
    timers.current.push(setTimeout(() => {
      setCleared(items => ({ ...items, ...Object.fromEntries(ids.map(id => [id, true])) }))
      setPhase('ash')
    }, 1800), setTimeout(() => setPhase('idle'), 3200))
  }, [compost, phase])

  const value: PruneState = {
    tree, branches, falling, loading, error, videoCount, pruned,
    cuts: selectedCuts, selectedId, phase, compost,
    prunedCount: branches.filter(branch => pruned[branch.id]).length,
    setSelected, setPruned,
    pruneAll: () => tree.filter(branch => !pruned[branch.id]).forEach(branch => setPruned(branch.id, true)),
    burnPile,
  }
  return <PruneContext.Provider value={value}>{children}</PruneContext.Provider>
}
