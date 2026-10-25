"""Synthetic Shorts demo loader. Never modifies the normal local-session database.

Run from backend/: python demo_data.py reset | status | clear
"""
import argparse
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

BASE = Path(__file__).resolve().parent
FIXTURES = BASE / 'fixtures'
DATA = BASE / 'data' / 'demo'
DB = BASE / '.cache' / 'demo_topics.sqlite3'
NAMES = ('videos.json', 'assessments.json', 'sessions.json')
USER = 'demo_extension'


def read(name):
    value = json.loads((DATA / name).read_text(encoding='utf-8'))
    if not isinstance(value, list):
        raise ValueError(f'{name} must contain a JSON list')
    return value


def validate(videos, assessments, sessions):
    vmap = {v['video_id']: v for v in videos}
    amap = {a['video_id']: a for a in assessments}
    if len(vmap) != len(videos) or len(amap) != len(assessments):
        raise ValueError('Duplicate video or assessment IDs')
    if set(vmap) != set(amap):
        raise ValueError('Video and assessment IDs do not match')
    if len({s['session_id'] for s in sessions}) != len(sessions):
        raise ValueError('Duplicate session IDs')
    for s in sessions:
        if not set(s['video_ids']) <= set(vmap):
            raise ValueError(f"Unknown video in {s['session_id']}")
        for topic in s['discovery']['topics']:
            if not set(topic['video_ids']) <= set(s['video_ids']):
                raise ValueError(f"Topic references video outside {s['session_id']}")
    return vmap, amap


def make_video(video, assessment):
    vid = video['video_id']
    comments = [c['text'] if isinstance(c, dict) else str(c) for c in video.get('comments', [])]
    a = dict(assessment)
    a['synthetic'] = True
    a['provider'] = 'synthetic_demo'
    return {
        'video_id': f'youtube:{vid}', 'source_id': vid,
        'video_session_id': f'yt_{vid}', 'platform': 'youtube',
        'synthetic': True, 'title': video.get('title', ''),
        'caption': video.get('caption', ''), 'comments': comments,
        'sentiment_balance': video.get('sentiment_balance'),
        'context_summary': assessment.get('context_summary', ''),
        'dwell_seconds': video.get('watch_duration_seconds', 0), 'watch_count': 1,
        'analysis': {'status': 'complete', 'errors': [],
                     'sentiment': {'sentiment_balance': video.get('sentiment_balance')},
                     'comments': video.get('comments', []), 'assessment': a},
    }


def populate(db_path, videos, assessments, sessions):
    # Import the same schema initializer used by the live app, but with a distinct path.
    from analysis.topic_store import TopicStore
    store = TopicStore(path=db_path)
    vmap, amap = validate(videos, assessments, sessions)
    now = datetime.now(timezone.utc).isoformat()
    with store.connection() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS local_review_jobs (
            id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL,
            videos TEXT NOT NULL DEFAULT '[]', detail TEXT, updated_at TEXT NOT NULL,
            run_id TEXT)''')
        for s in sessions:
            sid = s['session_id']
            topics = {t['key']: t for t in s['discovery']['topics']}
            resolved = {}
            def category_id(key, stack=()):
                if key in resolved:
                    return resolved[key]
                if key in stack or key not in topics:
                    raise ValueError(f'Invalid topic hierarchy: {key}')
                topic = topics[key]
                parent = category_id(topic['parent_key'], stack + (key,)) if topic.get('parent_key') else None
                identity = str(uuid5(NAMESPACE_URL, f'gatorhacks26:demo:{USER}:{key}'))
                conn.execute('''INSERT OR IGNORE INTO categories
                    (id,user_id,name,description,parent_id,merged_into)
                    VALUES (?,?,?,?,?,NULL)''',
                    (identity, USER, topic['name'], topic.get('description', ''), parent))
                resolved[key] = identity
                return identity
            assignments = {}
            for topic in topics.values():
                cid = category_id(topic['key'])
                for raw_id in topic['video_ids']:
                    assignments.setdefault(f'youtube:{raw_id}', set()).add(cid)
            processed = [make_video(vmap[vid], amap[vid]) for vid in s['video_ids']]
            # session_topics is the source for the global tree. Store full video
            # records so the existing TopicStore.view() can build tree_videos.
            result = {
                'session_id': sid, 'status': 'complete', 'synthetic': True,
                'demo': True, 'completed_at': s.get('ended_at', now),
                'assignments': {k: sorted(v) for k, v in assignments.items()},
                'videos': processed, 'errors': [], 'fallback_used': False,
                'unclassified_video_ids': [], 'fallback_video_ids': [],
            }
            conn.execute('INSERT INTO session_topics (session_id,user_id,result) VALUES (?,?,?)',
                         (sid, USER, json.dumps(result)))
            events = [{'event_id': f'{sid}:{vid}', 'video_id': vid,
                       'platform': 'youtube', 'title': vmap[vid].get('title', ''),
                       'caption': vmap[vid].get('caption', ''),
                       'dwell_seconds': vmap[vid].get('watch_duration_seconds', 0)}
                      for vid in s['video_ids']]
            payload = {'events': events, 'instagram': [], 'evidence_manifest': []}
            conn.execute('''INSERT INTO local_review_jobs
                (id,payload,status,videos,detail,updated_at,run_id)
                VALUES (?,?,?,?,?,?,NULL)''',
                (sid, json.dumps(payload), 'complete', json.dumps(processed),
                 'Synthetic demo: precomputed assessments; no models run', now))
    return store


def reset():
    for name in NAMES:
        if not (FIXTURES / name).is_file():
            raise SystemExit(f'Missing fixture: {FIXTURES / name}')
    DATA.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        shutil.copy2(FIXTURES / name, DATA / name)
    videos, assessments, sessions = (read(n) for n in NAMES)
    validate(videos, assessments, sessions)
    DB.parent.mkdir(parents=True, exist_ok=True)
    # Build a complete replacement before changing the active demo database.
    temp = DB.with_suffix('.building.sqlite3')
    temp.unlink(missing_ok=True)
    try:
        populate(temp, videos, assessments, sessions)
        temp.replace(DB)
    finally:
        temp.unlink(missing_ok=True)
    print(f'Demo data successfully reset! {len(videos)} videos, {len(assessments)} assessments, {len(sessions)} sessions.')
    print(f'Demo database: {DB}')


def status():
    for name in NAMES:
        path = DATA / name
        print(f'{name}: {len(read(name))} top-level entries' if path.exists() else f'{name}: missing')
    if DB.exists():
        with sqlite3.connect(DB) as conn:
            categories = conn.execute('SELECT COUNT(*) FROM categories').fetchone()[0]
            sessions = conn.execute('SELECT COUNT(*) FROM session_topics').fetchone()[0]
        print(f'Demo SQLite: {categories} categories, {sessions} session reviews')
    else:
        print('Demo SQLite: not created')


def clear():
    for name in NAMES:
        (DATA / name).unlink(missing_ok=True)
    DB.unlink(missing_ok=True)
    print('Demo files and demo SQLite removed; fixtures and real data preserved.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['reset', 'status', 'clear'])
    command = parser.parse_args().command
    {'reset': reset, 'status': status, 'clear': clear}[command]()
