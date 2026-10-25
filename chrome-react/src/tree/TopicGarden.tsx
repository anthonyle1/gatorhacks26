import { createRoot, type Root } from 'react-dom/client'
import { TopicTree } from './TopicTree'
import { flatten, type TreeData } from './types'
import { boundPan, zoomRange } from './camera'

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
  private pictureSize: { width: number; height: number; groundTop: number } | null = null
  private renderedZoomRange = { min: 1, max: 3 }

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
    viewport.addEventListener('scroll', () => this.keepInBounds(), { passive: true })
    new ResizeObserver(() => this.constrainView()).observe(viewport)
    this.render()
  }

  private fit() {
    if (!this.pictureSize) return
    this.setZoom(this.zoomLimits().min)
    requestAnimationFrame(() => this.panTo(0, 0))
  }

  private setZoom(value: number, anchorX?: number, anchorY?: number) {
    const viewport = document.getElementById('tree')!
    const previous = this.zoom
    const limits = this.zoomLimits()
    this.zoom = Math.max(limits.min, Math.min(limits.max, value))
    if (Math.abs(this.zoom - previous) < 1e-8) return
    const x = anchorX ?? viewport.clientWidth / 2, y = anchorY ?? viewport.clientHeight / 2
    const left = (viewport.scrollLeft + x) / previous * this.zoom - x
    const top = (viewport.scrollTop + y) / previous * this.zoom - y
    this.render()
    requestAnimationFrame(() => this.panTo(left, top))
  }

  private zoomLimits() {
    if (!this.pictureSize) return { min: 1, max: 3 }
    const viewport = document.getElementById('tree')!
    return zoomRange(viewport.clientWidth, viewport.clientHeight, this.pictureSize.width, this.pictureSize.height)
  }

  private constrainView() {
    if (!this.pictureSize) return
    const limits = this.zoomLimits()
    const bounded = Math.max(limits.min, Math.min(limits.max, this.zoom))
    if (Math.abs(bounded - this.zoom) > 1e-8) this.setZoom(bounded)
    else if (limits.min !== this.renderedZoomRange.min || limits.max !== this.renderedZoomRange.max) this.render()
    this.keepInBounds()
  }

  private panTo = (left: number, top: number, behavior: ScrollBehavior = 'instant') => {
    if (!this.pictureSize) return
    const viewport = document.getElementById('tree')!
    const position = boundPan(left, top, viewport.clientWidth, viewport.clientHeight,
      this.pictureSize.width * this.zoom, this.pictureSize.height * this.zoom, this.pictureSize.groundTop * this.zoom)
    viewport.scrollTo({ ...position, behavior })
  }

  private keepInBounds() {
    if (!this.pictureSize) return
    const viewport = document.getElementById('tree')!
    const position = boundPan(viewport.scrollLeft, viewport.scrollTop, viewport.clientWidth, viewport.clientHeight,
      this.pictureSize.width * this.zoom, this.pictureSize.height * this.zoom, this.pictureSize.groundTop * this.zoom)
    if (Math.abs(viewport.scrollLeft - position.left) > 1 || Math.abs(viewport.scrollTop - position.top) > 1) this.panTo(position.left, position.top)
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

  private onSize = (width: number, height: number, groundTop: number) => {
    this.pictureSize = { width, height, groundTop }
    requestAnimationFrame(() => this.constrainView())
    if (!this.initialFit) { this.initialFit = true; requestAnimationFrame(() => this.fit()) }
  }

  private focusTopic = (x: number, y: number, width: number, height: number) => {
    const viewport = document.getElementById('tree')!
    const limits = this.zoomLimits()
    this.zoom = Math.max(limits.min, Math.min(limits.max, Math.max(this.zoom,
      Math.min(2.4, viewport.clientWidth * .68 / width, viewport.clientHeight * .55 / height))))
    this.render()
    requestAnimationFrame(() => this.panTo(x * this.zoom - viewport.clientWidth / 2,
      y * this.zoom - viewport.clientHeight * .43,
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'))
  }

  private render() {
    const error = document.getElementById('topic-tree-status')!
    error.textContent = this.error
    error.hidden = !this.error
    const health = document.getElementById('tree-health')!
    health.className = 'chip chip--sm chip--unrated'
    health.textContent = this.loading ? 'Loading…' : `${flatten(this.data.tree).filter(topic => !topic.reduce).length} topics`
    document.getElementById('tree-zoom-level')!.textContent = `${Math.round(this.zoom * 100)}%`
    const limits = this.zoomLimits()
    this.renderedZoomRange = limits
    ;(document.getElementById('tree-zoom-out') as HTMLButtonElement).disabled = this.zoom <= limits.min + 1e-8
    ;(document.getElementById('tree-zoom-in') as HTMLButtonElement).disabled = this.zoom >= limits.max - 1e-8
    this.root.render(<TopicTree data={this.data} falling={new Set(this.falling)} busy={this.busy} zoom={this.zoom}
      loading={this.loading} onPrune={(id, value) => { void this.prune(id, value) }} onSize={this.onSize} onFocusTopic={this.focusTopic} onPan={this.panTo} />)
  }
}
