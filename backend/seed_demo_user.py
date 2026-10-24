import asyncio
from datetime import datetime, timezone

from app.database import db, client


async def main():
    await db.users.update_one(
        {"user_id": "demo_user"},
        {
            "$setOnInsert": {
                "user_id": "demo_user",
                "interests": ["gaming", "technology"],
                "disliked_topics": ["politics"],
                "daily_goal_minutes": 30,
                "created_at": datetime.now(timezone.utc)
            }
        },
        upsert=True
    )

    print("Demo user ready!")
    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
