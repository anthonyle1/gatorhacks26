from fastapi import FastAPI, HTTPException
from app.database import ping_database
from app.routes.sessions import router as sessions_router

app = FastAPI(title="Healthy Doomscrolling API")

app.include_router(sessions_router)

@app.get("/")
def root():
    return {
        "message": "Healthy Doomscrolling API",
        "status": "running"
    }

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
