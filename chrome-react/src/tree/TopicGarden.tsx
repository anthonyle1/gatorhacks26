import { createRoot, type Root } from 'react-dom/client'
import { TopicTree } from './TopicTree'
import { flatten, type TreeData } from './types'

/** Owns API/cache/pruning state. Geometry and exploration remain in the React view. */
export class TopicGarden {
  private data: TreeData = { tree: [], global_video_count: 0 }
  private falling = new Set<string>()
  private loading = true
  private busy = false
  private refreshing = false
  private version = 0
  private error = ''
  private zoom = 1
  private root: Root
  private apiBase: string
  private initialFit = false
  private pictureSize: { width: number; height: number } | null = null

  constructor(apiBase: string) {
    this.apiBase = apiBase
    const viewport = document.getElementById('tree')!
    this.root = createRoot(viewport)
    document.getElementById('tree-zoom-in')!.addEventListener('click', () => this.setZoom(this.zoom * 1.2))
    document.getElementById('tree-zoom-out')!.addEventListener('click', () => this.setZoom(this.zoom / 1.2))
    document.getElementById('tree-zoom-reset')!.addEventListener('click', () => this.fit())
    viewport.addEventListener('wheel', event => {
      event.preventDefault()
      const bounds = viewport.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1)
      this.setZoom(this.zoom * Math.exp(-delta * .002), event.clientX - bounds.left, event.clientY - bounds.top)
    }, { passive: false })
    this.render()
  }

  private fit() {
    if (!this.pictureSize) return
    const viewport = document.getElementById('tree')!
    this.setZoom(Math.min(1, viewport.clientWidth / this.pictureSize.width, viewport.clientHeight / this.pictureSize.height))
    requestAnimationFrame(() => { viewport.scrollLeft = 0; viewport.scrollTop = 0 })
  }

  private setZoom(value: number, anchorX?: number, anchorY?: number) {
    const viewport = document.getElementById('tree')!
    const previous = this.zoom
    this.zoom = Math.max(.15, Math.min(3, value))
    const x = anchorX ?? viewport.clientWidth / 2, y = anchorY ?? viewport.clientHeight / 2
    const left = (viewport.scrollLeft + x) / previous * this.zoom - x
    const top = (viewport.scrollTop + y) / previous * this.zoom - y
    this.render()
    requestAnimationFrame(() => { viewport.scrollLeft = left; viewport.scrollTop = top })
  }

  private async request(body?: { category_id: string; reduce: boolean }): Promise<TreeData> {
    const response = await fetch(`${this.apiBase}/local-sessions/taxonomy${body ? '/preferences' : ''}`, {
      method: body ? 'PATCH' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Topic tree request failed (${response.status}).`)
    return response.json()
  }

  private async cache() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ pruneTopicTree: { tree: this.data.tree, global_video_count: this.data.global_video_count,
        tree_videos: this.data.tree_videos?.map(video => ({ video_id: video.video_id, title: video.title, platform: video.platform })) } }).catch(() => {})
    }
  }

  async start(cached?: TreeData) {
    if (Array.isArray(cached?.tree)) { this.data = cached; this.loading = false; this.render() }
    await this.refresh()
  }

  async refresh() {
    if (this.busy || this.refreshing || this.falling.size) return
    this.refreshing = true
    const version = this.version
    try {
      const result = await this.request()
      if (version !== this.version) return
      const changed = JSON.stringify(result.tree) !== JSON.stringify(this.data.tree) || this.loading || this.error
      this.data = result
      this.loading = false
      this.error = ''
      if (changed) this.render()
      await this.cache()
    } catch {
      if (version !== this.version) return
      this.loading = false
      this.error = this.data.tree.length ? 'Showing saved topics. Start the backend to refresh or save cuts.' : 'Could not load topics. Start the backend and finish a scrolling session.'
      this.render()
    } finally { this.refreshing = false }
  }

  private prune = async (id: string, value: boolean) => {
    if (this.busy) return
    const previous = structuredClone(this.data)
    const next = structuredClone(this.data)
    const node = flatten(next.tree).find(topic => topic.id === id)
    if (!node || node.inherited) return
    const version = ++this.version
    node.selected = value
    function inherit(nodes: TreeData['tree'], cut = false) {
      nodes.forEach(topic => { topic.inherited = cut; topic.reduce = cut || topic.selected; inherit(topic.children, topic.reduce) })
    }
    inherit(next.tree)
    this.data = next
    if (value) this.falling.add(id); else this.falling.delete(id)
    this.busy = true
    this.error = ''
    this.render()
    if (value) setTimeout(() => { this.falling.delete(id); this.render() }, 1200)
    try {
      const result = await this.request({ category_id: id, reduce: value })
      if (version !== this.version) return
      this.data = result
      await this.cache()
    } catch (error) {
      if (version !== this.version) return
      this.data = previous
      this.falling.delete(id)
      this.error = `${error instanceof Error ? error.message : 'Request failed.'} Your cut was not saved.`
    } finally { this.busy = false; this.render() }
  }

  clear() {
    this.version++
    this.data = { tree: [], global_video_count: 0 }
    this.falling.clear()
    this.loading = false
    this.error = ''
    this.render()
    void this.cache()
  }

  private onSize = (width: number, height: number) => {
    this.pictureSize = { width, height }
    if (!this.initialFit) { this.initialFit = true; requestAnimationFrame(() => this.fit()) }
  }

  private render() {
    const error = document.getElementById('topic-tree-status')!
    error.textContent = this.error
    error.hidden = !this.error
    const health = document.getElementById('tree-health')!
    health.className = 'chip chip--sm chip--unrated'
    health.textContent = this.loading ? 'Loading…' : `${flatten(this.data.tree).filter(topic => !topic.reduce).length} topics`
    document.getElementById('tree-zoom-level')!.textContent = `${Math.round(this.zoom * 100)}%`
    ;(document.getElementById('tree-zoom-out') as HTMLButtonElement).disabled = this.zoom <= .15
    ;(document.getElementById('tree-zoom-in') as HTMLButtonElement).disabled = this.zoom >= 3
    this.root.render(<TopicTree data={this.data} falling={new Set(this.falling)} busy={this.busy} zoom={this.zoom}
      loading={this.loading} onPrune={(id, value) => { void this.prune(id, value) }} onSize={this.onSize} />)
  }
}
