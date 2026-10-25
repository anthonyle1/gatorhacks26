/** Use the rendered tree size, not scroll extents expanded by animated branches. */
export function boundPan(left: number, top: number, viewportWidth: number, viewportHeight: number, treeWidth: number, treeHeight: number, groundTop?: number) {
  const bottomLimit = groundTop === undefined ? treeHeight - viewportHeight
    : Math.min(treeHeight - viewportHeight, groundTop - viewportHeight + Math.min(140, viewportHeight * .25))
  return {
    left: Math.max(0, Math.min(left, Math.max(0, treeWidth - viewportWidth))),
    top: Math.max(0, Math.min(top, Math.max(0, bottomLimit))),
  }
}

/** Fit is the zoom-out floor; allow at most three times that scale for detail. */
export function zoomRange(viewportWidth: number, viewportHeight: number, treeWidth: number, treeHeight: number) {
  if (Math.min(viewportWidth, viewportHeight, treeWidth, treeHeight) <= 0) return { min: 1, max: 3 }
  const min = Math.min(1, viewportWidth / treeWidth, viewportHeight / treeHeight)
  return { min, max: Math.min(3, min * 3) }
}
