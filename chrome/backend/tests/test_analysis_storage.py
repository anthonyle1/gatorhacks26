import asyncio

from app.database import client
from app.services.analysis_storage import (
    save_roberta_analysis,
    save_custom_analysis,
    get_saved_analysis
)


async def main():
    video_id = "test_video_001"

    # Simulated output from existing RoBERTa model
    roberta_result = {
        "model": "cardiffnlp/twitter-roberta-base-sentiment-latest",
        "summary": {
            "total_comments": 20,
            "proportions": {
                "positive": 0.60,
                "neutral": 0.25,
                "negative": 0.15
            }
        }
    }

    await save_roberta_analysis(video_id, roberta_result)
    print("Saved RoBERTa analysis")

    # Placeholder for the second model
    await save_custom_analysis(
        video_id=video_id,
        model_version="custom-model-v1",
        result={
            "test_message": "Custom model storage works"
        }
    )
    print("Saved custom analysis")

    saved = await get_saved_analysis(video_id)

    assert "roberta" in saved["model_results"]
    assert "custom" in saved["model_results"]

    print("Both model results stored successfully!")
    print(saved)

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
