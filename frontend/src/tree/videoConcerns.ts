type Assessment = {
  negative_for_user?: string
  content_signals?: { id: string }[]
  signal_polarities?: Record<string, string>
}

type ContentSignal = { id: string; evidence?: string }

export function contentSentiment(assessment?: { content_signals?: ContentSignal[]; signal_polarities?: Record<string, string> } | null) {
  const groups: Record<'positive' | 'neutral' | 'negative' | 'unclassified', ContentSignal[]> = {
    positive: [], neutral: [], negative: [], unclassified: [],
  }
  for (const signal of assessment?.content_signals ?? []) {
    const polarity = assessment?.signal_polarities?.[signal.id]
    const group = polarity === 'positive' || polarity === 'neutral' || polarity === 'negative' ? polarity : 'unclassified'
    groups[group].push(signal)
  }
  return groups
}

export function hasNegativeConcerns(assessment?: Assessment | null): boolean {
  return assessment?.negative_for_user === 'yes' || !!assessment?.content_signals?.some(
    signal => assessment.signal_polarities?.[signal.id] === 'negative'
  )
}
