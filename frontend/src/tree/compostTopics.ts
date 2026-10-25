import type { Branch } from '../types'

export interface CompostTopic {
  id: string
  name: string
  coverage: { id: string; name: string }[]
  children: CompostTopic[]
}

// Keep parent context and covered descendants, even when only a child was pruned.
export function compostTopics(tree: Branch[], selected: Set<string>): CompostTopic[] {
  function visit(nodes: Branch[], ancestors: CompostTopic['coverage'] = []): CompostTopic[] {
    return nodes.flatMap(node => {
      const coverage = selected.has(node.id) ? [...ancestors, { id: node.id, name: node.name }] : ancestors
      const children = visit(node.children ?? [], coverage)
      return coverage.length || children.length ? [{ id: node.id, name: node.name, coverage, children }] : []
    }).sort((a, b) => a.name.localeCompare(b.name))
  }
  return visit(tree)
}
