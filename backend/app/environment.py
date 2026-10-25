"""One repository-root environment file for the API and standalone commands."""
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPOSITORY_ROOT / ".env"
