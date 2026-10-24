import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/', label: 'Garden', end: true },
  { to: '/calendar', label: 'Calendar', end: false },
  { to: '/how-we-measure', label: 'How we measure', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#2E6B45" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21v-7" />
      <path d="M12 14c-4 0-7-3-7-8 5 0 7 3 7 8z" />
      <path d="M12 14c0-4 2.5-7 7-7 0 4.5-3 7-7 7z" />
    </svg>
  )
}

export default function Layout() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="brand">
            <Logo />
            <span className="brand__name">Prune</span>
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
