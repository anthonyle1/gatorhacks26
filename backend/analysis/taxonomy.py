"""Stable topic and content-signal IDs for future viewing preferences."""

TAXONOMY_VERSION = "1"
SUBCATEGORIES = {
    "technology": ["gadgets", "artificial_intelligence", "cybersecurity"],
    "programming": ["python", "web_development", "software_engineering"],
    "science": ["space", "biology", "physics"],
    "education": ["study_skills", "language_learning", "history"],
    "gaming": ["gameplay", "game_reviews", "esports"],
    "sports": ["football", "basketball", "combat_sports"],
    "fitness": ["strength_training", "cardio", "weight_loss"],
    "health": ["nutrition", "medical_information", "sleep"],
    "mental_health": ["stress_management", "mental_health_education", "personal_stories"],
    "food": ["cooking", "restaurant_reviews", "food_challenges"],
    "travel": ["destination_guides", "budget_travel", "travel_vlogs"],
    "music": ["kpop", "music_performance", "music_reviews", "fandom_discussion"],
    "film_tv": ["film_reviews", "tv_discussion", "celebrity_news"],
    "comedy": ["sketches", "satire", "pranks"],
    "news": ["world_news", "local_news", "crime"],
    "politics": ["policy", "elections", "political_commentary"],
    "finance": ["budgeting", "investing", "cryptocurrency"],
    "business": ["entrepreneurship", "marketing", "careers"],
    "lifestyle": ["daily_vlogs", "productivity", "luxury_lifestyle"],
    "fashion_beauty": ["makeup", "skincare", "cosmetic_procedures"],
    "diy": ["home_improvement", "crafts", "woodworking"],
    "gardening": ["indoor_plants", "vegetable_gardening", "landscaping"],
    "animals": ["pets", "wildlife", "animal_care"],
    "nature": ["conservation", "outdoor_adventures", "natural_phenomena"],
    "automotive": ["car_reviews", "vehicle_maintenance", "motorsports"],
    "relationships": ["dating", "friendships", "family_relationships"],
    "other": [],
}
SUBCATEGORY_IDS = [f"{category}.{subcategory}" for category, children in SUBCATEGORIES.items() for subcategory in children]

# These describe presentation/behavior, independently of the subject matter.
CONTENT_SIGNALS = [
    "harassment", "humiliation", "outrage_bait", "fearmongering",
    "dangerous_challenges", "body_shaming", "appearance_comparison",
    "gambling_promotion", "financial_hype", "graphic_violence",
]
