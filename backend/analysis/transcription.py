"""Warm, serialized CPU INT8 ASR. Decode bounds are enforced before inference."""
from functools import lru_cache
from io import BytesIO
from threading import Lock
import re
from pathlib import Path
import numpy as np

from app.config import settings
from .metrics import measure

_lock = Lock()
USABILITY_VERSION = "1"


def model_directory(model_id, revision):
    from .versions import fingerprint
    return Path(__file__).resolve().parents[1] / ".cache" / "asr" / fingerprint([model_id, revision])


def installation_status():
    """Read-only readiness check in the running API interpreter; never downloads weights."""
    from importlib.util import find_spec
    required = {"faster-whisper": "faster_whisper", "CTranslate2": "ctranslate2", "PyAV": "av", "ONNX Runtime": "onnxruntime", "NumPy": "numpy"}
    missing = [name for name, module in required.items() if find_spec(module) is None]
    directory = model_directory(settings.asr_model, settings.asr_revision)
    downloaded = all((directory / name).is_file() for name in ("model.bin", "config.json", "tokenizer.json"))
    loaded = model.cache_info().currsize > 0
    state = "missing_dependencies" if missing else "model_not_downloaded" if not downloaded else "loaded" if loaded else "installed"
    return {"model": settings.asr_model, "revision": settings.asr_revision, "state": state,
            "dependencies_installed": not missing, "missing_dependencies": missing, "model_downloaded": downloaded,
            "model_loaded": loaded, "detail": "Install backend/requirements.txt in the interpreter running Uvicorn." if missing
            else "Model weights will download on the first audio segment." if not downloaded
            else "Whisper is installed locally."}


def decode_mp3(raw):
    try:
        return _decode_mp3(raw)
    except ImportError:
        raise
    except Exception as exc:
        raise ValueError("Invalid MP3 or decoded duration exceeds budget") from exc


def _decode_mp3(raw):
    import av
    chunks, count = [], 0
    with av.open(BytesIO(raw)) as container:
        stream = container.streams.audio[0]
        if stream.codec_context.name not in {"mp3", "mp3float"}:
            raise ValueError("Only independently decodable MP3 audio is accepted")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in container.decode(stream):
            for converted in resampler.resample(frame):
                samples = converted.to_ndarray().reshape(-1)
                count += len(samples)
                if count > settings.audio_max_seconds * 16000:
                    raise ValueError("Decoded duration exceeds audio budget")
                chunks.append(samples)
        for converted in resampler.resample(None):
            samples = converted.to_ndarray().reshape(-1)
            count += len(samples)
            if count > settings.audio_max_seconds * 16000:
                raise ValueError("Decoded duration exceeds audio budget")
            chunks.append(samples)
    if not count:
        raise ValueError("Empty MP3 audio")
    return np.concatenate(chunks).astype(np.float32) / 32768


def usability(text, language, speech_seconds, *, confidence=None):
    if language != "en":
        return "unsupported_language"
    words = re.findall(r"[a-z]+", text.casefold())
    if not words:
        return "no_recognized_speech"
    if speech_seconds < settings.asr_min_speech_seconds:
        return "short_speech"
    if confidence is not None and confidence < -1:
        return "low_recognition_confidence"
    vague = {"thank", "thanks", "you", "for", "watching", "like", "subscribe", "yeah", "okay", "oh", "um", "music"}
    if len(words) < 4 or len(set(words) - vague) < 3:
        return "vague_transcript"
    return None


@lru_cache(maxsize=2)
def model(model_id, revision):
    from faster_whisper import WhisperModel
    from faster_whisper.utils import download_model
    # Explicit local_dir downloads avoid Windows symlink privilege requirements.
    directory = model_directory(model_id, revision)
    if all((directory / name).is_file() for name in ("model.bin", "config.json", "tokenizer.json")):
        local = str(directory)
    else:
        with measure("asr_model_download"):
            local = download_model(model_id, output_dir=str(directory), revision=revision)
    with measure("asr_model_startup"):
        return WhisperModel(local, device="cpu", compute_type="int8", cpu_threads=2, num_workers=1)


def transcribe(raw):
    with _lock, measure("asr_total_cold" if model.cache_info().currsize == 0 else "asr_total_warm"):
        with measure("audio_decode"):
            audio = decode_mp3(raw)
        segments, info = model(settings.asr_model, settings.asr_revision).transcribe(audio, beam_size=1, vad_filter=True)
        # Iteration performs the actual inference.
        with measure("asr_inference"):
            rows = [{"start": float(s.start), "end": float(s.end), "text": s.text.strip(),
                     "avg_logprob": float(s.avg_logprob)} for s in segments]
        text = " ".join(row["text"] for row in rows)[:16000]
        speech = sum(row["end"] - row["start"] for row in rows)
        confidence = sum(row["avg_logprob"] for row in rows)/len(rows) if rows else None
        excluded = usability(text, info.language, speech, confidence=confidence)
        return {"text": text, "language": info.language, "segments": rows, "speech_seconds": speech,
                "exclusion_reason": excluded, "usable": excluded is None,
                "silence": bool(float(np.max(np.abs(audio))) < .001), "usability_version": USABILITY_VERSION}


def map_transcript(result, metadata):
    """Split ASR spans at discontinuities; never invent coverage across a gap."""
    excerpts = []
    delay = metadata.get("encoder_delay_seconds", 0)
    for row in result["segments"]:
        start, end = max(0, row["start"] - delay), max(0, row["end"] - delay)
        # Accept a sentence only if entirely inside one known capture interval.
        for interval in metadata["intervals"]:
            if interval["certain"] and interval["audio_start"] <= start < end <= interval["audio_end"]:
                rate = (interval["media_end"] - interval["media_start"]) / (interval["audio_end"] - interval["audio_start"])
                excerpts.append({"text": row["text"], "media_start": interval["media_start"] + (start-interval["audio_start"])*rate,
                                 "media_end": interval["media_start"] + (end-interval["audio_start"])*rate})
                break
    return excerpts
