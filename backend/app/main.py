import asyncio
from contextlib import asynccontextmanager, suppress
import logging
import os
import sqlite3
import httpx

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pymongo.errors import PyMongoError

from app.youtube import router as youtube_router
from app.instagram import router as instagram_router
from app.database import ping_database
from app.routes.sessions import router as sessions_router
from app.routes.videos import router as videos_router
from analysis.routes import router as analysis_router
from app.services.session_analysis import recover_session_jobs
from app.routes.local_sessions import router as local_sessions_router
from app.services.local_sessions import recover_local_sessions

# Load environment variables
load_dotenv()

# Initialize FastAPI
@asynccontextmanager
async def lifespan(application):
    workers = [asyncio.create_task(recover_local_sessions())]
    if os.getenv("MONGODB_SESSION_JOBS_ENABLED", "false").lower() == "true":
        workers.append(asyncio.create_task(recover_session_jobs()))
    try:
        yield
    finally:
        for worker in workers:
            worker.cancel()
        for worker in workers:
            with suppress(asyncio.CancelledError):
                await worker


app = FastAPI(title="Healthy Doomscrolling API", lifespan=lifespan)
logger = logging.getLogger(__name__)


@app.exception_handler(PyMongoError)
async def database_error_handler(request: Request, exc: PyMongoError):
    logger.warning("Database request failed (%s)", type(exc).__name__)
    return JSONResponse(status_code=503, content={"detail": "Database unavailable. Check MongoDB connectivity and Atlas network access."})


@app.exception_handler(sqlite3.Error)
async def topic_storage_error(request: Request, exc: sqlite3.Error):
    logger.warning("Topic storage unavailable (%s)", type(exc).__name__)
    return JSONResponse(status_code=503, content={"detail": "Persistent topic storage is unavailable."})

app.include_router(sessions_router)
app.include_router(local_sessions_router)
app.include_router(youtube_router)
app.include_router(analysis_router)
app.include_router(instagram_router)
app.include_router(videos_router)

@app.get("/")
def root():
    return {
        "message": "Healthy Doomscrolling API",
        "status": "running"
    }

# YouTube API key
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")


# ==========================================
# Database Health Check
# ==========================================

@app.get("/health")
async def health():
    try:
        async with asyncio.timeout(5):
            await ping_database()

        return {
            "status": "ok",
            "database": "connected"
        }

    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Database unavailable"
        )


# ==========================================
# Get YouTube Video Information
# ==========================================

@app.get("/youtube/video/{video_id}")
async def get_video(video_id: str):

    if not YOUTUBE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="YouTube API key not configured"
        )

    url = "https://www.googleapis.com/youtube/v3/videos"

    params = {
        "part": "snippet,statistics",
        "id": video_id,
        "key": YOUTUBE_API_KEY
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                url,
                params=params
            )

            response.raise_for_status()

        data = response.json()

        if not data.get("items"):
            raise HTTPException(
                status_code=404,
                detail="Video not found"
            )

        video = data["items"][0]

        return {
            "video_id": video["id"],
            "title": video["snippet"]["title"],
            "channel": video["snippet"]["channelTitle"],
            "description": video["snippet"].get("description", ""),
            "published_at": video["snippet"]["publishedAt"],
            "views": video.get("statistics", {}).get("viewCount"),
            "likes": video.get("statistics", {}).get("likeCount"),
            "comment_count": video.get("statistics", {}).get("commentCount")
        }

    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail="YouTube API request failed"
        )

    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to YouTube API"
        )


# ==========================================
# Get YouTube Comments
# ==========================================

# The endpoint GET /youtube/comments/{video_id}
# is defined in app/youtube.py.
#
# It is automatically registered through:
# app.include_router(youtube_router)
#
# Do not define the same endpoint again here.
