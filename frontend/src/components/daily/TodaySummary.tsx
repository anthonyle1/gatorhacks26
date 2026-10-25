import { useEffect, useState } from 'react'
import { fetchDay } from '../../data/dailyInsights'
import type { DailySummary } from '../../data/dailyInsights'
import DailySummaryView from './DailySummaryView'

export default function TodaySummary() {
  const [data, setData] = useState<DailySummary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false, loading = false
    async function refresh() {
      if (loading) return
      loading = true
      const now = new Date()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      try { const result = await fetchDay(date); if (!disposed) { setData(result); setError('') } }
      catch { if (!disposed) setError('Daily summary is currently unavailable.') }
      finally { loading = false }
    }
    const refreshOnFocus = () => { void refresh() }
    void refresh()
    const timer = window.setInterval(refreshOnFocus, 15000)
    window.addEventListener('focus', refreshOnFocus)
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', refreshOnFocus) }
  }, [])
  return <section className="card card--lg daily-today-summary" aria-label="Today's daily summary">
    <h2>Today’s summary</h2>
    {error && <p role="status">{error}</p>}
    {!data && !error && <p role="status">Loading today’s activity…</p>}
    {data && <DailySummaryView key={data.date} data={data} />}
  </section>
}
