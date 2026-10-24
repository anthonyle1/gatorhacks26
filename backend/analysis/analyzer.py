"""English comment sentiment, with an explicit aggregate decision rule."""

from functools import lru_cache
from threading import Lock

from app.youtube import Comment, parse_comments

MODEL_ID = "cardiffnlp/twitter-roberta-base-sentiment-latest"
LABELS = ("negative", "neutral", "positive")


def preprocess(text: str) -> str:
    """Apply the mention/URL placeholders recommended by the model card."""
    return " ".join(
        "@user" if word.startswith("@") and len(word) > 1
        else "http" if word.startswith(("http://", "https://")) else word
        for word in text.split()
    )


class ModelUnavailableError(RuntimeError):
    pass


class SentimentAnalyzer:
    def __init__(self, classifier=None, batch_size: int = 16):
        if batch_size < 1:
            raise ValueError("batch_size must be positive.")
        self._classifier = classifier
        self.batch_size = batch_size
        self._lock = Lock()

    def _load(self):
        if self._classifier is None:
            try:
                from transformers import pipeline

                self._classifier = pipeline(
                    "sentiment-analysis", model=MODEL_ID, tokenizer=MODEL_ID,
                    framework="pt", device=-1,
                )
            except (ImportError, OSError, RuntimeError, ValueError):
                raise ModelUnavailableError(
                    "Sentiment model unavailable. Install analysis/requirements.txt "
                    "and allow the first model download from Hugging Face."
                ) from None
        return self._classifier

    def analyze_response(self, response: dict, negative_threshold: float = 0.5) -> dict:
        return self.analyze(parse_comments(response), negative_threshold)

    def analyze(self, comments: list[Comment], negative_threshold: float = 0.5) -> dict:
        if not 0 < negative_threshold <= 1:
            raise ValueError("negative_threshold must be greater than 0 and at most 1.")
        results = []
        # Serialize model loading and inference to bound concurrent CPU/memory use.
        if comments:
            with self._lock:
                classifier = self._load()
                for start in range(0, len(comments), self.batch_size):
                    batch = comments[start:start + self.batch_size]
                    predictions = classifier(
                        [preprocess(comment.text) for comment in batch],
                        top_k=None, truncation=True, max_length=512,
                        batch_size=self.batch_size,
                    )
                    if len(predictions) != len(batch):
                        raise RuntimeError("Sentiment model returned an unexpected batch size.")
                    for comment, prediction in zip(batch, predictions):
                        scores = {entry["label"].lower(): float(entry["score"]) for entry in prediction}
                        if set(scores) != set(LABELS):
                            raise RuntimeError("Sentiment model returned unexpected labels.")
                        label = max(LABELS, key=scores.get)
                        results.append({
                            "id": comment.id, "text": comment.text, "sentiment": label,
                            "confidence": scores[label], "scores": scores,
                        })
        total = len(results)
        counts = {label: sum(row["sentiment"] == label for row in results) for label in LABELS}
        proportions = {label: counts[label] / total if total else 0.0 for label in LABELS}
        averages = {
            label: sum(row["scores"][label] for row in results) / total if total else 0.0
            for label in LABELS
        }
        non_neutral = counts["positive"] + counts["negative"]
        # Measure direction among positive/negative labels only, so neutral
        # comments cannot dilute the signal. No directional labels means unknown.
        sentiment_balance = ((counts["positive"] - counts["negative"]) / non_neutral
                             if non_neutral else None)
        is_negative = (
            proportions["negative"] >= negative_threshold and counts["negative"] > counts["positive"]
        ) if total else None
        return {
            "model": MODEL_ID,
            "summary": {
                "total_comments": total, "counts": counts, "proportions": proportions,
                "average_scores": averages,
                "sentiment_balance": sentiment_balance,
                "negative_threshold": negative_threshold,
                "is_negative_reaction": is_negative,
                "assessment": "insufficient_data" if not total else "negative" if is_negative else "not_negative",
            },
            "comments": results,
        }


@lru_cache(maxsize=1)
def get_analyzer() -> SentimentAnalyzer:
    # The weights load only on the first nonempty analysis request.
    return SentimentAnalyzer()
