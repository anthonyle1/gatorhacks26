"""English comment sentiment, with an explicit aggregate decision rule."""

from functools import lru_cache
from threading import Lock
from datetime import datetime, timezone
from .cache import get_cache
from .versions import fingerprint
from .metrics import measure
from app.config import settings

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
    def __init__(self, classifier=None, batch_size: int = 16, cache=None):
        if batch_size < 1:
            raise ValueError("batch_size must be positive.")
        self._classifier = classifier
        self.batch_size = batch_size
        self._lock = Lock()
        self.cache = cache

    def _load(self):
        if self._classifier is None:
            try:
                from transformers import pipeline

                with measure("roberta_model_startup"):
                    self._classifier = pipeline(
                        "sentiment-analysis", model=MODEL_ID, tokenizer=MODEL_ID,
                        revision=settings.roberta_revision, framework="pt", device=-1,
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
        if comments and self.cache is not None:
            # The cache miss lock prevents concurrent model requests from duplicating work.
            identities = [{"model": MODEL_ID, "revision": settings.roberta_revision, "preprocessing": "1",
                            "language": "en", "text_hash": fingerprint(preprocess(comment.text)), "prompt": None,
                            "token_limit": 512} for comment in comments]
            def compute(indices):
                return [{key: row[key] for key in ("sentiment", "confidence", "scores", "token_count", "truncated")} for row in self._infer([comments[i] for i in indices])]
            # Mutable revisions cannot safely reuse inference across encounters.
            predictions = self.cache.many(identities, compute, ttl=settings.analysis_cache_ttl) if settings.roberta_revision != "main" else compute(range(len(comments)))
            for comment, identity, row in zip(comments, identities, predictions):
                results.append({**row, "id": comment.id, "text": comment.text, "text_hash": identity["text_hash"],
                    "model_revision": settings.roberta_revision, "preprocessing_version": "1",
                    "token_limit": 512, "truncation": "enabled", "analyzed_at": datetime.now(timezone.utc).isoformat()})
        elif comments:
            results = self._infer(comments)
        return self._summarize(results, negative_threshold)

    def _infer(self, comments):
        results = []
        if comments:
            with self._lock, measure("roberta_cold" if self._classifier is None else "roberta_warm"):
                classifier = self._load()
                for start in range(0, len(comments), self.batch_size):
                    batch = comments[start:start + self.batch_size]
                    texts = [preprocess(comment.text) for comment in batch]
                    lengths = [None] * len(batch)
                    tokenizer = getattr(classifier, "tokenizer", None)
                    if tokenizer is not None:
                        encoded = tokenizer(texts, truncation=False, add_special_tokens=True)
                        if isinstance(encoded, dict) or hasattr(encoded, "data"):
                            token_ids = encoded.get("input_ids")
                            if isinstance(token_ids, list) and len(token_ids) == len(batch):
                                lengths = [len(ids) for ids in token_ids]
                    predictions = classifier(
                        texts,
                        top_k=None, truncation=True, max_length=512,
                        batch_size=self.batch_size,
                    )
                    if len(predictions) != len(batch):
                        raise RuntimeError("Sentiment model returned an unexpected batch size.")
                    for comment, prediction, length in zip(batch, predictions, lengths):
                        scores = {entry["label"].lower(): float(entry["score"]) for entry in prediction}
                        if set(scores) != set(LABELS):
                            raise RuntimeError("Sentiment model returned unexpected labels.")
                        label = max(LABELS, key=scores.get)
                        results.append({
                            "id": comment.id, "text": comment.text, "sentiment": label,
                            "confidence": scores[label], "scores": scores,
                            "token_count": length, "truncated": length > 512 if length is not None else None,
                        })
        return results

    def _summarize(self, results, negative_threshold):
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
    return SentimentAnalyzer(cache=get_cache())
