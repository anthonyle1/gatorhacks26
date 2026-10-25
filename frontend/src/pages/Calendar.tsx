// import { useState } from 'react'
// import { Link } from 'react-router-dom'
// import Chip from '../components/Chip'
// import { ChevronLeftIcon, ChevronRightIcon, ScissorsIcon } from '../components/icons'
// import { DAYS, getBranch } from '../data/sample'
// import { usePrune } from '../state/prune-context'
// import type { Level } from '../types'

// const BAR_COLOR: Record<Level | 'cut', string> = {
//   heavy: 'var(--heavy-leaf)',
//   some: 'var(--some-leaf-light)',
//   calm: 'var(--calm-leaf-light)',
//   cut: '#c8d3c4',
// }

// const DAY_PILL: Record<Level, { text: string; className: string }> = {
//   heavy: { text: 'Heavy day', className: 'day-pill--heavy' },
//   some: { text: 'Some hostility day', className: 'day-pill--some' },
//   calm: { text: 'Calm day', className: 'day-pill--calm' },
// }

// /** Day detail view (opens when you tap a calendar day in the side panel). */
// export default function Calendar() {
//   const [index, setIndex] = useState(0)
//   const { pruned, setPruned } = usePrune()
//   const day = DAYS[index]
//   const pill = DAY_PILL[day.level]
//   const maxShare = Math.max(...day.categories.map((c) => c.share))

//   return (
//     <div className="stack stack--narrow">
//       <div className="day-nav">
//         <Link to="/" className="btn btn--back">
//           <ChevronLeftIcon color="#1F3A2E" />
//           Garden
//         </Link>
//         <div className="day-nav__arrows">
//           {/* Days run newest first, so "previous day" moves toward the end of the list. */}
//           <button
//             type="button"
//             className="icon-btn"
//             aria-label="Previous day"
//             disabled={index >= DAYS.length - 1}
//             onClick={() => setIndex(index + 1)}
//           >
//             <ChevronLeftIcon color="#1F3A2E" />
//           </button>
//           <button
//             type="button"
//             className="icon-btn"
//             aria-label="Next day"
//             disabled={index === 0}
//             onClick={() => setIndex(index - 1)}
//           >
//             <ChevronRightIcon color="#1F3A2E" />
//           </button>
//         </div>
//       </div>

//       <div className="day-head">
//         <h1 className="h1 h1--md">{day.label}</h1>
//         <div className="day-head__meta">
//           <span className={`day-pill ${pill.className}`}>{pill.text}</span>
//           <span className="muted">{day.shorts} Shorts watched</span>
//         </div>
//       </div>

//       <section className="card" aria-labelledby="why-heading">
//         <span className="eyebrow" id="why-heading">What made it {day.level === 'calm' ? 'calm' : day.level === 'heavy' ? 'heavy' : 'tense'}</span>
//         <p className="day-why">
//           {day.level === 'calm' ? 'Most of your time went to ' : 'Most of the hostility came from '}
//           {day.summary.names.map((n, i) => (
//             <span key={n}>
//               {i > 0 && ' and '}
//               <strong>{n}</strong>
//             </span>
//           ))}
//           .
//         </p>
//         <p className="fine">{day.summary.detail}</p>
//       </section>

//       <section className="card" aria-labelledby="cats-heading">
//         <h2 id="cats-heading" className="h3">Categories you watched</h2>
//         <p className="fine">Bar length = how much of your day it took up.</p>
//         {day.categories.map((c) => {
//           const branch = getBranch(c.branchId)
//           if (!branch) return null
//           const isPruned = !!pruned[branch.id]
//           const display = isPruned ? 'cut' : branch.level
//           return (
//             <div key={branch.id} className="cat">
//               <div className="cat__top">
//                 <div className="cat__info">
//                   <span className="cat__name">{branch.name}</span>
//                   <span className="fine">{c.shorts} Shorts</span>
//                 </div>
//                 <Chip level={display} />
//               </div>
//               <div className="bar" role="presentation">
//                 <div
//                   className="bar__fill"
//                   style={{ width: `${Math.round((c.share / maxShare) * 100)}%`, background: BAR_COLOR[display] }}
//                 />
//               </div>
//               {!isPruned && branch.level !== 'calm' && (
//                 <button type="button" className="btn btn--dark-sm" onClick={() => setPruned(branch.id, true)}>
//                   <ScissorsIcon size={16} color="#FFFFFF" />
//                   Prune this branch
//                 </button>
//               )}
//               {isPruned && (
//                 <button type="button" className="btn btn--outline-soft btn--sm" onClick={() => setPruned(branch.id, false)}>
//                   Pruned · Undo
//                 </button>
//               )}
//             </div>
//           )
//         })}
//       </section>
//     </div>
//   )
// }

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Chip from '../components/Chip'
import { ScissorsIcon } from '../components/icons'
import { DAYS, getBranch } from '../data/sample'
import { usePrune } from '../state/prune-context'
import type { Level } from '../types'

const BAR_COLOR: Record<Level | 'cut', string> = {
  heavy: 'var(--heavy-leaf)',
  some: 'var(--some-leaf-light)',
  calm: 'var(--calm-leaf-light)',
  cut: '#c8d3c4',
}

const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

export default function Calendar() {
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const { pruned, setPruned } = usePrune()

  const calendarDays = useMemo(() => {
    const year = month.getFullYear()
    const monthIndex = month.getMonth()
    const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

    return [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
    ]
  }, [month])

  const dateKey = (day: number) =>
    `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  const selectedDay = useMemo(() => {
    if (!selectedDate) return null
    return DAYS.find(day => {
      const normalized = new Date(`${selectedDate}T12:00:00`)
      return day.label === new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }).format(normalized)
    }) ?? null
  }, [selectedDate])

  const moveMonth = (offset: number) => {
    setMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1))
    setSelectedDate(null)
  }

  const monthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(month)

  return (
    <div className="journal-page">
      <header className="journal-heading">
        <span className="botanical-eyebrow">✧ GROWTH JOURNEY</span>
        <h1>Your growth <em>journal.</em></h1>
        <p>
          Every day is a chance to grow. Explore your scrolling
          patterns and the topics that shape your feed.
        </p>
      </header>

      <section className="journal-card" aria-label="Activity calendar">
        <div className="journal-calendar-head">
          <button
            type="button"
            className="journal-arrow"
            onClick={() => moveMonth(-1)}
            aria-label="Previous month"
          >
            ‹
          </button>

          <div className="journal-month-title">
            <h2>{monthLabel}</h2>
            <span>Choose a day to explore</span>
          </div>

          <button
            type="button"
            className="journal-arrow"
            onClick={() => moveMonth(1)}
            aria-label="Next month"
          >
            ›
          </button>
        </div>

        <div className="journal-calendar-grid">
          {weekdays.map(day => (
            <div className="journal-weekday" key={day}>{day}</div>
          ))}

          {calendarDays.map((day, index) => {
            if (day === null) {
              return <div className="journal-day-spacer" key={`blank-${index}`} />
            }

            const key = dateKey(day)
            const selected = selectedDate === key
            const today = new Date()
            const isToday =
              day === today.getDate() &&
              month.getMonth() === today.getMonth() &&
              month.getFullYear() === today.getFullYear()

            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDate(key)}
                aria-pressed={selected}
                className={`journal-date${selected ? ' journal-date--selected' : ''}${isToday ? ' journal-date--today' : ''}`}
              >
                <span>{day}</span>
                {selected && <span className="journal-date__leaf" aria-hidden="true">❧</span>}
              </button>
            )
          })}
        </div>
      </section>

      <section className="journal-card journal-detail" aria-live="polite">
        <h2>{selectedDate ? 'Your day in the garden' : 'Choose a day'}</h2>

        {!selectedDate && (
          <>
            <p>Pick a day on your calendar to explore your scrolling activity.</p>
            <p className="journal-note">
              This calendar is a visual preview until real session history is connected.
            </p>
          </>
        )}

        {selectedDate && !selectedDay && (
          <>
            <p>No example activity is available for this day.</p>
            <p className="journal-note">
              Your real session journal will appear here when historical reviews are connected.
            </p>
          </>
        )}

        {selectedDay && (
          <div className="journal-day-details">
            <div className="journal-summary">
              <span className="journal-demo-tag">Example data</span>
              <h3>{selectedDay.label}</h3>
              <p>{selectedDay.summary.detail}</p>
              <span>{selectedDay.shorts} Shorts in this example day</span>
            </div>

            <h3>Categories explored</h3>

            {selectedDay.categories.map(category => {
              const branch = getBranch(category.branchId)
              if (!branch) return null
              const isPruned = !!pruned[branch.id]
              const display = isPruned ? 'cut' : branch.level

              return (
                <div className="journal-category" key={branch.id}>
                  <div className="journal-category__top">
                    <div>
                      <strong>{branch.name}</strong>
                      <span>{category.shorts} videos · {category.share}%</span>
                    </div>
                    <Chip level={display} />
                  </div>
                  <div className="bar">
                    <div
                      className="bar__fill"
                      style={{
                        width: `${category.share}%`,
                        background: BAR_COLOR[display],
                      }}
                    />
                  </div>

                  {branch.level !== 'calm' && (
                    <button
                      type="button"
                      className="journal-prune-button"
                      onClick={() => setPruned(branch.id, !isPruned)}
                    >
                      {!isPruned && <ScissorsIcon size={15} color="currentColor" />}
                      {isPruned ? 'Undo pruning' : 'Prune this branch'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <Link to="/" className="botanical-inline-link">
          Return to your Garden →
        </Link>
      </section>
    </div>
  )
}
