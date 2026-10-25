// import { Link } from 'react-router-dom'
// import { ChevronLeftIcon, LockIcon } from '../components/icons'

// const COUNTS = [
//   'Talent-shaming',
//   'Looks and body shaming',
//   'Insults and name-calling',
//   'Fan wars',
//   'Sarcastic put-downs',
// ]

// const DOESNT_COUNT = [
//   'Praise slang ("ate", "slay")',
//   'Laughing, 💀, excited swearing',
//   'Sadness or sympathy',
//   'Criticizing the video itself',
//   'Defending someone',
// ]

// const STEPS = [
//   'We collect the top and newest comments on each Short.',
//   'A fast sentiment model sets aside clearly positive comments.',
//   'An AI model (Gemma) reads the rest, explains who is being attacked, and decides if it is hostile. It knows fandom slang.',
//   'Each video gets a calm, some, or heavy rating from its share of hostile comments.',
// ]

// const LIMITS = [
//   'Works best on English comments.',
//   'Videos with fewer than 20 comments are not rated.',
//   'Slang changes fast, so new insults can slip through.',
//   'It measures the comment section, not the video itself.',
// ]

// export default function HowWeMeasure() {
//   return (
//     <div className="stack stack--narrow">
//       <Link to="/" className="btn btn--back btn--self-start">
//         <ChevronLeftIcon color="#1F3A2E" />
//         Back
//       </Link>

//       <div className="stack stack--tight">
//         <h1 className="h1 h1--md">How we measure hostility</h1>
//         <p className="lede lede--sm">
//           Prune reads the comments under each Short and estimates how much of the conversation is people tearing
//           someone down.
//         </p>
//       </div>

//       <section className="card" aria-labelledby="counts-heading">
//         <h2 id="counts-heading" className="h3">What counts</h2>
//         <p className="body">
//           A comment counts as hostile when it <strong>demeans, mocks, or attacks a real person</strong> (the creator,
//           an idol, someone in the video) or their fans.
//         </p>
//         <div className="two-col">
//           <div className="list-box list-box--counts">
//             <span className="list-box__title list-box__title--counts">Counts</span>
//             {COUNTS.map((t) => (
//               <span key={t} className="list-box__item">{t}</span>
//             ))}
//           </div>
//           <div className="list-box list-box--ok">
//             <span className="list-box__title list-box__title--ok">Doesn&apos;t count</span>
//             {DOESNT_COUNT.map((t) => (
//               <span key={t} className="list-box__item">{t}</span>
//             ))}
//           </div>
//         </div>
//       </section>

//       <section className="card" aria-labelledby="how-heading">
//         <h2 id="how-heading" className="h3">How it works</h2>
//         <ol className="steps">
//           {STEPS.map((text, i) => (
//             <li key={text} className="step">
//               <span className="step__num">{i + 1}</span>
//               <span className="body">{text}</span>
//             </li>
//           ))}
//         </ol>
//       </section>

//       <section className="card" aria-labelledby="accuracy-heading">
//         <h2 id="accuracy-heading" className="h3">How accurate is it?</h2>
//         <p className="body">We tested it on 98 comments it had never seen, against labels from a human reviewer.</p>
//         <div className="two-col">
//           <div className="metric">
//             <span className="metric__value">4 in 5</span>
//             <span className="metric__label">hostile comments caught</span>
//           </div>
//           <div className="metric">
//             <span className="metric__value">0.58</span>
//             <span className="metric__label">agreement with a human (Cohen&apos;s kappa: moderate)</span>
//           </div>
//         </div>
//         <p className="fine fine--lg">
//           About half of its flags are borderline calls a person might not count. Treat ratings as an estimate, not a
//           verdict.
//         </p>
//       </section>

//       <section className="card" aria-labelledby="limits-heading">
//         <h2 id="limits-heading" className="h3">Limits</h2>
//         {LIMITS.map((t) => (
//           <span key={t} className="body">{t}</span>
//         ))}
//       </section>

//       <div className="privacy">
//         <LockIcon color="#5B6B62" />
//         {/* Placeholder from the design: confirm the privacy wording with your team. */}
//         <span>[Privacy line to confirm with your team, e.g. &quot;Your watch history stays in your browser.&quot;]</span>
//       </div>
//     </div>
//   )
// }

import { Link } from 'react-router-dom'

const steps = [
  {
    title: 'Start a scrolling session',
    description:
      'Use the Prune Chrome extension while watching YouTube Shorts or Instagram Reels. The extension records supported viewing events and available video context.',
  },
  {
    title: 'AI examines each video',
    description:
      'Available metadata and comments help the AI assess content. RoBERTa analyzes comment sentiment, while the content assessment examines the video context.',
  },
  {
    title: 'Topics become branches',
    description:
      'When you finish a session, Prune groups analyzed videos into a topic tree. Related content appears as branches and smaller subtopics.',
  },
  {
    title: 'Tend your garden',
    description:
      'Explore the categories and select See Less for topics you want to reduce. Your choices are saved as preferences for future analysis.',
  },
]

const limitations = [
  'Comment sentiment describes comments, not your emotions.',
  'Some platforms or videos may not provide enough metadata or comments.',
  'AI-generated classifications can be incomplete or inaccurate.',
  'See Less preferences do not directly change platform recommendations.',
]

export default function HowWeMeasure() {
  return (
    <div className="insights-page">
      <header className="journal-heading">
        <span className="botanical-eyebrow">
          ✧ INSIGHTS · HOW WE MEASURE
        </span>

        <h1>What grows here, <em>and how.</em></h1>

        <p>
          A clearer view of your digital habits. Discover how
          Prune turns a scrolling session into a thoughtful,
          interactive garden.
        </p>
      </header>

      <section className="insights-intro journal-card">
        <span className="insights-sprig" aria-hidden="true">❧</span>
        <span className="botanical-eyebrow">YOUR GARDEN</span>
        <h2>A more mindful way to scroll.</h2>
        <p>
          Prune doesn't judge you for what you watch. It helps
          you notice patterns, understand the topics in your
          feed, and decide what you'd like to see less of.
        </p>
        <Link to="/" className="botanical-inline-link">
          Explore your Garden →
        </Link>
      </section>

      <section className="insights-section">
        <div className="insights-section__heading">
          <span className="botanical-eyebrow">THE PROCESS</span>
          <h2>From a scroll to a <em>sprout.</em></h2>
          <p>Four simple steps turn everyday scrolling into reflection.</p>
        </div>

        <div className="insights-steps">
          {steps.map((step, index) => (
            <article className="insights-step" key={step.title}>
              <span className="insights-step__number">
                {String(index + 1).padStart(2, '0')}
              </span>

              <div className="insights-step__decoration" aria-hidden="true">
                {['✧', '❋', '❧', '✿'][index]}
              </div>

              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="insights-section">
        <div className="insights-section__heading">
          <span className="botanical-eyebrow">UNDER THE SURFACE</span>
          <h2>Different insights, <em>different purposes.</em></h2>
        </div>

        <div className="insights-info-grid">
          <article className="journal-card insights-info">
            <div className="insights-info__icon" aria-hidden="true">❦</div>
            <h3>Content context</h3>
            <p>
              The AI reviews available titles, captions, and
              supporting evidence to help explain what the
              video is about and flag potentially unwanted content.
            </p>
          </article>

          <article className="journal-card insights-info">
            <div className="insights-info__icon" aria-hidden="true">✧</div>
            <h3>Comment sentiment</h3>
            <p>
              RoBERTa categorizes available comments as
              positive, neutral, or negative. This describes
              the sampled discussion—not your emotional state.
            </p>
          </article>

          <article className="journal-card insights-info">
            <div className="insights-info__icon" aria-hidden="true">❧</div>
            <h3>Topic discovery</h3>
            <p>
              At the end of a session, related videos are
              grouped into a topic hierarchy that can be
              explored like branches in a garden.
            </p>
          </article>

          <article className="journal-card insights-info">
            <div className="insights-info__icon" aria-hidden="true">✿</div>
            <h3>Your choices</h3>
            <p>
              When you mark a topic as See Less, Prune
              remembers that preference for later review.
              You're always in control of those choices.
            </p>
          </article>
        </div>
      </section>

      <section className="insights-limits journal-card">
        <span className="botanical-eyebrow">A LITTLE TRANSPARENCY</span>
        <h2>What Prune doesn't do</h2>
        <div className="insights-limits__grid">
          {limitations.map(item => (
            <div className="insights-limit" key={item}>
              <span aria-hidden="true">✳</span>
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="insights-cta">
        <span aria-hidden="true">❧</span>
        <h2>Every garden starts somewhere.</h2>
        <p>Curiosity is the first step toward mindful scrolling.</p>
        <Link to="/" className="botanical-primary-btn">
          Visit your Garden →
        </Link>
      </section>
    </div>
  )
}
