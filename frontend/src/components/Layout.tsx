import { NavLink, Outlet } from 'react-router-dom'

type IconName = 'garden' | 'calendar' | 'insights' | 'settings'

const NAV: {to: string, label: string, icon: IconName, end: boolean}[] = [
  { to: '/', label: 'Garden', icon: 'garden', end: true },
  { to: '/calendar', label: 'Calendar', icon: 'calendar', end: false },
  { to: '/how-we-measure', label: 'Our approach', icon: 'insights', end: false},
  { to: '/settings', label: 'Settings', icon: 'settings', end: false },
]

function NavIcon({ name }: { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }

  switch (name) {
    case 'garden':
      return (
        <svg {...common}>
          <path d="M12 21v-9" />
          <path d="M12 15C6 15 4 11 4 5c6 0 8 4 8 10Z" />
          <path d="M12 12c0-5 3-8 8-8 0 5-3 8-8 8Z" />
        </svg>
      )

    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M7 3v4M17 3v4M3 10h18" />
          <path d="M8 14h3M8 17h3M15 14h2" />
        </svg>
      )

    case 'insights':
      return (
        <svg {...common}>
          <path d="M4 19V5M4 19h16" />
          <path d="m7 15 4-5 3 2 5-7" />
          <path d="M16 5h3v3" />
        </svg>
      )

    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )
  }
}

function Logo() {
  return (
    <svg
      className="prune-logo__icon"
      width="38"
      height="38"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="13" fill="#315B43" />
      <path
        d="M20 32V19"
        stroke="#F8F5EA"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M20 24C12 24 9 19 9 12c7 0 11 4 11 12Z"
        fill="#A9D9A8"
      />
      <path
        d="M20 19c0-8 5-12 12-12 0 7-4 12-12 12Z"
        fill="#DDECB6"
      />
    </svg>
  )
}

export default function Layout() {
  return (
    <div className="app prune-app">
      <header className="prune-header">
        <div className="prune-header__inner">
          <NavLink
            to="/"
            className="prune-logo"
            aria-label="Prune home"
          >
            <Logo />
            <span className="prune-logo__text">
              prune<span className="prune-logo__dot">.</span>
            </span>
          </NavLink>

          <nav className="prune-nav" aria-label="Main navigation">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `prune-nav__link${isActive ? ' prune-nav__link--active' : ''}`
                }
                aria-label={item.label}
              >
                <NavIcon name={item.icon} />
                <span className="prune-nav__label">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="prune-header__tag">
            <span className="prune-header__tag-dot" />
            Grow mindfully
          </div>
        </div>
      </header>

      <main className="page prune-page" id="main-content">
        <Outlet />
      </main>

      <footer className="prune-footer">
        <span>Made for a healthier relationship with scrolling.</span>
        <span>Grow at your own pace.</span>
      </footer>
    </div>
  )
}
