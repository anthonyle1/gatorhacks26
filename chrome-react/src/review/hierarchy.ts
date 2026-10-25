import type { Topic } from './types'

export function flatten(nodes: Topic[]): Topic[] { return nodes.flatMap(node => [node, ...flatten(node.children)]) }
