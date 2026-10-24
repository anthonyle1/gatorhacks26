from pymongo import AsyncMongoClient
from app.config import settings

client = AsyncMongoClient(settings.mongodb_uri or "mongodb://127.0.0.1:27017", serverSelectionTimeoutMS=5000, connectTimeoutMS=5000)
db = client[settings.mongodb_db]

async def ping_database():
    await client.admin.command("ping")
