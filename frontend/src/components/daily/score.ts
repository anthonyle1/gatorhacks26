/** Same warning-to-insight balance used by the extension's daily meter. */
export function dailyScore(warnings: number, positives: number) {
  const total = warnings + positives
  return total > 0 ? Math.round(warnings / total * 100) : null
}
