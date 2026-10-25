import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Calendar from './pages/Calendar'
import Garden from './pages/Garden'
import HowWeMeasure from './pages/HowWeMeasure'
import Settings from './pages/Settings'
import { PruneProvider } from './state/PruneProvider'

export default function App() {
  return (
    <PruneProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Garden />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/how-we-measure" element={<HowWeMeasure />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Garden />} />
        </Route>
      </Routes>
    </PruneProvider>
  )
}
