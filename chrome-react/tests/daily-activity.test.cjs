const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../public/daily-activity.js');
const { recent, summarize, commentText, insightText } = globalThis.PruneActivity;
const now = Date.parse('2026-10-25T12:00:00Z');
const video = { session_id: 'session', event_id: 'event', video_id: 'same', platform: 'instagram',
  watched_at: '2026-10-25T11:00:00Z', dwell_seconds: 5, assessment: {}, warning_count: 2,
  positive_insight_count: 1, comment_counts: { positive: 4, neutral: 3, negative: 2 } };

test('rolling activity merges buffered updates with analysis without duplicating an encounter', () => {
  const buffered = { session_id: 'session', event: { event_id: 'event', video_id: 'same', platform: 'instagram',
    started_at: video.watched_at, dwell_seconds: 10 } };
  const rows = recent([video], [buffered], now);
  assert.equal(rows.length, 1); assert.equal(rows[0].dwell_seconds, 10);
  assert.equal(rows[0].warning_count, 2);
  assert.deepEqual(summarize(rows).comment_counts, { positive: 4, neutral: 3, negative: 2 });
});

test('rolling activity includes yesterday, excludes expired and future encounters, and preserves replays', () => {
  const rows = recent([video, { ...video, event_id: 'replay' },
    { ...video, event_id: 'yesterday', watched_at: '2026-10-24T13:00:00Z' },
    { ...video, event_id: 'expired', watched_at: '2026-10-24T11:59:59Z' },
    { ...video, event_id: 'future', watched_at: '2026-10-25T12:00:01Z' }], [], now);
  assert.equal(rows.length, 3); assert.equal(summarize(rows).warning_count, 6);
});

test('missing analysis remains unknown instead of becoming a favorable zero', () => {
  const rows = recent([], [{ session_id: 'session', event: { event_id: 'new', video_id: 'new', started_at: video.watched_at } }], now);
  assert.equal(rows[0].warning_count, null); assert.equal(rows[0].comment_counts, null);
  assert.match(insightText(rows[0]), /pending or unavailable/);
  assert.match(commentText(rows[0]), /pending or unavailable/);
  assert.equal(summarize(rows).not_assessed_count, 1);
});
