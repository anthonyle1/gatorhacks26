import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

type Topic = { id: string; name: string; description: string; parent_id: string | null; video_count: number; video_ids: string[]; children: Topic[]; selected: boolean; inherited: boolean; reduce: boolean };
type Video = { video_id: string; title: string; platform: string; source_id: string };
type Review = { session_id: string; status: string; tree: Topic[]; videos: Video[]; fallback_used: boolean; unclassified_video_ids?: string[]; reduce_video_ids?: string[]; detail?: string; errors?: {detail: string}[] };
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
  return <li className={node.reduce ? "topic reduced" : "topic"}><details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><input type="checkbox" checked={node.reduce} disabled={busy || node.inherited} aria-label={`See less ${node.name}`} onClick={event => event.stopPropagation()} onChange={event => void select(node.id, event.target.checked)} /> <strong>{node.name}</strong> <span>{node.video_count} {node.video_count === 1 ? "video" : "videos"}</span>{node.inherited && <small>Included by parent</small>}</summary>
    {open && <div className="topic-body"><p>{node.description}</p>
      {node.children.length > 0 && <ul>{node.children.map(child => <TopicBranch key={child.id} node={child} options={options} videos={videos} busy={busy} select={select} edit={edit} />)}</ul>}
      <details><summary>Videos in this branch</summary><ul>{node.video_ids.map(id => <li key={id}>{videos.get(id)?.title || id}</li>)}</ul></details>
      <CategoryEditor node={node} options={options} busy={busy} edit={edit} />
    </div>}
  </details></li>;
}

function App() {
  const [activity, setActivity] = useState<Activity>(emptyActivity);
  const [paused, setPaused] = useState(false);
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
        const state = await chrome.storage.local.get(["scrollingSession", "trackingPaused", "backendSessionId", "pendingEvents", "finishPending"]);
        if (!disposed && generation === version.current) {
          setActivity((state.scrollingSession as Activity) || emptyActivity);
          setPaused(Boolean(state.trackingPaused));
          setUnfinished(Boolean(state.finishPending) || Boolean(state.backendSessionId) || (Array.isArray(state.pendingEvents) && state.pendingEvents.length > 0));
        }
        const result = await request<Review | null>("SESSION_TAXONOMY");
        if (!disposed && generation === version.current) {
          setReview(result);
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
  const options = flatten(review?.tree || []);
  const videos = new Map((review?.videos || []).map(video => [video.video_id, video]));
  const processing = review && ["pending", "processing"].includes(review.status);

  return <main className="app"><h1>Healthy Doomscrolling</h1><p className="subtitle">Review your session. Shape what comes next.</p>
    <section className="stat-card"><span>{paused ? unfinished ? "Session paused; finish pending" : "Session ended" : "Recording activity"}</span><h2>{Math.floor(activity.durationSeconds / 60)}:{Math.floor(activity.durationSeconds % 60).toString().padStart(2, "0")}</h2><p>{activity.videoCount} videos encountered</p>
      <button disabled={!available || busy || (paused && !unfinished)} onClick={() => void finish()}>{busy ? "Working..." : "Finish and review session"}</button>
      {paused && !unfinished && <button disabled={busy} onClick={() => void start()}>Start a new session</button>}
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="stat-card"><h2>Your session topics</h2>
      {!review && <p>Finish a scrolling session to discover related topics. Videos are assessed individually without topic labels while you scroll.</p>}
      {processing && <p role="status">Building your topic tree from the completed session. You can close this popup and come back.</p>}
      {review?.fallback_used && <p className="fallback" role="status">Gemini fallback used for part or all of this classification.</p>}
      {review && !processing && <><p>{review.videos.length} unique videos reviewed. Expand a category and select <strong>See less</strong> using its checkbox. Selecting a parent includes its descendants.</p>
        {review.tree.length > 0 ? <ul className="topic-tree">{review.tree.map(node => <TopicBranch key={node.id} node={node} options={options} videos={videos} busy={busy} select={select} edit={edit} />)}</ul> : <p>No supported topic grouping is available yet.</p>}
        {(review.unclassified_video_ids?.length || 0) > 0 && <details><summary>{review.unclassified_video_ids!.length} videos without a supported topic</summary><ul>{review.unclassified_video_ids!.map(id => <li key={id}>{videos.get(id)?.title || id}</li>)}</ul></details>}
        <p>{review.reduce_video_ids?.length || 0} videos match your saved see-less preferences. Preferences are saved for future matching; this does not change YouTube or Instagram recommendations directly.</p>
        {review.errors?.map((issue, index) => <p className="error" key={index}>{issue.detail}</p>)}
        {review.detail && <p className="error">{review.detail}</p>}
        {["failed", "partial"].includes(review.status) && <button disabled={busy} onClick={() => void retry()}>Retry incomplete classification</button>}
        <details><summary>Session JSON</summary><pre>{JSON.stringify(review, null, 2)}</pre></details>
      </>}
    </section>
  </main>;
}

export default App;
