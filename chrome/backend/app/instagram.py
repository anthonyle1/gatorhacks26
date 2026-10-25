
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

router = APIRouter(prefix="/instagram", tags=["Instagram"])

class InstagramComments(BaseModel):
    video_id: str
    platform: str
    comments: List[str]

@router.post("/comments")
async def receive_instagram_comments(data: InstagramComments):
    print("Instagram Reel:", data.video_id)
    print("Received comments:", data.comments)

    return {
        "success": True,
        "video_id": data.video_id,
        "comment_count": len(data.comments)
    }
