// import { useMemo, useState } from 'react'
// import { Link } from 'react-router-dom'
// import Chip from '../components/Chip'
// import { ScissorsIcon } from '../components/icons'
// import { DAYS, getBranch } from '../data/sample'
// import { usePrune } from '../state/prune-context'
// import type { Level } from '../types'

// const BAR_COLOR: Record<Level | 'cut' | 'not_rated', string> = {
//   not_rated: '#94aa98',
//   heavy: 'var(--heavy-leaf)',
//   some: 'var(--some-leaf-light)',
//   calm: 'var(--calm-leaf-light)',
//   cut: '#c8d3c4',
// }

// const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

// export default function Calendar() {
//   const [month, setMonth] = useState(() => {
//     const now = new Date()
//     return new Date(now.getFullYear(), now.getMonth(), 1)
//   })
//   const [selectedDate, setSelectedDate] = useState<string | null>(null)
//   const { pruned, setPruned } = usePrune()

//   const calendarDays = useMemo(() => {
//     const year = month.getFullYear()
//     const monthIndex = month.getMonth()
//     const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7
//     const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

//     return [
//       ...Array.from({ length: firstWeekday }, () => null),
//       ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
//     ]
//   }, [month])

//   const dateKey = (day: number) =>
//     `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

//   const selectedDay = useMemo(() => {
//     if (!selectedDate) return null
//     return DAYS.find(day => {
//       const normalized = new Date(`${selectedDate}T12:00:00`)
//       return day.label === new Intl.DateTimeFormat('en-US', {
//         weekday: 'long',
//         month: 'short',
//         day: 'numeric',
//       }).format(normalized)
//     }) ?? null
//   }, [selectedDate])

//   const moveMonth = (offset: number) => {
//     setMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1))
//     setSelectedDate(null)
//   }

//   const monthLabel = new Intl.DateTimeFormat('en-US', {
//     month: 'long',
//     year: 'numeric',
//   }).format(month)

//   return (
//     <div className="journal-page">
//       <header className="journal-heading">
//         <span className="botanical-eyebrow">✧ GROWTH JOURNEY</span>
//         <h1>Your growth <em>journal.</em></h1>
//         <p>
//           Every day is a chance to grow. Explore your scrolling
//           patterns and the topics that shape your feed.
//         </p>
//       </header>

//       <section className="journal-card" aria-label="Activity calendar">
//         <div className="journal-calendar-head">
//           <button
//             type="button"
//             className="journal-arrow"
//             onClick={() => moveMonth(-1)}
//             aria-label="Previous month"
//           >
//             ‹
//           </button>

//           <div className="journal-month-title">
//             <h2>{monthLabel}</h2>
//             <span>Choose a day to explore</span>
//           </div>

//           <button
//             type="button"
//             className="journal-arrow"
//             onClick={() => moveMonth(1)}
//             aria-label="Next month"
//           >
//             ›
//           </button>
//         </div>

//         <div className="journal-calendar-grid">
//           {weekdays.map(day => (
//             <div className="journal-weekday" key={day}>{day}</div>
//           ))}

//           {calendarDays.map((day, index) => {
//             if (day === null) {
//               return <div className="journal-day-spacer" key={`blank-${index}`} />
//             }

//             const key = dateKey(day)
//             const selected = selectedDate === key
//             const today = new Date()
//             const isToday =
//               day === today.getDate() &&
//               month.getMonth() === today.getMonth() &&
//               month.getFullYear() === today.getFullYear()

//             return (
//               <button
//                 key={key}
//                 type="button"
//                 onClick={() => setSelectedDate(key)}
//                 aria-pressed={selected}
//                 className={`journal-date${selected ? ' journal-date--selected' : ''}${isToday ? ' journal-date--today' : ''}`}
//               >
//                 <span>{day}</span>
//                 {selected && <span className="journal-date__leaf" aria-hidden="true">❧</span>}
//               </button>
//             )
//           })}
//         </div>
//       </section>

//       <section className="journal-card journal-detail" aria-live="polite">
//         <h2>{selectedDate ? 'Your day in the garden' : 'Choose a day'}</h2>

//         {!selectedDate && (
//           <>
//             <p>Pick a day on your calendar to explore your scrolling activity.</p>
//             <p className="journal-note">
//               This calendar is a visual preview until real session history is connected.
//             </p>
//           </>
//         )}

//         {selectedDate && !selectedDay && (
//           <>
//             <p>No example activity is available for this day.</p>
//             <p className="journal-note">
//               Your real session journal will appear here when historical reviews are connected.
//             </p>
//           </>
//         )}

//         {selectedDay && (
//           <div className="journal-day-details">
//             <div className="journal-summary">
//               <span className="journal-demo-tag">Example data</span>
//               <h3>{selectedDay.label}</h3>
//               <p>{selectedDay.summary.detail}</p>
//               <span>{selectedDay.shorts} Shorts in this example day</span>
//             </div>

//             <h3>Categories explored</h3>

//             {selectedDay.categories.map(category => {
//               const branch = getBranch(category.branchId)
//               if (!branch) return null
//               const isPruned = !!pruned[branch.id]
//               const display = isPruned ? 'cut' : branch.level

//               return (
//                 <div className="journal-category" key={branch.id}>
//                   <div className="journal-category__top">
//                     <div>
//                       <strong>{branch.name}</strong>
//                       <span>{category.shorts} videos · {category.share}%</span>
//                     </div>
//                     <Chip level={display} />
//                   </div>
//                   <div className="bar">
//                     <div
//                       className="bar__fill"
//                       style={{
//                         width: `${category.share}%`,
//                         background: BAR_COLOR[display],
//                       }}
//                     />
//                   </div>

//                   {branch.level !== 'calm' && (
//                     <button
//                       type="button"
//                       className="journal-prune-button"
//                       onClick={() => setPruned(branch.id, !isPruned)}
//                     >
//                       {!isPruned && <ScissorsIcon size={15} color="currentColor" />}
//                       {isPruned ? 'Undo pruning' : 'Prune this branch'}
//                     </button>
//                   )}
//                 </div>
//               )
//             })}
//           </div>
//         )}

//         <Link to="/" className="botanical-inline-link">
//           Return to your Garden →
//         </Link>
//       </section>
//     </div>
//   )
// }

import { useEffect, useMemo, useState } from 'react'
import DailySummaryView from '../components/daily/DailySummaryView'
import { Link, useSearchParams } from 'react-router-dom'

import {
  fetchDay,
  fetchMonth,
  type DailySummary,
  type MonthlySummary,
} from '../data/dailyInsights'

const weekdays = [
  'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN',
]

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function monthKey(date: Date) {
  return dateKey(date).slice(0, 7)
}

export default function Calendar() {
  const [searchParams, setSearchParams] = useSearchParams()

  const requestedDate = searchParams.get('date')
  const validRequestedDate =
    requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : null

  const [month, setMonth] = useState(() => {
    if (validRequestedDate) {
      const [year, monthIndex] = validRequestedDate
        .split('-')
        .map(Number)
      return new Date(year, monthIndex - 1, 1)
    }
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const [selectedDate, setSelectedDate] =
    useState<string | null>(validRequestedDate)

  const [monthly, setMonthly] =
    useState<MonthlySummary | null>(null)

  const [daily, setDaily] =
    useState<DailySummary | null>(null)

  const [monthLoading, setMonthLoading] = useState(true)
  const [dayLoading, setDayLoading] = useState(false)
  const [monthError, setMonthError] = useState('')
  const [dayError, setDayError] = useState('')

  const monthValue = monthKey(month)
  const [refreshVersion, setRefreshVersion] = useState(0)
  useEffect(() => {
    const refresh = () => setRefreshVersion(value => value + 1)
    const timer = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])

  useEffect(() => {
    let active = true

    fetchMonth(monthValue)
      .then(data => {
        if (active) {
          setMonthly(data)
          setMonthError('')
        }
      })
      .catch(error => {
        if (active) {
          setMonthly(null)
          setMonthError(String(error))
        }
      })
      .finally(() => {
        if (active) setMonthLoading(false)
      })

    return () => {
      active = false
    }
  }, [monthValue, refreshVersion])

  useEffect(() => {
    if (!selectedDate) {
      setDaily(null)
      return
    }

    let active = true

    fetchDay(selectedDate)
      .then(data => {
        if (active) {
          setDaily(data)
          setDayError('')
        }
      })
      .catch(error => {
        if (active) {
          setDaily(null)
          setDayError(String(error))
        }
      })
      .finally(() => {
        if (active) setDayLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedDate, refreshVersion])

  const calendarDays = useMemo(() => {
    const year = month.getFullYear()
    const index = month.getMonth()

    const offset =
      (new Date(year, index, 1).getDay() + 6) % 7

    const days = new Date(year, index + 1, 0).getDate()

    return [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: days }, (_, i) => i + 1),
    ]
  }, [month])

  const activities = new Map(
    (monthly?.days ?? []).map(day => [day.date, day])
  )

  function changeMonth(offset: number) {
    setMonthLoading(true)
    setMonthly(null)
    setMonth(current =>
      new Date(
        current.getFullYear(),
        current.getMonth() + offset,
        1
      )
    )
    setSelectedDate(null)
    setDaily(null)
    setSearchParams({})
  }

  function selectDate(value: string) {
    setDayLoading(true)
    setDaily(null)
    setSelectedDate(value)
    setSearchParams({ date: value })
  }

  const monthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(month)

  return (
    <div className="journal-page">
      <header className="journal-heading">
        <span className="botanical-eyebrow">
          ✧ GROWTH JOURNEY
        </span>

        <h1>
          Your growth <em style={{marginLeft:"1.5rem"}}>journal.</em>
        </h1>

        <p>
          Explore the topics you watched, how long you
          scrolled, and the content assessments from
          your completed sessions.
        </p>
      </header>

      <section className="journal-card" aria-label="Activity calendar">
        <div className="journal-calendar-head">
          <button
            type="button"
            className="journal-arrow"
            aria-label="Previous month"
            onClick={() => changeMonth(-1)}
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
            aria-label="Next month"
            onClick={() => changeMonth(1)}
          >
            ›
          </button>
        </div>

        {monthLoading && (
          <p role="status">Loading calendar…</p>
        )}

        {monthError && (
          <p role="alert">{monthError}</p>
        )}

        <div className="journal-calendar-grid">
          {weekdays.map(day => (
            <div key={day} className="journal-weekday">
              {day}
            </div>
          ))}

          {calendarDays.map((day, index) => {
            if (day === null) {
              return (
                <div
                  key={`blank-${index}`}
                  className="journal-day-spacer"
                />
              )
            }

            const key = dateKey(
              new Date(
                month.getFullYear(),
                month.getMonth(),
                day
              )
            )

            const activity = activities.get(key)
            const selected = key === selectedDate

            return (
              <button
                key={key}
                type="button"
                className={`journal-date${
                  selected ? ' journal-date--selected' : ''
                }${
                  activity?.warning_count
                    ? ' journal-date--warning'
                    : activity?.videos_watched
                      ? ' journal-date--active'
                      : ''
                }`}
                aria-pressed={selected}
                onClick={() => selectDate(key)}
                aria-label={`${key}, ${
                  activity?.videos_watched ?? 0
                } video encounters`}
              >
                <span>{day}</span>

                {activity && (
                  <span className="journal-date__count">
                    {activity.videos_watched} videos
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      <section
        className="journal-card journal-detail"
        aria-live="polite"
      >
        <h2>
          {selectedDate
            ? `Your garden on ${selectedDate}`
            : 'Choose a day'}
        </h2>

        {!selectedDate && (
          <p>
            Select a calendar date to view your scrolling
            history and content insights.
          </p>
        )}

        {dayLoading && selectedDate && (
          <p role="status">Loading daily details…</p>
        )}

        {dayError && (
          <p role="alert">{dayError}</p>
        )}

        {daily && !dayLoading && <DailySummaryView key={daily.date} data={daily} />}

        <Link to="/" className="botanical-inline-link">
          Return to your Garden →
        </Link>
      </section>
    </div>
  )
}
