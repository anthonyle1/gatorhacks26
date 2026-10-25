import { useState } from 'react'
import { Link } from 'react-router-dom'
import Chip from '../components/Chip'
import { ChevronLeftIcon, ChevronRightIcon, ScissorsIcon } from '../components/icons'
import { DAYS, getBranch } from '../data/sample'
import { usePrune } from '../state/prune-context'
import type { Level } from '../types'

const BAR_COLOR: Record<Level | 'cut' | 'not_rated', string> = {
  not_rated: '#94aa98',
  heavy: 'var(--heavy-leaf)',
  some: 'var(--some-leaf-light)',
  calm: 'var(--calm-leaf-light)',
  cut: '#c8d3c4',
}

const DAY_PILL: Record<Level, { text: string; className: string }> = {
  heavy: { text: 'Heavy day', className: 'day-pill--heavy' },
  some: { text: 'Some hostility day', className: 'day-pill--some' },
  calm: { text: 'Calm day', className: 'day-pill--calm' },
}

/** Day detail view (opens when you tap a calendar day in the side panel). */
export default function Calendar() {
  const [index, setIndex] = useState(0)
  const { pruned, setPruned } = usePrune()
  const day = DAYS[index]
  const pill = DAY_PILL[day.level]
  const maxShare = Math.max(...day.categories.map((c) => c.share))

  return (
    <div className="stack stack--narrow">
      <div className="day-nav">
        <Link to="/" className="btn btn--back">
          <ChevronLeftIcon color="#1F3A2E" />
          Garden
        </Link>
        <div className="day-nav__arrows">
          {/* Days run newest first, so "previous day" moves toward the end of the list. */}
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous day"
            disabled={index >= DAYS.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            <ChevronLeftIcon color="#1F3A2E" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next day"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            <ChevronRightIcon color="#1F3A2E" />
          </button>
        </div>
      </div>

      <div className="day-head">
        <h1 className="h1 h1--md">{day.label}</h1>
        <div className="day-head__meta">
          <span className={`day-pill ${pill.className}`}>{pill.text}</span>
          <span className="muted">{day.shorts} Shorts watched</span>
        </div>
      </div>

      <section className="card" aria-labelledby="why-heading">
        <span className="eyebrow" id="why-heading">What made it {day.level === 'calm' ? 'calm' : day.level === 'heavy' ? 'heavy' : 'tense'}</span>
        <p className="day-why">
          {day.level === 'calm' ? 'Most of your time went to ' : 'Most of the hostility came from '}
          {day.summary.names.map((n, i) => (
            <span key={n}>
              {i > 0 && ' and '}
              <strong>{n}</strong>
            </span>
          ))}
          .
        </p>
        <p className="fine">{day.summary.detail}</p>
      </section>

      <section className="card" aria-labelledby="cats-heading">
        <h2 id="cats-heading" className="h3">Categories you watched</h2>
        <p className="fine">Bar length = how much of your day it took up.</p>
        {day.categories.map((c) => {
          const branch = getBranch(c.branchId)
          if (!branch) return null
          const isPruned = !!pruned[branch.id]
          const display = isPruned ? 'cut' : branch.level
          return (
            <div key={branch.id} className="cat">
              <div className="cat__top">
                <div className="cat__info">
                  <span className="cat__name">{branch.name}</span>
                  <span className="fine">{c.shorts} Shorts</span>
                </div>
                <Chip level={display} />
              </div>
              <div className="bar" role="presentation">
                <div
                  className="bar__fill"
                  style={{ width: `${Math.round((c.share / maxShare) * 100)}%`, background: BAR_COLOR[display] }}
                />
              </div>
              {!isPruned && branch.level !== 'calm' && (
                <button type="button" className="btn btn--dark-sm" onClick={() => setPruned(branch.id, true)}>
                  <ScissorsIcon size={16} color="#FFFFFF" />
                  Prune this branch
                </button>
              )}
              {isPruned && (
                <button type="button" className="btn btn--outline-soft btn--sm" onClick={() => setPruned(branch.id, false)}>
                  Pruned · Undo
                </button>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
