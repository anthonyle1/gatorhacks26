from datetime import datetime, timezone
from app.database import db


def utc_now():
    return datetime.now(timezone.utc)


async def save_roberta_analysis(video_id: str, result: dict):
    """
    Store pretrained RoBERTa sentiment results.

    'result' is the existing output from
    backend/analysis/analyzer.py.
    """
    summary = result["summary"]
    proportions = summary["proportions"]

    sentiment = {
        "positive_ratio": float(proportions["positive"]),
        "neutral_ratio": float(proportions["neutral"]),
        "negative_ratio": float(proportions["negative"])
    }

    model_result = {
        "model_version": result["model"],
        "comment_sample_size": int(
            summary["total_comments"]
        ),
        "sentiment": sentiment,
        "summary": summary,
        "comments": [{"text": row["text"][:300], "sentiment": row["sentiment"], "confidence": row["confidence"]}
                     for row in result.get("comments", [])[:12]],
        "analyzed_at": utc_now()
    }

    await db.video_analyses.update_one(
        {"video_id": video_id},
        {
            "$set": {
                "analysis_status": "complete",
                "model_version": result["model"],
                "comment_sample_size": int(
                    summary["total_comments"]
                ),
                "sentiment": sentiment,
                "model_results.roberta": model_result,
                "analyzed_at": utc_now()
            },
            "$setOnInsert": {
                "video_id": video_id
            }
        },
        upsert=True
    )

    return await get_saved_analysis(video_id)


async def save_custom_analysis(
    video_id: str,
    model_version: str,
    result: dict
):
    """
    Store the customized model's results separately.

    The model's exact output format can be finalized
    with the ML teammate later.
    """
    model_result = {
        "model_version": model_version,
        "status": "complete",
        "result": result,
        "analyzed_at": utc_now()
    }

    await db.video_analyses.update_one(
        {"video_id": video_id},
        {
            "$set": {
                "model_results.custom": model_result
            },
            "$setOnInsert": {
                "video_id": video_id,
                "analysis_status": "pending"
            }
        },
        upsert=True
    )

    return await get_saved_analysis(video_id)


async def get_saved_analysis(video_id: str):
    return await db.video_analyses.find_one(
        {"video_id": video_id},
        {"_id": 0}
    )
