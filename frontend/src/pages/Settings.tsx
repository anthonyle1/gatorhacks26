// export default function Settings() {
//   return (
//     <div className="stack stack--narrow">
//       <h1 className="h1 h1--md">Settings</h1>
//       <section className="card">
//         <p className="body">Settings are not designed yet. This page is a placeholder.</p>
//       </section>
//     </div>
//   )
// }


import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

type ThemeName = 'forest' | 'olive' | 'rose' | 'honey'

type Appearance = {
  reduceMotion: boolean
  largerText: boolean
  theme: ThemeName
}

const STORAGE_KEY = 'prune-appearance'

const defaults: Appearance = {
  reduceMotion: false,
  largerText: false,
  theme: 'forest',
}

const themes: { id: ThemeName; label: string; color: string }[] = [
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
        className={`botanical-toggle${checked ? ' botanical-toggle--on' : ''}`}
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance))

    document.documentElement.dataset.pruneTheme = appearance.theme
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
    setAppearance(current => ({ ...current, ...changes }))
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
        <span className="botanical-panel__decoration" aria-hidden="true">
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

      <section className="botanical-panel botanical-panel--settings">
        <h2>Comfort & accessibility</h2>

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
            <p>Choose the color that feels most like your garden.</p>
          </div>

          <div className="botanical-theme-options">
            {themes.map(theme => (
              <button
                key={theme.id}
                type="button"
                className={`botanical-theme-option${
                  appearance.theme === theme.id
                    ? ' botanical-theme-option--selected'
                    : ''
                }`}
                onClick={() => update({ theme: theme.id })}
                aria-pressed={appearance.theme === theme.id}
              >
                <span
                  className="botanical-theme-option__swatch"
                  style={{ background: theme.color }}
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
