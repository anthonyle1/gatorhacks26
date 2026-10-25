import { useEffect, useState } from 'react'
import DailySummaryView from '../../../frontend/src/components/daily/DailySummaryView'
import type { DailySummary } from '../../../frontend/src/data/dailyInsights'

export default function DailyPopupSummary() {
  const [data, setData] = useState<DailySummary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false, loading = false
    const abort = new AbortController()
    async function refresh() {
      if (loading) return
      loading = true
      const now = new Date()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const params = new URLSearchParams({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      try {
        const response = await fetch(`http://localhost:8000/local-sessions/daily/${date}?${params}`, { cache: 'no-store', signal: abort.signal })
        if (!response.ok) throw new Error('Daily summary unavailable')
        const result = await response.json() as DailySummary
        if (!disposed) { setData(result); setError('') }
      } catch { if (!disposed) setError('Daily summary is currently unavailable.') }
      finally { loading = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 15000)
    return () => { disposed = true; abort.abort(); clearInterval(timer) }
  }, [])
  return <section className="stat-card"><h2>Today’s summary</h2>
    {error && <p role="status">{error}</p>}
    {!data && !error && <p role="status">Loading daily activity…</p>}
    {data && <DailySummaryView key={data.date} data={data} />}
  </section>
}
