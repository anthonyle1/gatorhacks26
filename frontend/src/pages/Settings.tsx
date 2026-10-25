import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

type ThemeName = 'forest' | 'olive' | 'rose' | 'honey'

type Appearance = {
  reduceMotion: boolean
  largerText: boolean
  theme: ThemeName
}

const STORAGE_KEY = 'prune-appearance'
const DEMO_KEY = 'prune-demo-enabled'

const defaults: Appearance = {
  reduceMotion: false,
  largerText: false,
  theme: 'forest',
}

const themes: {
  id: ThemeName
  label: string
  color: string
}[] = [
  { id: 'forest', label: 'Forest & sage', color: '#315B43' },
  { id: 'olive', label: 'Olive grove', color: '#798044' },
  { id: 'rose', label: 'Dusty rose', color: '#A36F70' },
  { id: 'honey', label: 'Honey gold', color: '#93712F' },
]

function readAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaults

    const parsed: Partial<Appearance> = JSON.parse(saved)

    return {
      reduceMotion: parsed.reduceMotion === true,
      largerText: parsed.largerText === true,
      theme: themes.some(t => t.id === parsed.theme)
        ? parsed.theme!
        : 'forest',
    }
  } catch {
    return defaults
  }
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="botanical-setting-row">
      <div>
        <h3>{label}</h3>
        <p>{description}</p>
      </div>

      <button
        type="button"
        className={
          `botanical-toggle${checked ? ' botanical-toggle--on' : ''}`
        }
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <span className="botanical-toggle__thumb" />
      </button>
    </div>
  )
}

export default function Settings() {
  const [appearance, setAppearance] = useState(readAppearance)

  const [demoEnabled, setDemoEnabled] = useState(
    () => localStorage.getItem(DEMO_KEY) === 'true'
  )

  const [demoBusy, setDemoBusy] = useState(false)
  const [demoError, setDemoError] = useState('')

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(appearance)
    )

    document.documentElement.dataset.pruneTheme =
      appearance.theme

    document.documentElement.classList.toggle(
      'prune-reduce-motion',
      appearance.reduceMotion
    )

    document.documentElement.classList.toggle(
      'prune-larger-text',
      appearance.largerText
    )
  }, [appearance])

  const update = (changes: Partial<Appearance>) => {
    setAppearance(current => ({
      ...current,
      ...changes,
    }))
  }

  async function toggleDemo() {
    if (demoBusy) return

    setDemoError('')

    if (demoEnabled) {
      localStorage.setItem(DEMO_KEY, 'false')
      setDemoEnabled(false)
      window.location.reload()
      return
    }

    setDemoBusy(true)

    try {
      const response = await fetch(
        '/api/demo/taxonomy',
        { cache: 'no-store' }
      )

      if (!response.ok) {
        throw new Error(
          'Sample data is unavailable. Run the demo data loader.'
        )
      }

      const data = await response.json()

      if (!Array.isArray(data.tree) || data.tree.length === 0) {
        throw new Error(
          'The sample database contains no topics.'
        )
      }

      localStorage.setItem(DEMO_KEY, 'true')
      setDemoEnabled(true)
      window.location.reload()
    } catch (error) {
      setDemoError(
        error instanceof Error
          ? error.message
          : 'Could not enable sample data.'
      )
    } finally {
      setDemoBusy(false)
    }
  }

  return (
    <div className="botanical-settings">
      <div className="botanical-page-heading">
        <div className="botanical-eyebrow">✧ SETTINGS</div>

        <h1>
          Tend your <em>garden.</em>
        </h1>

        <p>
          Make this space feel like your own. Appearance settings
          are saved on this browser.
        </p>
      </div>

      <section className="botanical-panel">
        <span
          className="botanical-panel__decoration"
          aria-hidden="true"
        >
          ❧
        </span>

        <h2>See less topics</h2>

        <p>
          Topics you've chosen to reduce belong in your garden
          preferences. These choices don't directly change what
          YouTube or Instagram recommends.
        </p>

        <Link to="/" className="botanical-inline-link">
          Visit your Garden to manage topics →
        </Link>
      </section>

      <section className="botanical-panel">
        <span
          className="botanical-panel__decoration"
          aria-hidden="true"
        >
          ❧
        </span>

        <h2>Sample garden</h2>

        <p>
          Explore Prune with simulated scrolling sessions,
          historical activity, topics, and precomputed AI
          assessments.
        </p>

        <p>
          Sample data is clearly separated from your actual
          scrolling history. Removing it from view will not
          delete your real activity.
        </p>

        <div
          className="botanical-setting-row"
          style={{ gap: '16px', flexWrap: 'wrap' }}
        >
          <div>
            <h3>
              {demoEnabled
                ? 'Sample data is enabled'
                : 'Sample data is disabled'}
            </h3>

            <p>
              {demoEnabled
                ? 'Your Garden and Growth Journey are showing example activity.'
                : 'Your Garden and Growth Journey are showing real activity.'}
            </p>
          </div>

          <button
            type="button"
            className="botanical-primary-btn"
            onClick={() => void toggleDemo()}
            disabled={demoBusy}
            aria-busy={demoBusy}
          >
            {demoBusy
              ? 'Loading sample data…'
              : demoEnabled
                ? 'Remove Sample Data'
                : 'Add Sample Data'}
          </button>
        </div>

        {demoEnabled && (
          <p role="status" style={{ marginTop: '12px' }}>
            Demo mode is active. The displayed history is
            simulated, not recorded from your browser.
          </p>
        )}

        {demoError && (
          <p
            role="alert"
            style={{
              marginTop: '12px',
              color: '#9a4138',
            }}
          >
            {demoError}
          </p>
        )}
      </section>

      <section className="botanical-panel botanical-panel--settings">
        <h2>Comfort &amp; accessibility</h2>

        <SettingToggle
          label="Reduce motion"
          description="Calm decorative leaf, card and page animations."
          checked={appearance.reduceMotion}
          onChange={reduceMotion => update({ reduceMotion })}
        />

        <SettingToggle
          label="Larger text"
          description="Increase body text size for easier reading."
          checked={appearance.largerText}
          onChange={largerText => update({ largerText })}
        />

        <div className="botanical-setting-row botanical-setting-row--column">
          <div>
            <h3>Botanical accent</h3>
            <p>
              Choose the color that feels most like your garden.
            </p>
          </div>

          <div className="botanical-theme-options">
            {themes.map(theme => (
              <button
                key={theme.id}
                type="button"
                className={
                  `botanical-theme-option${
                    appearance.theme === theme.id
                      ? ' botanical-theme-option--selected'
                      : ''
                  }`
                }
                onClick={() => update({
                  theme: theme.id,
                })}
                aria-pressed={
                  appearance.theme === theme.id
                }
              >
                <span
                  className="botanical-theme-option__swatch"
                  style={{
                    background: theme.color,
                  }}
                />
                {theme.label}
              </button>
            ))}
          </div>
        </div>

        <div className="botanical-saved">
          <span aria-hidden="true">❧</span>
          Saved on this browser
        </div>
      </section>
    </div>
  )
}
