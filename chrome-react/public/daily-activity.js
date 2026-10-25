/* Shared presentation of completed and locally buffered viewing encounters. */
(() => {
  function recent(videos = [], local = [], now = Date.now()) {
    const rows = new Map(videos.map(video => [`${video.session_id}:${video.event_id}`, video]));
    for (const row of local) {
      const key = `${row.session_id}:${row.event.event_id}`;
      const old = rows.get(key);
      const event = row.event;
      rows.set(key, { ...old, session_id: row.session_id, event_id: event.event_id,
        video_id: event.video_id, platform: event.platform, title: old?.title || event.title || event.video_id,
        watched_at: event.started_at, dwell_seconds: Math.max(old?.dwell_seconds || 0, event.dwell_seconds || 0),
        assessment: old?.assessment || null, warning_count: old?.warning_count ?? null,
        positive_insight_count: old?.positive_insight_count ?? null, comment_counts: old?.comment_counts || null });
    }
    return [...rows.values()].filter(video => {
      const timestamp = Date.parse(video.watched_at);
      return timestamp >= now - 86400000 && timestamp <= now;
    }).sort((a, b) => Date.parse(a.watched_at) - Date.parse(b.watched_at));
  }

  function summarize(videos) {
    return {
      videos_watched: videos.length,
      watch_seconds: videos.reduce((sum, video) => sum + (video.dwell_seconds || 0), 0),
      warning_count: videos.reduce((sum, video) => sum + (video.warning_count || 0), 0),
      positive_insight_count: videos.reduce((sum, video) => sum + (video.positive_insight_count || 0), 0),
      not_assessed_count: videos.filter(video => !video.assessment).length,
      comment_counts: Object.fromEntries(['positive', 'neutral', 'negative'].map(label =>
        [label, videos.reduce((sum, video) => sum + (video.comment_counts?.[label] || 0), 0)])),
    };
  }

  function insightText(video) {
    return video.warning_count == null ? 'Content insights pending or unavailable' :
      `${video.warning_count} warnings · ${video.positive_insight_count} positive insights`;
  }
  function commentText(video) {
    const counts = video.comment_counts;
    return counts ? `Comments: ${counts.positive} positive · ${counts.neutral} neutral · ${counts.negative} negative` :
      'Comment analysis pending or unavailable';
  }
  globalThis.PruneActivity = { recent, summarize, insightText, commentText };
})();
