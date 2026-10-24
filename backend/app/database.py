from pymongo import AsyncMongoClient
from app.config import settings

client = AsyncMongoClient(settings.mongodb_uri)
db = client[settings.mongodb_db]

async def ping_database():
    await client.admin.command("ping")
