export type AssessmentStatus =
  | 'yes'
  | 'no'
  | 'uncertain'
  | 'unavailable'

export interface DailyVideo {
  event_id: string
  session_id: string
  warning_count: number | null
  positive_insight_count: number | null
  comment_counts: { positive: number; neutral: number; negative: number } | null
  analysis_status: string
  date: string
  video_id: string
  platform: string
  title: string
  watched_at: string
  dwell_seconds: number
  category_id: string | null
  category_name: string
  assessment: {
    negative_for_user: AssessmentStatus
    reason: string
    context_summary: string
    content_signals: {
      id: string
      evidence: string
    }[]
    signal_polarities: Record<string, string>
  } | null
}

export interface DailyCategory {
  id: string
  name: string
  video_count: number
  percentage: number
  negative_count: number
}

export interface DailySummary {
  date: string
  timezone: string
  summary: {
    videos_watched: number
    watch_seconds: number
    assessed_videos: number
    negative_count: number
    warning_count: number
    positive_insight_count: number
    comment_counts: { positive: number; neutral: number; negative: number }
    uncertain_count: number
    not_assessed_count: number
    warning_rate: number | null
  }
  top_categories: DailyCategory[]
  videos: DailyVideo[]
}

export interface MonthlySummary {
  month: string
  timezone: string
  days: {
    date: string
    videos_watched: number
    negative_count: number
    warning_count: number
    positive_insight_count: number
    uncertain_count: number
    not_assessed_count: number
  }[]
}

function timezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export async function fetchMonth(
  month: string
): Promise<MonthlySummary> {
  const params = new URLSearchParams({
    month,
    timezone: timezone(),
  })

  const response = await fetch(
    `/api/local-sessions/daily?${params}`
  )

  if (!response.ok) {
    throw new Error('Could not load calendar activity')
  }

  return response.json()
}

export async function fetchDay(
  date: string
): Promise<DailySummary> {
  const params = new URLSearchParams({
    timezone: timezone(),
  })

  const response = await fetch(
    `/api/local-sessions/daily/${date}?${params}`
  )

  if (!response.ok) {
    throw new Error('Could not load daily activity')
  }

  return response.json()
}
