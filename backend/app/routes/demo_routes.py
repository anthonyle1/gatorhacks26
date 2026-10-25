"""Read-only API for precomputed synthetic Shorts demo data."""
from pathlib import Path
from fastapi import APIRouter, HTTPException
from analysis.topic_store import TopicStore

router = APIRouter(prefix='/demo', tags=['Synthetic demo'])
DB = Path(__file__).resolve().parents[2] / '.cache' / 'demo_topics.sqlite3'
USER = 'demo_extension'


def store():
    if not DB.is_file():
        raise HTTPException(404, 'Demo database missing. Run python demo_data.py reset')
    return TopicStore(path=DB)


@router.get('/taxonomy')
def demo_taxonomy():
    return store().view('global-tree', USER) or {
        'tree': [], 'tree_videos': [], 'global_video_count': 0,
        'selected_category_ids': [], 'tree_scope': 'global', 'synthetic': True,
    }


@router.get('/sessions')
def demo_sessions():
    with store().connection() as conn:
        rows = conn.execute('SELECT id,status FROM local_review_jobs ORDER BY id').fetchall()
    return {'synthetic': True, 'sessions': [dict(row) for row in rows]}


@router.get('/sessions/{session_id}/taxonomy')
def demo_session_taxonomy(session_id: str):
    database = store()
    with database.connection() as conn:
        row = conn.execute('SELECT videos,status FROM local_review_jobs WHERE id=?', (session_id,)).fetchone()
    if row is None:
        raise HTTPException(404, 'Demo session not found')
    import json
    result = database.view(session_id, USER)
    result.update(videos=json.loads(row['videos']), status=row['status'],
                  synthetic=True, storage='demo',
                  analyzed_count=len(json.loads(row['videos'])),
                  local_analysis_count=len(json.loads(row['videos'])))
    return result
