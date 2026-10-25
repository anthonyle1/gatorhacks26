import { TopicGarden } from './TopicGarden'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import DailySummaryView from '../../../frontend/src/components/daily/DailySummaryView'
import type { DailySummary } from '../../../frontend/src/data/dailyInsights'

declare global {
  interface Window {
    TopicGarden: typeof TopicGarden
    renderDailySummary: (container: HTMLElement, data: DailySummary) => void
    clearDailySummary: (container: HTMLElement) => void
  }
}
const dailyRoots = new WeakMap<HTMLElement, Root>()
window.clearDailySummary = container => {
  dailyRoots.get(container)?.unmount()
  dailyRoots.delete(container)
}
window.renderDailySummary = (container, data) => {
  window.clearDailySummary(container)
  const root = createRoot(container)
  dailyRoots.set(container, root)
  root.render(<>
    <h3>Daily summary ? {data.date}</h3>
    <DailySummaryView key={data.date} data={data} />
    <a href={`http://localhost:5173/calendar?date=${encodeURIComponent(data.date)}`} target="_blank" rel="noopener noreferrer">View full day ?</a>
  </>)
}
window.TopicGarden = TopicGarden
// Session/audio controls remain the extension's existing script; start them after
// the React topic garden is available, including in the packaged extension.
const script = document.createElement('script')
script.src = new URL('sidepanel.js', document.baseURI).href
document.body.append(script)
