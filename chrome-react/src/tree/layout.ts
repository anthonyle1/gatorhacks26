import type { Topic } from './types'

export interface Point { x: number; y: number }
export interface Limb {
  topic: Topic
  parentId: string | null
  depth: number
  start: Point
  end: Point
  control1: Point
  control2: Point
  path: string
  thickness: number
  width: number
  height: number
  fontSize: number
  lines: string[]
  children: Limb[]
}
export interface TreeLayout {
  roots: Limb[]
  limbs: Limb[]
  trunk: string
  ground: { left: number; right: number; heightScale: number }
  bounds: { x: number; y: number; width: number; height: number }
}

export function seeded(id: string, salt: string): number {
  let hash = 2166136261
  for (const character of `${id}:${salt}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0) / 4294967295
}
const point = (p: Point) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`
const along = (start: Point, angle: number, length: number): Point => ({ x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length })
const curve = (start: Point, c1: Point, c2: Point, end: Point) => `M${point(start)} C${point(c1)} ${point(c2)} ${point(end)}`

export function bushPath(width: number, height: number): string {
  const p = (x: number, y: number) => `${x * width / 2} ${y * height / 2}`
  return `M${p(-.84, .46)} C${p(-1.08, .4)} ${p(-1.08, -.12)} ${p(-.86, -.28)}
    C${p(-.96, -.65)} ${p(-.65, -.94)} ${p(-.38, -.74)}
    C${p(-.24, -1.1)} ${p(.23, -1.1)} ${p(.38, -.76)}
    C${p(.68, -.96)} ${p(.97, -.64)} ${p(.85, -.35)}
    C${p(1.12, -.16)} ${p(1.08, .34)} ${p(.83, .44)}
    C${p(.89, .79)} ${p(.51, 1)} ${p(.25, .8)}
    C${p(.03, 1.06)} ${p(-.33, 1)} ${p(-.45, .8)}
    C${p(-.73, .96)} ${p(-1, .76)} ${p(-.84, .46)} Z`
}

/** Allocate angular growth sectors by subtree weight, then grow connected limbs.
 * Collision correction changes branch lengths, never detaches foliage from its branch.
 */
export function growTree(topics: Topic[], measure: (text: string, fontSize: number) => number): TreeLayout {
  const weights = new Map<string, number>()
  const sizes = new Map<string, { width: number; height: number; fontSize: number; lines: string[] }>()
  function prepare(topic: Topic, depth: number): number {
    const childWeight = topic.children.reduce((sum, child) => sum + prepare(child, depth + 1), 0)
    const weight = Math.max(1, childWeight) + Math.min(2, Math.sqrt(topic.video_count || 0) * .12)
    weights.set(topic.id, weight)
    const fontSize = Math.max(10, 14 - depth * 1.2)
    const lines: string[] = []
    let line = ''
    for (const character of topic.name) {
      if (line && measure(line + character, fontSize) > 140) {
        const space = line.lastIndexOf(' ')
        if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(space + 1) }
        else { lines.push(line); line = '' }
      }
      line += character
    }
    if (line) lines.push(line.trim())
    const children = topic.children.map(child => sizes.get(child.id)!)
    const width = Math.max(108, (Math.max(measure(`${topic.video_count} videos`, fontSize), ...lines.map(text => measure(text, fontSize))) + 28) * 1.3,
      ...children.map(child => child.width * 1.06))
    const height = Math.max(((lines.length + 1) * fontSize * 1.3 + 14) * 1.4, ...children.map(child => child.height * 1.06))
    sizes.set(topic.id, { width, height, fontSize, lines })
    return weight
  }
  topics.forEach(topic => prepare(topic, 0))
  const limbs: Limb[] = []
  const trunkHeight = 130 + Math.min(65, Math.sqrt([...weights.values()].reduce((sum, value) => sum + value, 0)) * 10)
  const trunkEnd = { x: 8, y: -trunkHeight }
  const trunk = `M-17 12 C-8 -32 -13 ${-trunkHeight * .62} 3 ${-trunkHeight} L13 ${-trunkHeight} C5 ${-trunkHeight * .6} 14 -30 23 12 Z`
  const trunkPoint = (t: number): Point => ({ x: 8 * t + Math.sin(t * Math.PI) * -5, y: -trunkHeight * t })
  function grow(topic: Topic, start: Point, low: number, high: number, parentAngle: number, depth: number, parentId: string | null, parentThickness: number): Limb {
    const size = sizes.get(topic.id)!
    const center = (low + high) / 2
    const angle = center + (seeded(topic.id, 'angle') - .5) * Math.min(.18, (high - low) * .25)
    const baseLength = (depth ? 28 : 65) + size.height * .45 + size.width * .16 + Math.sqrt(weights.get(topic.id)!) * 8
    let length = baseLength * (.95 + seeded(topic.id, 'length') * .15)
    let end = along(start, angle, length)
    const overlaps = (p: Point) => limbs.some(other =>
      Math.abs(p.x - other.end.x) < (size.width + other.width) * .51 + 5 &&
      Math.abs(p.y - other.end.y) < (size.height + other.height) * .51 + 5)
    // Sectors preserve sibling order; extend the actual branch to resolve crowded foliage.
    for (let attempt = 0; overlaps(end) && attempt < 120; attempt++) {
      length += 8
      end = along(start, angle, length)
    }
    const control1 = along(start, parentId ? parentAngle : -Math.PI / 2, length * .34)
    const control2 = along(end, angle + Math.PI, length * .32)
    const thickness = Math.max(1.8, Math.min(parentThickness * .72, 4 + Math.sqrt(topic.video_count || weights.get(topic.id)!) * 1.6))
    const limb: Limb = { topic, parentId, depth, start, end, control1, control2, path: curve(start, control1, control2, end), thickness, ...size, children: [] }
    limbs.push(limb)
    const total = topic.children.reduce((sum, child) => sum + weights.get(child.id)!, 0)
    let cursor = low
    topic.children.forEach(child => {
      const sector = (high - low) * weights.get(child.id)! / total
      limb.children.push(grow(child, end, cursor, cursor + sector, angle, depth + 1, topic.id, thickness))
      cursor += sector
    })
    return limb
  }
  const total = topics.reduce((sum, topic) => sum + weights.get(topic.id)!, 0)
  let cursor = -Math.PI * .82
  const roots = topics.map(topic => {
    const sector = Math.PI * .64 * weights.get(topic.id)! / total
    const center = cursor + sector / 2
    const attachment = .48 + .5 * (1 - Math.abs(center + Math.PI / 2) / (Math.PI / 2))
    const root = grow(topic, trunkPoint(attachment), cursor, cursor + sector, -Math.PI / 2, 0, null, 23)
    cursor += sector
    return root
  })
  const groundLeft = Math.min(-155, ...limbs.map(limb => limb.end.x - limb.width * .65)) - 12
  const groundRight = Math.max(155, ...limbs.map(limb => limb.end.x + limb.width * .65)) + 12
  const heightScale = Math.max(1, Math.min(2, (groundRight - groundLeft) / 460))
  const minX = groundLeft - 25
  const maxX = groundRight + 25
  const minY = Math.min(trunkEnd.y - 20, ...limbs.map(limb => limb.end.y - limb.height * .65)) - 25
  return { roots, limbs, trunk, ground: { left: groundLeft, right: groundRight, heightScale },
    bounds: { x: minX, y: minY, width: maxX - minX, height: 90 * heightScale - minY } }
}
