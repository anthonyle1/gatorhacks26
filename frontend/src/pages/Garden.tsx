// import { Link } from 'react-router-dom'
// import CompostPile from '../components/garden/CompostPile'
// import Inspector from '../components/garden/Inspector'
// import PruningStation from '../components/garden/PruningStation'
// import TreeCard from '../components/garden/TreeCard'
// import { PRUNABLE_BRANCHES, SAMPLE_SHORTS_LAST_30_DAYS } from '../data/sample'
// import { usePrune } from '../state/prune-context'

// function treeHealth(pruned: number, total: number) {
//   if (pruned === 0) return { label: 'Wilting', className: 'stat__value--wilting' }
//   if (pruned < total) return { label: 'Recovering', className: 'stat__value--recovering' }
//   return { label: 'Thriving', className: 'stat__value--thriving' }
// }

// export default function Garden() {
//   const { prunedCount } = usePrune()
//   const total = PRUNABLE_BRANCHES.length
//   const health = treeHealth(prunedCount, total)

//   return (
//     <div className="stack">
//       <div className="page-head">
//         <div className="page-head__text">
//           <h1 className="h1">Your feed garden</h1>
//           <p className="lede">
//             Every category you watched in the last 30 days. Cut the withered branches to clean up what your feed
//             shows you.
//           </p>
//         </div>
//         <div className="stats">
//           <div className="stat">
//             <span className="stat__label">Tree health</span>
//             <span className={`stat__value ${health.className}`}>{health.label}</span>
//           </div>
//           <div className="stat">
//             <span className="stat__label">Branches pruned</span>
//             <span className="stat__value">
//               {prunedCount} of {total} withered
//             </span>
//           </div>
//           <div className="stat">
//             <span className="stat__label">Shorts, last 30 days</span>
//             {/* Sample number: replace with the real count from the API. */}
//             <span className="stat__value">{SAMPLE_SHORTS_LAST_30_DAYS}</span>
//           </div>
//         </div>
//       </div>

//       <div className="columns">
//         <TreeCard />
//         <div className="side">
//           <PruningStation />
//           <Inspector />
//         </div>
//       </div>

//       <div className="row">
//         <CompostPile />
//         <section className="card card--lg change" aria-labelledby="change-heading">
//           <h2 id="change-heading" className="h3">How your garden changed</h2>
//           <p className="compost__intro">After each prune, we track whether your feed gets calmer.</p>
//           <div className="change__grid">
//             <div className="change__cell">
//               <span className="change__label">Before pruning</span>
//               {/* Placeholder: fill from real before/after hostility levels. */}
//               <span className="change__value">[level]</span>
//             </div>
//             <div className="change__cell change__cell--after">
//               <span className="change__label">Since pruning</span>
//               <span className="change__value">[level]</span>
//             </div>
//           </div>
//           <Link to="/calendar" className="link-strong">Open your calendar</Link>
//         </section>
//       </div>
//     </div>
//   )
// }


import { Link } from 'react-router-dom'
import CompostPile from '../components/garden/CompostPile'
import Inspector from '../components/garden/Inspector'
import PruningStation from '../components/garden/PruningStation'
import Tree from '../components/Tree'
import TreeCard from '../components/garden/TreeCard'
import {
  PRUNABLE_BRANCHES,
  SAMPLE_SHORTS_LAST_30_DAYS
} from '../data/sample'
import { usePrune } from '../state/prune-context'

function treeHealth(pruned: number, total: number) {
  if (pruned === 0) {
    return { label: 'Wilting', className: 'stat__value--wilting' }
  }

  if (pruned < total) {
    return { label: 'Recovering', className: 'stat__value--recovering' }
  }

  return { label: 'Thriving', className: 'stat__value--thriving' }
}

function BotanicalSprig() {
  return (
    <svg
      className="botanical-sprig"
      viewBox="0 0 160 95"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 77C45 68 79 44 151 12"
        stroke="#8D9870"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M40 63C25 45 20 38 13 42c-5 14 10 24 27 21Z" fill="#DFE5CD" stroke="#A2AC91" />
      <path d="M70 48C56 31 52 22 45 27c-6 12 6 23 25 21Z" fill="#F0DDD1" stroke="#B9A69C" />
      <path d="M97 34C84 15 83 9 77 13c-7 11 2 24 20 21Z" fill="#D5E0C6" stroke="#A2AC91" />
      <path d="M122 23c-4-18 0-24 8-23 9 9 4 19-8 23Z" fill="#F0DDD1" stroke="#B9A69C" />
      <path d="M59 55c3-16 9-21 18-17 3 12-4 18-18 17Z" fill="#C9D8BC" stroke="#A2AC91" />
      <path d="M91 38c1-16 8-22 17-20 6 11-1 18-17 20Z" fill="#E9D5CB" stroke="#B9A69C" />
    </svg>
  )
}

export default function Garden() {
  const { prunedCount } = usePrune()
  const total = PRUNABLE_BRANCHES.length
  const health = treeHealth(prunedCount, total)

  return (
    <div className="stack botanical-garden">
      <section className="botanical-hero">
        <div className="botanical-hero__copy">
          <div className="botanical-eyebrow">
            <span aria-hidden="true">✧</span>
            YOUR GARDEN
          </div>

          <h1 className="botanical-hero__title">
            Watch your scrolling
            <span> grow into a tree.</span>
          </h1>

          <p className="botanical-hero__description">
            Every scroll tells a story. Discover the topics
            shaping your feed, reflect on the content you
            consume, and make room for what helps you grow.
          </p>
          <div className="botanical-hero__actions">
            <a
              href="#start-scrolling"
              className="botanical-primary-btn"
            >
              <span aria-hidden="true">❧</span>
              Start a session
              <span aria-hidden="true">↗</span>
            </a>

            <a href="#your-garden" className="botanical-text-link">
              Explore your Garden ↓
            </a>
          </div>
        </div>
        <div className="botanical-hero__illustration" aria-hidden="true">
          <div className="botanical-sun" />

          <div className="botanical-hero__tree-preview">
            <Tree decorative />
          </div>

          <div className="botanical-hero__floating-leaf botanical-hero__floating-leaf--one">
            ✦
          </div>

          <div className="botanical-hero__floating-leaf botanical-hero__floating-leaf--two">
            ❧
          </div>
        </div>
      </section>


      <section id="start-scrolling" className="journal-card garden-start-card" aria-labelledby="garden-start-title">
        <div className="garden-start-card__symbol" aria-hidden="true">
          ❧
        </div>

        <div className="garden-start-card__body">
          <span className="botanical-eyebrow">YOUR NEXT SESSION</span>

          <h2 id="garden-start-title">Ready to plant something new?</h2>

          <p>
            Open the Prune Chrome extension and select
            <strong> Start a new session</strong> if your previous
            session has ended. Then browse YouTube Shorts or
            Instagram Reels as usual.
          </p>

          <p>
            When you're finished, choose
            <strong> Finish and review session</strong> in the extension
            to generate your AI-powered topic tree.
          </p>

          <div className="garden-start-card__steps">
            <span>1. Open extension</span>
            <span>2. Start scrolling</span>
            <span>3. Finish & review</span>
          </div>

          <details className="garden-start-card__help">
            <summary>Where is the extension?</summary>
            <p>
              In Chrome, select the puzzle-piece Extensions icon
              near the address bar, then open Healthy Doomscrolling.
              Pin the extension for easier access.
            </p>
            <p>
              If a session is already active, the extension will show
              its timer and Finish button instead of Start a new session.
            </p>
          </details>
        </div>
      </section>

      <section id="your-garden" className="botanical-garden__content">
        <div className="botanical-section-title">
          <div>
            <div className="botanical-eyebrow">A LITTLE ROOM TO GROW</div>
            <h2>Your feed garden</h2>
            <p>
              Explore the categories in your feed and choose
              what you'd like to see less of.
            </p>
          </div>
          <BotanicalSprig />
        </div>

        <div className="stats">
          <div className="stat">
            <span className="stat__label">Tree health</span>
            <span className={`stat__value ${health.className}`}>
              {health.label}
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Branches pruned</span>
            <span className="stat__value">
              {prunedCount} of {total}
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Shorts in demo data</span>
            <span className="stat__value">
              {SAMPLE_SHORTS_LAST_30_DAYS}
            </span>
          </div>
        </div>

        <div className="columns">
          <TreeCard />
          <div className="side">
            <PruningStation />
            <Inspector />
          </div>
        </div>

        <div className="row">
          <CompostPile />

          <section
            className="card card--lg change"
            aria-labelledby="change-heading"
          >
            <h2 id="change-heading" className="h3">
              How your garden changed
            </h2>
            <p className="compost__intro">
              Your saved preferences can help you reflect on
              which topics you'd like to see less of.
            </p>

            <div className="change__grid">
              <div className="change__cell">
                <span className="change__label">
                  Before pruning
                </span>
                <span className="change__value">
                  Not measured
                </span>
              </div>

              <div className="change__cell change__cell--after">
                <span className="change__label">
                  After pruning
                </span>
                <span className="change__value">
                  Not measured
                </span>
              </div>
            </div>

            <Link to="/calendar" className="link-strong">
              Explore your growth journey →
            </Link>
          </section>
        </div>
      </section>
    </div>
  )
}
