import { useEffect, useRef, useState } from "react";
import { Sprout, Video as VideoIcon, GitBranch, Clock3 } from 'lucide-react';
import { TopicEditor } from './review/TopicEditor';
import { flatten } from './review/hierarchy';
import { VideoResult } from './review/VideoResult';
import type { Change, Review } from './review/types';
import "./App.css";

type AudioCapture = { recording?: boolean; capturing?: boolean; permission_required?: boolean; pending?: number; detail?: string; incomplete?: boolean; signal_level?: number; last_media_at?: number; captured_seconds?: number; capture_reason?: string };
type AudioBackend = { reachable?: boolean; enabled?: boolean; uploaded_segments?: number; usable_transcript_excerpts?: number; processing_states?: Record<string, number>; excluded_segments?: Record<string, number>; asr?: { model: string; state: string } };
declare function describeAudioStatus(capture: AudioCapture, backend: AudioBackend, enabled: boolean): { label: string; tone: string; detail: string; model: string; counts: string; transcript: string };
type Activity = { durationSeconds: number; videoCount: number; currentVideoId: string | null; currentPlatform: string | null };
const emptyActivity: Activity = { durationSeconds: 0, videoCount: 0, currentVideoId: null, currentPlatform: null };
const available = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

async function request<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!available) throw new Error("Load chrome-react/dist as an unpacked extension to use session controls.");
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.success) throw new Error(response?.error || "The extension could not complete this request.");
  return response.data as T;
}

function App() {
  const [activity, setActivity] = useState<Activity>(emptyActivity);
  const [paused, setPaused] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [audioStatus, setAudioStatus] = useState<AudioCapture>({});
  const [audioBackend, setAudioBackend] = useState<AudioBackend>({});
  const [unfinished, setUnfinished] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(available ? "" : "Build and load chrome-react/dist in Chrome to record and review sessions.");
  const mutating = useRef(false);
  const version = useRef(0);
  const loading = useRef(false);

  useEffect(() => {
    if (!available) return;
    let disposed = false;
    async function load() {
      if (loading.current || mutating.current) return;
      loading.current = true;
      const generation = version.current;
      try {
        const diagnostics = await request<AudioBackend>("AUDIO_DIAGNOSTICS");
        const state = await chrome.storage.local.get(["scrollingSession", "trackingPaused", "localSessionId", "pendingEvents", "finishPending", "audioCaptureEnabled", "audioCaptureStatus"]);
        if (!disposed && generation === version.current) {
          setActivity((state.scrollingSession as Activity) || emptyActivity);
          setPaused(state.trackingPaused !== false);
          setAudioEnabled(state.audioCaptureEnabled !== false);
          setAudioStatus(state.audioCaptureStatus || {});
          setAudioBackend(diagnostics);
          setUnfinished(Boolean(state.finishPending) || Boolean(state.localSessionId) || (Array.isArray(state.pendingEvents) && state.pendingEvents.length > 0));
        }
        const result = await request<Review | null>("SESSION_TAXONOMY");
        if (!disposed && generation === version.current) {
          setReview(result);
          setError("");
        }
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not load the session."); }
      finally { loading.current = false; }
    }
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);

  async function mutate(action: () => Promise<void>) {
    setBusy(true); mutating.current = true; version.current++; setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Session request failed."); }
    finally { setBusy(false); mutating.current = false; }
  }
  async function finish() { await mutate(async () => { await request("FINISH_SESSION"); setPaused(true); setUnfinished(false); setReview(await request<Review>("SESSION_TAXONOMY")); }); }
  async function start() { await mutate(async () => { await request("START_SESSION"); setPaused(false); setUnfinished(true); setActivity(emptyActivity); }); }
  async function select(id: string, reduce: boolean) { await mutate(async () => setReview(await request<Review>("TOPIC_PREFERENCE", { category_id: id, reduce }))); }
  async function edit(id: string, change: Change) { await mutate(async () => setReview(await request<Review>("EDIT_TOPIC_CATEGORY", { category_id: id, change }))); }
  async function moveVideo(id: string, category: string) { await mutate(async () => setReview(await request<Review>('MOVE_TOPIC_VIDEO', { video_id: id, category_id: category }))); }
  async function retry() { await mutate(async () => { await request("RETRY_SESSION_TAXONOMY"); setReview(current => current ? { ...current, status: "pending" } : current); }); }
  async function resetTree() {
    if (!window.confirm("Reset the entire saved tree? All categories, video memberships, and See less preferences will be removed. Individual video analyses are kept.")) return;
    await mutate(async () => { await request("RESET_TOPIC_TREE"); setReview(await request<Review | null>("SESSION_TAXONOMY")); });
  }
  const options = flatten(review?.tree || []);
  const assignments = review?.tree_assignments || review?.assignments || {};
  const videos = new Map([...(review?.tree_videos || []), ...(review?.videos || [])].map(video => [video.video_id, video]));
  const processing = review && ["pending", "processing"].includes(review.status);
  const audioDisplay = describeAudioStatus(audioStatus, audioBackend, audioEnabled);

  const fullPage = new URLSearchParams(window.location.search).get("view") === "summary";
  return <main className={fullPage ? "app review-page" : "app"}>
    <header className="review-header"><div className="review-brand"><Sprout size={25} aria-hidden="true" />Prune <span className="review-kicker">Latest review</span></div>
      <h1>Your session, in focus</h1><p className="subtitle">Explore what you watched. Shape what grows next.</p>
    </header>
    <div className="review-stats">
      <div><VideoIcon size={17} aria-hidden="true" /><span>Session videos</span><strong>{review?.video_count ?? activity.videoCount}</strong></div>
      <div><GitBranch size={17} aria-hidden="true" /><span>Saved topics</span><strong>{options.length}</strong></div>
      <div><Clock3 size={17} aria-hidden="true" /><span>Time scrolling</span><strong>{Math.floor(activity.durationSeconds / 60)}:{Math.floor(activity.durationSeconds % 60).toString().padStart(2, '0')}</strong></div>
    </div>
    <details className="stat-card session-controls"><summary>Session controls <span>{paused ? 'Paused' : 'Recording'}</span></summary><div>
    <section className="stat-card"><span>{paused ? unfinished ? "Session paused; finish pending" : "Session ended" : "Recording activity"}</span><h2>{Math.floor(activity.durationSeconds / 60)}:{Math.floor(activity.durationSeconds % 60).toString().padStart(2, "0")}</h2><p>{activity.videoCount} videos encountered</p>
      <button disabled={!available || busy || (paused && !unfinished)} onClick={() => void finish()}>{busy ? "Working..." : "Finish and review session"}</button>
      {paused && !unfinished && <button disabled={busy} onClick={() => void start()}>Start a new session</button>}
      <div className="audio-monitor"><strong className={`audio-state ${audioDisplay.tone}`}>{audioDisplay.label}</strong>
      <label><input type="checkbox" checked={audioEnabled} disabled={busy || audioStatus.recording} onChange={event => { setAudioEnabled(event.target.checked); void chrome.storage.local.set({ audioCaptureEnabled: event.target.checked }); }} />Include video audio</label>
      <button disabled={!available || busy || (!audioStatus.recording && (!audioEnabled || paused))} onClick={() => void mutate(async () => { await request(audioStatus.recording ? "CAPTURE_STOP" : "CAPTURE_START"); setAudioStatus({ recording: !audioStatus.recording }); })}>{audioStatus.recording ? "Stop audio capture" : "Capture selected tab audio"}</button>
      <p role="status">{audioDisplay.detail}</p><p>{audioDisplay.model}</p><p>{audioDisplay.counts}</p><p>{audioDisplay.transcript}</p></div>
    </section>
    </div></details>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="stat-card"><h2>Your topic tree</h2><p>Saved across sessions. New sessions add videos to existing categories and grow new branches when needed.</p>
      <button className="button--danger" disabled={!available || busy || !!processing} onClick={() => void resetTree()}>Reset entire tree</button>
      {!review && <p>Finish a scrolling session to discover related topics. Videos are assessed individually without topic labels while you scroll.</p>}
      {review && available && !fullPage && <button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?view=summary") })}>Open full summary</button>}
      {processing && <p role="status">Analyzed {review.analyzed_count ?? review.videos.length} of {review.video_count ?? review.videos.length} videos. Updating your saved tree. You can close this popup and come back.</p>}
      {review?.detail && <p className="analysis-note" role="status">{review.detail}</p>}
      {review?.fallback_used && <p className="fallback" role="status">Gemini fallback used for part or all of this classification.</p>}
      {review && <><p>{review.global_video_count ?? review.videos.length} unique videos across sessions. Expand a category and select <strong>See less</strong> using its checkbox. Selecting a parent includes its descendants.</p>
        {review.tree.length > 0 ? <TopicEditor roots={review.tree} videos={videos} assignments={assignments} busy={busy} select={select} edit={edit} moveVideo={moveVideo} /> : <p>No supported topic grouping is available yet.</p>}
        {(review.fallback_video_ids?.length || 0) > 0 && <p className="analysis-note">{review.fallback_video_ids!.length} videos received a General / Other classification because a reliable topic was unavailable. Every video is included in the tree.</p>}
        {(review.unclassified_video_ids?.length || 0) > 0 && <details><summary>{review.unclassified_video_ids!.length} videos without a supported topic</summary><ul>{review.unclassified_video_ids!.map(id => <li key={id}>{videos.get(id)?.title || id}</li>)}</ul></details>}
        <p>{review.reduce_video_ids?.length || 0} videos match your saved see-less preferences. Preferences are saved for future matching; this does not change YouTube or Instagram recommendations directly.</p>
        {review.errors?.map((issue, index) => <p className="error" key={index}>{issue.detail}</p>)}
        {["failed", "partial"].includes(review.status) && <button disabled={busy} onClick={() => void retry()}>Retry incomplete classification</button>}
        <details><summary>Session JSON</summary><pre>{JSON.stringify(review, null, 2)}</pre></details>
      </>}
    </section>
    {review && <section className="stat-card"><h2>This session's video results</h2><p>{review.videos.length} results available{processing ? " so far" : ""}. Open a result for its full assessment, evidence, comments, and raw data.</p>
      {review.videos.length ? <ol className="video-results">{review.videos.map(video => <VideoResult key={video.video_id} video={video} categories={options} assignments={assignments[video.video_id]} busy={busy} move={(id, category) => { void moveVideo(id, category) }} />)}</ol> : <p>{processing ? "The first video is being analyzed." : "This session has no analyzed videos."}</p>}
    </section>}
  </main>;
}

export default App;
