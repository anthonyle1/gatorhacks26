import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { boundPan, zoomRange } from './camera'

export function useTreeCamera(viewportRef: RefObject<HTMLDivElement | null>, size: { width: number; height: number }) {
  const [zoom, setZoom] = useState(1)
  const currentZoom = useRef(1)
  const initialFit = useRef(false)
  const pendingPan = useRef<{ left: number; top: number } | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const limits = zoomRange(viewportSize.width, viewportSize.height, size.width, size.height)

  const panTo = useCallback((left: number, top: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const position = boundPan(left, top, viewport.clientWidth, viewport.clientHeight,
      size.width * currentZoom.current, size.height * currentZoom.current)
    if (Math.abs(viewport.scrollLeft - position.left) > 1) viewport.scrollLeft = position.left
    if (Math.abs(viewport.scrollTop - position.top) > 1) viewport.scrollTop = position.top
  }, [viewportRef, size.width, size.height])

  const changeZoom = useCallback((value: number, anchorX?: number, anchorY?: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const range = zoomRange(viewport.clientWidth, viewport.clientHeight, size.width, size.height)
    const previous = currentZoom.current
    const next = Math.max(range.min, Math.min(range.max, value))
    if (Math.abs(next - previous) < 1e-8) return
    const x = anchorX ?? viewport.clientWidth / 2, y = anchorY ?? viewport.clientHeight / 2
    pendingPan.current = { left: (viewport.scrollLeft + x) / previous * next - x,
      top: (viewport.scrollTop + y) / previous * next - y }
    currentZoom.current = next
    setZoom(next)
  }, [viewportRef, size.width, size.height])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => setViewportSize(previous => {
      const next = { width: viewport.clientWidth, height: viewport.clientHeight }
      return next.width === previous.width && next.height === previous.height ? previous : next
    }))
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewportRef])

  useLayoutEffect(() => {
    if (!size.width || !size.height || !viewportSize.width || !viewportSize.height) return
    if (!initialFit.current) {
      initialFit.current = true
      changeZoom(limits.min)
      pendingPan.current = { left: 0, top: 0 }
    } else changeZoom(currentZoom.current)
    panTo(viewportRef.current?.scrollLeft || 0, viewportRef.current?.scrollTop || 0)
  }, [size.width, size.height, viewportSize.width, viewportSize.height, limits.min, limits.max, changeZoom, panTo, viewportRef])

  useLayoutEffect(() => {
    if (!pendingPan.current) return
    panTo(pendingPan.current.left, pendingPan.current.top)
    pendingPan.current = null
  }, [zoom, panTo])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1)
      changeZoom(currentZoom.current * Math.exp(-delta * .002), event.clientX - rect.left, event.clientY - rect.top)
    }
    const scroll = () => panTo(viewport.scrollLeft, viewport.scrollTop)
    viewport.addEventListener('wheel', wheel, { passive: false })
    viewport.addEventListener('scroll', scroll, { passive: true })
    return () => { viewport.removeEventListener('wheel', wheel); viewport.removeEventListener('scroll', scroll) }
  }, [viewportRef, changeZoom, panTo])

  const fit = () => {
    changeZoom(limits.min)
    pendingPan.current = { left: 0, top: 0 }
    panTo(0, 0)
  }
  return { zoom, limits, panTo, fit, zoomIn: () => changeZoom(currentZoom.current * 1.2), zoomOut: () => changeZoom(currentZoom.current / 1.2) }
}
