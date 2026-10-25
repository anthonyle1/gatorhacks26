import { Link } from 'react-router-dom'
import CompostPile from '../components/garden/CompostPile'
import Inspector from '../components/garden/Inspector'
import PruningStation from '../components/garden/PruningStation'
import TreeCard from '../components/garden/TreeCard'
import { usePrune } from '../state/prune-context'

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
      <path
        d="M40 63C25 45 20 38 13 42c-5 14 10 24 27 21Z"
        fill="#DFE5CD"
        stroke="#A2AC91"
      />
      <path
        d="M70 48C56 31 52 22 45 27c-6 12 6 23 25 21Z"
        fill="#F0DDD1"
        stroke="#B9A69C"
      />
      <path
        d="M97 34C84 15 83 9 77 13c-7 11 2 24 20 21Z"
        fill="#D5E0C6"
        stroke="#A2AC91"
      />
      <path
        d="M122 23c-4-18 0-24 8-23 9 9 4 19-8 23Z"
        fill="#F0DDD1"
        stroke="#B9A69C"
      />
    </svg>
  )
}

function HeroTree() {
  return (
    <svg
      className="botanical-hero-tree"
      viewBox="0 0 360 330"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="180"
        cy="302"
        rx="129"
        ry="13"
        fill="#D9DBC4"
        opacity=".55"
      />

      <path
        d="M180 300c4-43 4-93-3-152"
        stroke="#80604A"
        strokeWidth="19"
        strokeLinecap="round"
      />

      <path
        d="M180 221c-25-32-51-54-89-74
           M179 195c25-42 56-66 99-80
           M178 162c-15-41-32-58-46-73"
        stroke="#80604A"
        strokeWidth="10"
        strokeLinecap="round"
      />

      <g className="botanical-tree-crown">
        <ellipse cx="114" cy="126" rx="62" ry="51" fill="#ADC6A0" />
        <ellipse cx="169" cy="89" rx="74" ry="67" fill="#8BAD87" />
        <ellipse cx="244" cy="116" rx="67" ry="55" fill="#BBD0A6" />
        <ellipse cx="179" cy="147" rx="80" ry="61" fill="#9BBB90" />
        <ellipse cx="213" cy="89" rx="51" ry="49" fill="#C7D7A8" />
        <ellipse cx="97" cy="143" rx="40" ry="35" fill="#C7D7A8" />
      </g>

      <g fill="#ECDFBA" opacity=".9">
        <circle cx="125" cy="86" r="5" />
        <circle cx="215" cy="50" r="4" />
        <circle cx="250" cy="143" r="5" />
        <circle cx="154" cy="166" r="3" />
      </g>

      <path
        d="M50 301q15-29 30 0m196 0q15-34 32 0"
        stroke="#93AD83"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function Garden() {
  const { prunedCount, branches, videoCount } = usePrune()
  const total = branches.length

  return (
    <div className="stack botanical-garden">

      {/* HERO */}
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

            <a
              href="#your-garden"
              className="botanical-text-link"
            >
              Explore your Garden ↓
            </a>
          </div>
        </div>

        <div
          className="botanical-hero__illustration"
          aria-hidden="true"
        >
          <div className="botanical-sun" />

          <HeroTree />

          <div className="botanical-hero__floating-leaf botanical-hero__floating-leaf--one">
            ✦
          </div>

          <div className="botanical-hero__floating-leaf botanical-hero__floating-leaf--two">
            ❧
          </div>
        </div>
      </section>

      {/* START SESSION INSTRUCTIONS */}
      <section
        id="start-scrolling"
        className="journal-card garden-start-card"
        aria-labelledby="garden-start-title"
      >
        <div
          className="garden-start-card__symbol"
          aria-hidden="true"
        >
          ❧
        </div>

        <div className="garden-start-card__body">
          <span className="botanical-eyebrow">
            YOUR NEXT SESSION
          </span>

          <h2 id="garden-start-title">
            Ready to plant something new?
          </h2>

          <p>
            Open the Prune Chrome extension and select
            <strong> Start a new session</strong> if your
            previous session has ended. Then browse
            YouTube Shorts or Instagram Reels as usual.
          </p>

          <p>
            When you're finished, select
            <strong> Finish and review session</strong> in
            the extension to generate your AI-powered topic tree.
          </p>

          <div className="garden-start-card__steps">
            <span>1. Open extension</span>
            <span>2. Start scrolling</span>
            <span>3. Finish &amp; review</span>
          </div>

          <details className="garden-start-card__help">
            <summary>Where is the extension?</summary>

            <p>
              In Chrome, select the puzzle-piece Extensions
              icon near the address bar, then open the Prune
              extension. Pin it for easier access.
            </p>

            <p>
              If a session is already active, the extension
              will show its timer and Finish button instead
              of Start a new session.
            </p>
          </details>
        </div>
      </section>

      {/* FEED GARDEN */}
      <section
        id="your-garden"
        className="botanical-garden__content"
      >
        <div className="botanical-section-title">
          <div>
            <div className="botanical-eyebrow">
              A LITTLE ROOM TO GROW
            </div>

            <h2>Your feed garden</h2>

            <p>
              Explore the categories in your feed and choose
              what you'd like to see less of.
            </p>
          </div>

          <BotanicalSprig />
        </div>

        {/* REAL STATS FROM MAIN */}
        <div className="stats">
          <div className="stat">
            <span className="stat__label">
              Growing topics
            </span>
            <span className="stat__value">
              {total - prunedCount}
            </span>
          </div>

          <div className="stat">
            <span className="stat__label">
              Branches pruned
            </span>
            <span className="stat__value">
              {prunedCount} of {total} topics
            </span>
          </div>

          <div className="stat">
            <span className="stat__label">
              Videos in your topic tree
            </span>
            <span className="stat__value">
              {videoCount}
            </span>
          </div>
        </div>

        {/* MAIN'S DYNAMIC TREE AND PRUNING COMPONENTS */}
        <div className="columns">
          <TreeCard />

          <div className="side">
            <PruningStation />
            <Inspector />
          </div>
        </div>

        {/* COMPOST AND GARDEN SUMMARY */}
        <div className="row">
          <CompostPile />

          <section
            className="card card--lg change"
            aria-labelledby="change-heading"
          >
            <h2 id="change-heading" className="h3">
              Your garden now
            </h2>

            <p className="compost__intro">
              A cut removes every topic below it.
              Restore a branch from the compost pile.
            </p>

            <div className="change__grid">
              <div className="change__cell">
                <span className="change__label">
                  Growing topics
                </span>
                <span className="change__value">
                  {total - prunedCount}
                </span>
              </div>

              <div className="change__cell change__cell--after">
                <span className="change__label">
                  Removed topics
                </span>
                <span className="change__value">
                  {prunedCount}
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
