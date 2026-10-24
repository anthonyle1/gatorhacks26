from fastapi import FastAPI, HTTPException
from app.database import ping_database

app = FastAPI(title="Healthy Doomscrolling API")

@app.get("/health")
async def health():
    try:
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
