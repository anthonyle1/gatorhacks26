import csv
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/hostility", tags=["Hostility"])

SCORES_FILE = Path(__file__).resolve().parents[2] / "data" / "video_scores.csv"
NUMBER_COLUMNS = ["n_comments", "negative_share", "hostility_rate"]


def load_scores():
    if not SCORES_FILE.exists():
        return {}
    scores = {}
    with open(SCORES_FILE, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            for column in NUMBER_COLUMNS:
                row[column] = float(row[column])
            scores[row["video_id"]] = row
    return scores


SCORES = load_scores()


@router.get("/{video_id}")
def get_hostility(video_id: str):
    score = SCORES.get(video_id)
    if score is None:
        return {"video_id": video_id, "level": "not_rated"}
    return score