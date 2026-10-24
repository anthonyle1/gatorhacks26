import { Link } from 'react-router-dom'
import { ChevronLeftIcon, LockIcon } from '../components/icons'

const COUNTS = [
  'Talent-shaming',
  'Looks and body shaming',
  'Insults and name-calling',
  'Fan wars',
  'Sarcastic put-downs',
]

const DOESNT_COUNT = [
  'Praise slang ("ate", "slay")',
  'Laughing, 💀, excited swearing',
  'Sadness or sympathy',
  'Criticizing the video itself',
  'Defending someone',
]

const STEPS = [
  'We collect the top and newest comments on each Short.',
  'A fast sentiment model sets aside clearly positive comments.',
  'An AI model (Gemma) reads the rest, explains who is being attacked, and decides if it is hostile. It knows fandom slang.',
  'Each video gets a calm, some, or heavy rating from its share of hostile comments.',
]

const LIMITS = [
  'Works best on English comments.',
  'Videos with fewer than 20 comments are not rated.',
  'Slang changes fast, so new insults can slip through.',
  'It measures the comment section, not the video itself.',
]

export default function HowWeMeasure() {
  return (
    <div className="stack stack--narrow">
      <Link to="/" className="btn btn--back btn--self-start">
        <ChevronLeftIcon color="#1F3A2E" />
        Back
      </Link>

      <div className="stack stack--tight">
        <h1 className="h1 h1--md">How we measure hostility</h1>
        <p className="lede lede--sm">
          Prune reads the comments under each Short and estimates how much of the conversation is people tearing
          someone down.
        </p>
      </div>

      <section className="card" aria-labelledby="counts-heading">
        <h2 id="counts-heading" className="h3">What counts</h2>
        <p className="body">
          A comment counts as hostile when it <strong>demeans, mocks, or attacks a real person</strong> (the creator,
          an idol, someone in the video) or their fans.
        </p>
        <div className="two-col">
          <div className="list-box list-box--counts">
            <span className="list-box__title list-box__title--counts">Counts</span>
            {COUNTS.map((t) => (
              <span key={t} className="list-box__item">{t}</span>
            ))}
          </div>
          <div className="list-box list-box--ok">
            <span className="list-box__title list-box__title--ok">Doesn&apos;t count</span>
            {DOESNT_COUNT.map((t) => (
              <span key={t} className="list-box__item">{t}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="how-heading">
        <h2 id="how-heading" className="h3">How it works</h2>
        <ol className="steps">
          {STEPS.map((text, i) => (
            <li key={text} className="step">
              <span className="step__num">{i + 1}</span>
              <span className="body">{text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="accuracy-heading">
        <h2 id="accuracy-heading" className="h3">How accurate is it?</h2>
        <p className="body">We tested it on 98 comments it had never seen, against labels from a human reviewer.</p>
        <div className="two-col">
          <div className="metric">
            <span className="metric__value">4 in 5</span>
            <span className="metric__label">hostile comments caught</span>
          </div>
          <div className="metric">
            <span className="metric__value">0.58</span>
            <span className="metric__label">agreement with a human (Cohen&apos;s kappa: moderate)</span>
          </div>
        </div>
        <p className="fine fine--lg">
          About half of its flags are borderline calls a person might not count. Treat ratings as an estimate, not a
          verdict.
        </p>
      </section>

      <section className="card" aria-labelledby="limits-heading">
        <h2 id="limits-heading" className="h3">Limits</h2>
        {LIMITS.map((t) => (
          <span key={t} className="body">{t}</span>
        ))}
      </section>

      <div className="privacy">
        <LockIcon color="#5B6B62" />
        {/* Placeholder from the design: confirm the privacy wording with your team. */}
        <span>[Privacy line to confirm with your team, e.g. &quot;Your watch history stays in your browser.&quot;]</span>
      </div>
    </div>
  )
}
