
import os
import httpx

from datetime import datetime, timezone
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException

load_dotenv()

router = APIRouter(prefix="/youtube", tags=["YouTube"])

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")


@router.get("/comments/{video_id}")
async def get_youtube_comments(video_id: str):

    if not YOUTUBE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="YouTube API key is missing"
        )

    url = "https://www.googleapis.com/youtube/v3/commentThreads"

    params = {
        "part": "snippet",
        "videoId": video_id,
        "maxResults": 100,
        "order": "relevance",
        "textFormat": "plainText",
        "key": YOUTUBE_API_KEY
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()

        data = response.json()

    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail="YouTube API returned an error"
        )

    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to YouTube"
        )

    comments = []

    for item in data.get("items", []):
        comment = item["snippet"]["topLevelComment"]
        snippet = comment["snippet"]

        comments.append({
            "comment_id": comment["id"],
            "video_id": video_id,
            "comment_text": snippet["textDisplay"],
            "like_count": snippet.get("likeCount", 0),
            "published_at": snippet["publishedAt"],
            "fetched_at": datetime.now(
                timezone.utc
            ).isoformat()
        })

    # Sort the sampled comments by likes
    comments.sort(
        key=lambda comment: comment["like_count"],
        reverse=True
    )

    # Keep only the top 10 from this sample
    top_10 = comments[:10]

    for rank, comment in enumerate(top_10, start=1):
        comment["rank"] = rank

    return {
        "video_id": video_id,
        "ranking_method": "likes_within_relevance_sample",
        "sample_size": len(comments),
        "comment_count": len(top_10),
        "comments": top_10
    }
