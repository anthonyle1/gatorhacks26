from fastapi import FastAPI, HTTPException
from app.database import ping_database
from analysis.routes import router as analysis_router

app = FastAPI(title="Healthy Doomscrolling API")
app.include_router(analysis_router)

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
