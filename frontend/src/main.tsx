// import { StrictMode } from 'react'
// import { createRoot } from 'react-dom/client'
// import { BrowserRouter } from 'react-router-dom'
// import App from './App'
// import './styles/tokens.css'
// import './styles/app.css'

// createRoot(document.getElementById('root')!).render(
//   <StrictMode>
//     <BrowserRouter>
//       <App />
//     </BrowserRouter>
//   </StrictMode>,
// )
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'

import './styles/tokens.css'
import './styles/app.css'
import './styles/botanical.css'

try {
  const stored = JSON.parse(
    localStorage.getItem('prune-appearance') || '{}'
  )

  const themes = ['forest', 'olive', 'rose', 'honey']

  if (themes.includes(stored.theme)) {
    document.documentElement.dataset.pruneTheme = stored.theme
  }

  document.documentElement.classList.toggle(
    'prune-reduce-motion',
    stored.reduceMotion === true
  )

  document.documentElement.classList.toggle(
    'prune-larger-text',
    stored.largerText === true
  )
} catch {
  // Use default appearance if preferences are unavailable.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
