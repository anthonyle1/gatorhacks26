import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

type Topic = { id: string; name: string; description: string; parent_id: string | null; video_count: number; video_ids: string[]; children: Topic[]; selected: boolean; inherited: boolean; reduce: boolean };
type Sentiment = { total_comments: number; counts: { positive: number; neutral: number; negative: number }; sentiment_balance: number | null };
type Assessment = { negative_for_user: string; reason: string; context_summary: string; content_signals: { id: string; evidence: string }[]; provider: string; model: string | null; fallback_used: boolean };
type Video = { video_id: string; title: string; caption?: string; platform: string; source_id: string; dwell_seconds?: number; watch_count?: number; analysis?: { status: string; sentiment: Sentiment | null; assessment?: Assessment; comments: { text: string; sentiment: string; confidence: number }[]; errors: string[] } };
function videoUrl(video: Video) { return video.platform === "youtube" ? `https://www.youtube.com/watch?v=${encodeURIComponent(video.source_id)}` : `https://www.instagram.com/reel/${encodeURIComponent(video.source_id)}/`; }
function VideoLink({ video, id }: { video?: Video; id: string }) { return video ? <a href={videoUrl(video)} target="_blank" rel="noreferrer">{video.title || video.source_id}</a> : <span>{id}</span>; }
function VideoResult({ video }: { video: Video }) {
  const analysis = video.analysis;
  const assessment = analysis?.assessment;
  const sentiment = analysis?.sentiment;
  return <li className="video-result"><h3><VideoLink video={video} id={video.video_id} /></h3>
    <p className="video-meta">{video.platform} ? {Math.round(video.dwell_seconds || 0)} seconds ? {video.watch_count || 1} views</p>
    {assessment ? <><p><strong>Negative impact: {assessment.negative_for_user.toUpperCase()}</strong></p><p>{assessment.reason}</p><p>{assessment.context_summary}</p><small>{assessment.provider} / {assessment.model}{assessment.fallback_used ? " ? Gemini fallback used" : ""}</small>
      {assessment.content_signals.length > 0 && <ul>{assessment.content_signals.map(signal => <li key={signal.id}><strong>{signal.id.replaceAll("_", " ")}</strong>: {signal.evidence}</li>)}</ul>}
    </> : <p>No content assessment available.</p>}
    {sentiment ? <><p>{sentiment.total_comments} comments analyzed: {sentiment.counts.positive} positive, {sentiment.counts.negative} negative, {sentiment.counts.neutral} neutral.</p><p>Sentiment balance: {sentiment.sentiment_balance === null ? "No positive or negative comments" : sentiment.sentiment_balance.toFixed(2)}</p></> : <p>Comment sentiment unavailable.</p>}
    {analysis?.errors.map((issue, index) => <p className="analysis-note" key={index}>{issue}</p>)}
    {(analysis?.comments.length || 0) > 0 && <details><summary>Analyzed comment sample</summary><ul>{analysis!.comments.map((comment, index) => <li key={index}>{comment.text} <small>({comment.sentiment}, {Math.round(comment.confidence * 100)}%)</small></li>)}</ul></details>}
    <details><summary>Video analysis JSON</summary><pre>{JSON.stringify(video, null, 2)}</pre></details>
  </li>;
}
type Review = { video_count?: number; global_video_count?: number; tree_videos?: Video[]; analyzed_count?: number; offline?: boolean; session_id: string; status: string; tree: Topic[]; videos: Video[]; fallback_used: boolean; unclassified_video_ids?: string[]; fallback_video_ids?: string[]; reduce_video_ids?: string[]; detail?: string; errors?: {detail: string}[] };
type Activity = { durationSeconds: number; videoCount: number; currentVideoId: string | null; currentPlatform: string | null };
const emptyActivity: Activity = { durationSeconds: 0, videoCount: 0, currentVideoId: null, currentPlatform: null };
const available = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

async function request<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!available) throw new Error("Load chrome-react/dist as an unpacked extension to use session controls.");
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.success) throw new Error(response?.error || "The extension could not complete this request.");
  return response.data as T;
}

function flatten(nodes: Topic[]): Topic[] { return nodes.flatMap(node => [node, ...flatten(node.children)]); }

type Change = { name?: string; parent_id?: string | null; move?: boolean; merge_into?: string };
function CategoryEditor({ node, options, busy, edit }: { node: Topic; options: Topic[]; busy: boolean; edit: (id: string, change: Change) => Promise<void> }) {
  const [name, setName] = useState(node.name);
  const [parent, setParent] = useState(node.parent_id || "");
  const [target, setTarget] = useState("");
  function rename(event: FormEvent) { event.preventDefault(); void edit(node.id, { name: name.trim() }); }
  return <details className="category-editor"><summary>Manage category</summary>
    <form onSubmit={rename}><label>Display name<input value={name} maxLength={80} required onChange={event => setName(event.target.value)} /></label><button disabled={busy || !name.trim()}>Rename</button></form>
    <label>Move branch under<select value={parent} onChange={event => setParent(event.target.value)}><option value="">Top level</option>{options.filter(option => option.id !== node.id).map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>
    <button disabled={busy} onClick={() => void edit(node.id, { parent_id: parent || null, move: true })}>Move branch</button>
    <label>Merge this category into<select value={target} onChange={event => setTarget(event.target.value)}><option value="">Choose a matching category</option>{options.filter(option => option.id !== node.id).map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>
    <button disabled={busy || !target} onClick={() => void edit(node.id, { merge_into: target })}>Merge and preserve preferences</button>
  </details>;
}

function TopicBranch({ node, options, videos, busy, select, edit }: { node: Topic; options: Topic[]; videos: Map<string, Video>; busy: boolean; select: (id: string, reduce: boolean) => Promise<void>; edit: (id: string, change: Change) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const directIds = node.video_ids.filter(id => !node.children.some(child => child.video_ids.includes(id)));
  return <li className={node.reduce ? "topic reduced" : "topic"}><details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><input type="checkbox" checked={node.reduce} disabled={busy || node.inherited} aria-label={`See less ${node.name}`} onClick={event => event.stopPropagation()} onChange={event => void select(node.id, event.target.checked)} /> <strong>{node.name}</strong> <span>{node.video_count} {node.video_count === 1 ? "video" : "videos"}</span>{node.inherited && <small>Included by parent</small>}</summary>
    {open && <div className="topic-body"><p>{node.description}</p>
      {node.children.length > 0 && <ul>{node.children.map(child => <TopicBranch key={child.id} node={child} options={options} videos={videos} busy={busy} select={select} edit={edit} />)}</ul>}
      <ul className="branch-videos">{directIds.map(id => <li key={id}><VideoLink video={videos.get(id)} id={id} /></li>)}</ul>
      <CategoryEditor node={node} options={options} busy={busy} edit={edit} />
    </div>}
  </details></li>;
}

function App() {
  const [activity, setActivity] = useState<Activity>(emptyActivity);
  const [paused, setPaused] = useState(true);
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
        const state = await chrome.storage.local.get(["scrollingSession", "trackingPaused", "localSessionId", "pendingEvents", "finishPending"]);
        if (!disposed && generation === version.current) {
          setActivity((state.scrollingSession as Activity) || emptyActivity);
          setPaused(state.trackingPaused !== false);
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
  async function retry() { await mutate(async () => { await request("RETRY_SESSION_TAXONOMY"); setReview(current => current ? { ...current, status: "pending" } : current); }); }
  async function resetTree() {
    if (!window.confirm("Reset the entire saved tree? All categories, video memberships, and See less preferences will be removed. Individual video analyses are kept.")) return;
    await mutate(async () => { await request("RESET_TOPIC_TREE"); setReview(await request<Review | null>("SESSION_TAXONOMY")); });
  }
  const options = flatten(review?.tree || []);
  const videos = new Map([...(review?.tree_videos || []), ...(review?.videos || [])].map(video => [video.video_id, video]));
  const processing = review && ["pending", "processing"].includes(review.status);

  const fullPage = new URLSearchParams(window.location.search).get("view") === "summary";
  return <main className={fullPage ? "app review-page" : "app"}><h1>Healthy Doomscrolling</h1><p className="subtitle">Review your session. Shape what comes next.</p>
    <section className="stat-card"><span>{paused ? unfinished ? "Session paused; finish pending" : "Session ended" : "Recording activity"}</span><h2>{Math.floor(activity.durationSeconds / 60)}:{Math.floor(activity.durationSeconds % 60).toString().padStart(2, "0")}</h2><p>{activity.videoCount} videos encountered</p>
      <button disabled={!available || busy || (paused && !unfinished)} onClick={() => void finish()}>{busy ? "Working..." : "Finish and review session"}</button>
      {paused && !unfinished && <button disabled={busy} onClick={() => void start()}>Start a new session</button>}
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="stat-card"><h2>Your topic tree</h2><p>Saved across sessions. New sessions add videos to existing categories and grow new branches when needed.</p>
      <button disabled={!available || busy || !!processing} onClick={() => void resetTree()}>Reset entire tree</button>
      {!review && <p>Finish a scrolling session to discover related topics. Videos are assessed individually without topic labels while you scroll.</p>}
      {review && available && !fullPage && <button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?view=summary") })}>Open full summary</button>}
      {processing && <p role="status">Analyzed {review.analyzed_count ?? review.videos.length} of {review.video_count ?? review.videos.length} videos. Updating your saved tree. You can close this popup and come back.</p>}
      {review?.detail && <p className="analysis-note" role="status">{review.detail}</p>}
      {review?.fallback_used && <p className="fallback" role="status">Gemini fallback used for part or all of this classification.</p>}
      {review && <><p>{review.global_video_count ?? review.videos.length} unique videos across sessions. Expand a category and select <strong>See less</strong> using its checkbox. Selecting a parent includes its descendants.</p>
        {review.tree.length > 0 ? <ul className="topic-tree">{review.tree.map(node => <TopicBranch key={node.id} node={node} options={options} videos={videos} busy={busy} select={select} edit={edit} />)}</ul> : <p>No supported topic grouping is available yet.</p>}
        {(review.fallback_video_ids?.length || 0) > 0 && <p className="analysis-note">{review.fallback_video_ids!.length} videos received a General / Other classification because a reliable topic was unavailable. Every video is included in the tree.</p>}
        {(review.unclassified_video_ids?.length || 0) > 0 && <details><summary>{review.unclassified_video_ids!.length} videos without a supported topic</summary><ul>{review.unclassified_video_ids!.map(id => <li key={id}>{videos.get(id)?.title || id}</li>)}</ul></details>}
        <p>{review.reduce_video_ids?.length || 0} videos match your saved see-less preferences. Preferences are saved for future matching; this does not change YouTube or Instagram recommendations directly.</p>
        {review.errors?.map((issue, index) => <p className="error" key={index}>{issue.detail}</p>)}
        {["failed", "partial"].includes(review.status) && <button disabled={busy} onClick={() => void retry()}>Retry incomplete classification</button>}
        <details><summary>Session JSON</summary><pre>{JSON.stringify(review, null, 2)}</pre></details>
      </>}
    </section>
    {review && <section className="stat-card"><h2>This session's video results</h2><p>{review.videos.length} results available{processing ? " so far" : ""}. Expand a result to inspect its comments or JSON.</p>
      {review.videos.length ? <ol className="video-results">{review.videos.map(video => <VideoResult key={video.video_id} video={video} />)}</ol> : <p>{processing ? "The first video is being analyzed." : "This session has no analyzed videos."}</p>}
    </section>}
  </main>;
}

export default App;
