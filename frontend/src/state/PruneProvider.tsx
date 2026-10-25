
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  flattenTree,
  requestTree,
  topicBranches,
  type Topic,
} from '../data/topics'

import {
  PruneContext,
  type CompostItem,
  type PilePhase,
  type PruneState,
} from './prune-context'

import type { Branch } from '../types'

const FALL_MS = 1200
const POLL_MS = 10000
const DEMO_STORAGE_KEY = 'demo-pruned-branches'

type CutMap = Record<string, boolean>

function readDemoCuts(): CutMap {
  try {
    const stored = localStorage.getItem(DEMO_STORAGE_KEY)

    if (!stored) return {}

    const parsed: unknown = JSON.parse(stored)

    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] =>
          typeof entry[1] === 'boolean'
      )
    )
  } catch {
    return {}
  }
}

function saveDemoCut(id: string, value: boolean): void {
  const saved = readDemoCuts()

  saved[id] = value

  localStorage.setItem(
    DEMO_STORAGE_KEY,
    JSON.stringify(saved)
  )
}

function collectCuts(topics: Topic[]): CutMap {
  const cuts: CutMap = {}

  function visit(nodes: Topic[]) {
    nodes.forEach(topic => {
      cuts[topic.id] = !!topic.selected
      visit(topic.children ?? [])
    })
  }

  visit(topics)

  const demoCuts = readDemoCuts()

  for (const id of Object.keys(cuts)) {
    if (
      id.startsWith('demo:') &&
      Object.prototype.hasOwnProperty.call(demoCuts, id)
    ) {
      cuts[id] = demoCuts[id]
    }
  }

  return cuts
}

export function PruneProvider({
  children,
}: {
  children: ReactNode
}) {
  const [tree, setTree] = useState<Branch[]>([])
  const [selectedCuts, setSelectedCuts] = useState<CutMap>({})
  const [falling, setFalling] = useState<CutMap>({})
  const [cleared, setCleared] = useState<CutMap>({})
  const [selectedId, setSelected] = useState('')
  const [phase, setPhase] = useState<PilePhase>('idle')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [videoCount, setVideoCount] = useState(0)

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const fallTimers = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({})

  const writes = useRef<Promise<void>>(Promise.resolve())
  const pending = useRef(0)
  const revision = useRef(0)

  const latestChange = useRef<Record<string, number>>({})
  const confirmedCuts = useRef<CutMap>({})

  useEffect(() => {
    let active = true
    let loadingTree = false

    async function load() {
      if (loadingTree) return

      loadingTree = true
      const version = revision.current

      try {
        const result = await requestTree()

        if (
          !active ||
          pending.current > 0 ||
          version !== revision.current
        ) {
          return
        }

        const nextTree = topicBranches(
          result.tree,
          result.global_video_count
        )

        const nextCuts = collectCuts(result.tree)

        setTree(nextTree)
        setVideoCount(result.global_video_count)

        confirmedCuts.current = nextCuts
        setSelectedCuts(nextCuts)

        setError(null)
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load topics.'
          )
        }
      } finally {
        loadingTree = false

        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    const poll = setInterval(() => {
      void load()
    }, POLL_MS)

    return () => {
      active = false
      clearInterval(poll)

      timers.current.forEach(clearTimeout)

      Object.values(fallTimers.current).forEach(clearTimeout)
    }
  }, [])

  const branches = useMemo(
    () => flattenTree(tree),
    [tree]
  )

  const pruned = useMemo(() => {
    const result: CutMap = {}

    function visit(
      nodes: Branch[],
      inherited = false
    ) {
      nodes.forEach(node => {
        const isPruned =
          inherited || !!selectedCuts[node.id]

        result[node.id] = isPruned

        visit(
          node.children ?? [],
          isPruned
        )
      })
    }

    visit(tree)

    return result
  }, [tree, selectedCuts])

  const setPruned = useCallback(
    (id: string, value: boolean) => {
      const branchExists = branches.some(
        branch => branch.id === id
      )

      if (!branchExists) return

      // Avoid pruning a child that is already hidden
      // because its parent was pruned.
      const currentBranch = branches.find(
        branch => branch.id === id
      )

      if (
        value &&
        currentBranch?.parentId &&
        pruned[currentBranch.parentId]
      ) {
        return
      }

      revision.current++

      const version = revision.current

      latestChange.current[id] = version
      pending.current++

      // Update the UI immediately.
      setSelectedCuts(current => ({
        ...current,
        [id]: value,
      }))

      setCleared(current => ({
        ...current,
        [id]: false,
      }))

      // Cancel any previous falling animation.
      clearTimeout(fallTimers.current[id])

      if (value && !pruned[id]) {
        setFalling(current => ({
          ...current,
          [id]: true,
        }))

        const timer = setTimeout(() => {
          setFalling(current => ({
            ...current,
            [id]: false,
          }))

          delete fallTimers.current[id]
        }, FALL_MS)

        fallTimers.current[id] = timer
        timers.current.push(timer)
      } else {
        setFalling(current => ({
          ...current,
          [id]: false,
        }))
      }

      // Serialize changes so pruning and restoring
      // cannot reach storage in the wrong order.
      writes.current = writes.current.then(async () => {
        try {
          if (id.startsWith('demo:')) {
            // Synthetic branches are saved locally.
            saveDemoCut(id, value)
          } else {
            // Real branches use the backend.
            await requestTree({
              category_id: id,
              reduce: value,
            })
          }

          confirmedCuts.current[id] = value

          setError(null)
        } catch (cause) {
          // Roll back only if this was the latest
          // action for this branch.
          if (latestChange.current[id] === version) {
            setSelectedCuts(current => ({
              ...current,
              [id]: !!confirmedCuts.current[id],
            }))

            setFalling(current => ({
              ...current,
              [id]: false,
            }))
          }

          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not save pruning.'
          )
        } finally {
          pending.current--
        }
      })
    },
    [branches, pruned]
  )

  const compost = useMemo<CompostItem[]>(
    () =>
      branches
        .filter(
          branch =>
            selectedCuts[branch.id] &&
            !cleared[branch.id]
        )
        .map(branch => ({
          key: `B:${branch.id}`,
          kind: 'branch' as const,
          label: `Branch: ${branch.name}`,
          restore: () => setPruned(branch.id, false),
        })),
    [branches, selectedCuts, cleared, setPruned]
  )

  const burnPile = useCallback(() => {
    if (!compost.length || phase !== 'idle') {
      return
    }

    const ids = compost.map(item =>
      item.key.slice(2)
    )

    setPhase('burning')

    const burnTimer = setTimeout(() => {
      setCleared(current => ({
        ...current,
        ...Object.fromEntries(
          ids.map(id => [id, true])
        ),
      }))

      setPhase('ash')
    }, 1800)

    const resetTimer = setTimeout(() => {
      setPhase('idle')
    }, 3200)

    timers.current.push(
      burnTimer,
      resetTimer
    )
  }, [compost, phase])

  const pruneAll = useCallback(() => {
    // Prune each unpruned top-level branch.
    // Its children are automatically included.
    tree
      .filter(branch => !pruned[branch.id])
      .forEach(branch => {
        setPruned(branch.id, true)
      })
  }, [tree, pruned, setPruned])

  const value: PruneState = {
    tree,
    branches,
    falling,
    loading,
    error,
    videoCount,
    pruned,
    cuts: selectedCuts,
    selectedId,
    phase,
    compost,

    prunedCount: branches.filter(
      branch => pruned[branch.id]
    ).length,

    setSelected,
    setPruned,
    pruneAll,
    burnPile,
  }

  return (
    <PruneContext.Provider value={value}>
      {children}
    </PruneContext.Provider>
  )
}
