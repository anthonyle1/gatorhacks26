import { AlertTriangle, ChartNoAxesColumnIncreasing, ClipboardCheck, MessageCircle } from 'lucide-react'
import type { scaleTopicRisks } from './risk'

export default function RiskOverview({ risk }: { risk: ReturnType<typeof scaleTopicRisks>[number] }) {
  const relative = risk.colorScore === null ? 'Not yet analyzed' : risk.colorScore < 1 / 3 ? 'Lower signals' : risk.colorScore < 2 / 3 ? 'Moderate signals' : 'Higher signals'
  return <div className="topic-overview">
    <div className="topic-overview__status">
      <span className="topic-overview__badge" style={{ backgroundColor: risk.fill }}>
        <ChartNoAxesColumnIncreasing size={13} aria-hidden="true" />{relative}
      </span>
      <span className="topic-overview__context">{risk.colorScore === null ? 'Analysis unavailable' : 'Relative to your tree'}</span>
    </div>
    <dl className="topic-overview__metrics">
      <div>
        <dt><AlertTriangle size={14} aria-hidden="true" />Warnings</dt>
        <dd>{risk.warningVideos ? risk.warnings : '—'}</dd>
        <span>{risk.warningVideos ? `${risk.warningVideos} videos assessed` : 'No assessment'}</span>
      </div>
      <div>
        <dt><MessageCircle size={14} aria-hidden="true" />Negative</dt>
        <dd>{risk.comments ? risk.negative : '—'}</dd>
        <span>{risk.comments ? `of ${risk.comments} comments` : 'No comment data'}</span>
      </div>
      <div>
        <dt><ClipboardCheck size={14} aria-hidden="true" />Coverage</dt>
        <dd>{risk.rated}<small>/{risk.totalVideos}</small></dd>
        <span>videos analyzed</span>
      </div>
    </dl>
    <p className="topic-overview__footnote">Includes child topics · {risk.score === null ? 'Score unavailable' : `Signal score ${Math.round(risk.score * 100)}/100`}</p>
  </div>
}

