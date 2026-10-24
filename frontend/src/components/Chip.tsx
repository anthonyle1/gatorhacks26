import type { DisplayLevel } from '../types'

export const LEVEL_LABEL: Record<DisplayLevel, string> = {
  heavy: 'Heavy hostility',
  some: 'Some hostility',
  calm: 'Healthy',
  cut: 'Pruned',
  not_rated: 'Not rated yet',
}

interface ChipProps {
  level: DisplayLevel
  /** Override the default label (e.g. "Snipped"). */
  label?: string
  size?: 'sm' | 'md'
}

export default function Chip({ level, label, size = 'sm' }: ChipProps) {
  return <span className={`chip chip--${level} chip--${size}`}>{label ?? LEVEL_LABEL[level]}</span>
}
