import { NavLink, Outlet } from 'react-router-dom'
import { Sprout } from 'lucide-react'

const links = [
  { to: '/', label: 'Garden', end: true },
  { to: '/calendar', label: 'Growth Journey', end: false },
  { to: '/how-we-measure', label: 'Insights', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

export function LeafMark({ size = 28 }: { size?: number }) {
  return (
    <Sprout
      size={size}
      strokeWidth={2}
      aria-hidden="true"
    />
  )
}

export default function Layout() {
  return (
    <div className="app botanical-app">
      <header className="botanical-header">
        <div className="botanical-header__inner">
          <NavLink to="/" className="botanical-brand" aria-label="Prune home">
            <LeafMark size={38} />
            <span>prune<span className="botanical-brand__period">.</span></span>
          </NavLink>

          <nav className="botanical-nav" aria-label="Main navigation">
            {links.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `botanical-nav__link${isActive ? ' botanical-nav__link--active' : ''}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main id="main-content" className="page botanical-page">
        <Outlet />
      </main>

      <footer className="botanical-footer">
        <span>Made for mindful scrolling.</span>
        <span>Grow at your own pace.</span>
      </footer>
    </div>
  )
}
