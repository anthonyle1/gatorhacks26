"""Stable topic and content-signal IDs for future viewing preferences."""

TAXONOMY_VERSION = "2"

SUBCATEGORIES = {
    "technology": [
        "gadgets", "artificial_intelligence", "cybersecurity",
        "consumer_tech", "tech_news", "robotics", "virtual_reality",
        "tech_reviews", "tech_tutorials", "emerging_technology",
    ],
    "programming": [
        "python", "web_development", "software_engineering",
        "mobile_development", "game_development", "data_science",
        "machine_learning", "coding_tutorials", "developer_careers",
        "open_source", "programming_humor",
    ],
    "science": [
        "space", "biology", "physics", "chemistry",
        "astronomy", "neuroscience", "scientific_discoveries",
        "scientific_experiments", "earth_science",
    ],
    "education": [
        "study_skills", "language_learning", "history",
        "mathematics", "educational_explainers", "exam_preparation",
        "college_life", "academic_advice", "learning_resources",
        "student_experiences",
    ],
    "gaming": [
        "gameplay", "game_reviews", "esports",
        "gaming_news", "game_streaming", "gaming_humor",
        "game_guides", "speedrunning", "gaming_communities",
        "mobile_gaming",
    ],
    "sports": [
        "football", "basketball", "combat_sports",
        "soccer", "baseball", "tennis", "volleyball",
        "motorsport_racing", "sports_highlights",
        "sports_commentary", "athlete_news", "sports_fandom",
    ],
    "fitness": [
        "strength_training", "cardio", "weight_loss",
        "workout_routines", "bodybuilding", "running",
        "yoga", "pilates", "fitness_motivation",
        "fitness_transformations", "exercise_education",
    ],
    "health": [
        "nutrition", "medical_information", "sleep",
        "wellness", "health_conditions", "healthcare_experiences",
        "preventive_health", "health_myths", "public_health",
        "reproductive_health",
    ],
    "mental_health": [
        "stress_management", "mental_health_education",
        "personal_stories", "anxiety", "depression",
        "self_care", "emotional_wellbeing", "burnout",
        "therapy_discussion", "coping_strategies",
        "mental_health_advocacy",
    ],
    "food": [
        "cooking", "restaurant_reviews", "food_challenges",
        "recipes", "baking", "street_food", "food_reviews",
        "meal_preparation", "food_trends", "mukbang",
        "food_culture", "dietary_habits",
    ],
    "travel": [
        "destination_guides", "budget_travel", "travel_vlogs",
        "solo_travel", "international_travel", "road_trips",
        "travel_tips", "hotel_reviews", "cultural_experiences",
        "adventure_travel",
    ],
    "music": [
        "kpop", "music_performance", "music_reviews",
        "fandom_discussion", "music_news", "music_production",
        "concerts", "covers", "instrument_tutorials",
        "music_reactions", "music_trends",
    ],
    "film_tv": [
        "film_reviews", "tv_discussion", "celebrity_news",
        "movie_clips", "tv_clips", "film_analysis",
        "streaming_recommendations", "trailers",
        "behind_the_scenes", "fan_theories",
        "reality_television",
    ],
    "comedy": [
        "sketches", "satire", "pranks",
        "standup_comedy", "memes", "reaction_comedy",
        "situational_humor", "dark_humor", "parody",
        "absurdist_humor",
    ],
    "news": [
        "world_news", "local_news", "crime",
        "breaking_news", "disasters", "technology_news",
        "economic_news", "social_issues", "investigative_reporting",
        "current_events", "news_analysis",
    ],
    "politics": [
        "policy", "elections", "political_commentary",
        "political_debates", "government", "activism",
        "political_news", "political_satire",
        "international_relations", "civic_education",
    ],
    "finance": [
        "budgeting", "investing", "cryptocurrency",
        "personal_finance", "saving_money", "debt_management",
        "financial_literacy", "stock_market", "real_estate",
        "financial_advice", "side_hustles",
    ],
    "business": [
        "entrepreneurship", "marketing", "careers",
        "startups", "business_news", "leadership",
        "workplace_culture", "job_search", "interview_advice",
        "professional_development", "business_strategy",
    ],
    "lifestyle": [
        "daily_vlogs", "productivity", "luxury_lifestyle",
        "morning_routines", "night_routines", "minimalism",
        "organization", "personal_growth", "life_advice",
        "adulting", "life_updates", "day_in_the_life",
    ],
    "fashion_beauty": [
        "makeup", "skincare", "cosmetic_procedures",
        "fashion_trends", "outfit_inspiration", "haircare",
        "beauty_reviews", "fashion_hauls", "personal_style",
        "beauty_tutorials", "aesthetic_trends",
    ],
    "diy": [
        "home_improvement", "crafts", "woodworking",
        "home_decor", "upcycling", "repair_tutorials",
        "art_projects", "creative_hobbies",
    ],
    "gardening": [
        "indoor_plants", "vegetable_gardening", "landscaping",
        "plant_care", "urban_gardening", "sustainable_gardening",
    ],
    "animals": [
        "pets", "wildlife", "animal_care",
        "funny_animals", "animal_rescue", "animal_training",
        "animal_education", "pet_vlogs", "animal_welfare",
    ],
    "nature": [
        "conservation", "outdoor_adventures", "natural_phenomena",
        "hiking", "camping", "environmental_issues",
        "climate_change", "nature_documentaries",
        "scenic_landscapes",
    ],
    "automotive": [
        "car_reviews", "vehicle_maintenance", "motorsports",
        "car_culture", "car_modifications", "electric_vehicles",
        "automotive_news", "driving_experiences",
    ],
    "relationships": [
        "dating", "friendships", "family_relationships",
        "relationship_advice", "breakups", "marriage",
        "communication", "relationship_conflicts",
        "parenting", "social_skills", "loneliness",
    ],
    "internet_culture": [
        "viral_trends", "internet_memes", "online_challenges",
        "influencer_culture", "internet_drama", "online_communities",
        "social_media_trends", "platform_discussion",
        "viral_reactions", "internet_history",
    ],
    "social_commentary": [
        "social_norms", "gender_discussion", "generational_discussion",
        "cultural_commentary", "identity_discussion",
        "social_inequality", "public_debates",
        "social_experiments", "ethical_discussion",
    ],
    "drama_conflict": [
        "celebrity_drama", "influencer_conflicts",
        "public_arguments", "callout_content",
        "exposure_videos", "relationship_drama",
        "online_feuds", "controversies",
    ],
    "true_crime": [
        "crime_documentaries", "unsolved_mysteries",
        "criminal_cases", "investigations",
        "court_cases", "crime_commentary",
    ],
    "horror_mystery": [
        "horror_stories", "paranormal", "creepypasta",
        "urban_legends", "mystery_explainers",
        "scary_encounters", "horror_games",
    ],
    "art_design": [
        "digital_art", "traditional_art", "graphic_design",
        "animation", "photography", "photo_editing",
        "illustration", "design_tutorials",
        "creative_process", "art_history",
    ],
    "books_literature": [
        "book_reviews", "book_recommendations", "booktok",
        "fiction", "nonfiction", "poetry",
        "writing_advice", "literary_analysis",
    ],
    "culture_religion": [
        "cultural_traditions", "religious_education",
        "spirituality", "cultural_identity",
        "cultural_history", "religious_practices",
        "intercultural_experiences",
    ],
    "motivation_self_improvement": [
        "motivational_speeches", "self_discipline",
        "confidence_building", "goal_setting",
        "success_stories", "mindset", "habit_building",
        "personal_reflection",
    ],
    "shopping_consumerism": [
        "product_recommendations", "shopping_hauls",
        "unboxing", "product_comparisons",
        "discounts_deals", "consumer_reviews",
        "impulse_purchases", "shopping_trends",
    ],
    "asmr_relaxation": [
        "asmr", "satisfying_videos", "ambient_sounds",
        "meditation", "relaxing_visuals",
        "sleep_sounds", "slow_living",
    ],
    "events_celebrations": [
        "holidays", "festivals", "weddings",
        "birthdays", "graduations", "community_events",
        "cultural_celebrations",
    ],
    "other": [],
}

SUBCATEGORY_IDS = [
    f"{category}.{subcategory}"
    for category, children in SUBCATEGORIES.items()
    for subcategory in children
]


# Potentially harmful or distressing content signals.
# These are classifier observations, not proof of actual viewer harm.
NEGATIVE_CONTENT_SIGNALS = [
    "harassment",
    "humiliation",
    "outrage_bait",
    "fearmongering",
    "dangerous_challenges",
    "body_shaming",
    "appearance_comparison",
    "gambling_promotion",
    "financial_hype",
    "graphic_violence",
    "misinformation",
    "social_comparison",
    "clickbait",
    "hostile_arguments",
    "distressing_content",
    "bullying",
    "hate_speech",
    "dehumanization",
    "threats",
    "sexual_harassment",
    "self_harm_glorification",
    "eating_disorder_promotion",
    "unrealistic_beauty_standards",
    "unrealistic_wealth_expectations",
    "shame_based_motivation",
    "manipulative_urgency",
    "scam_promotion",
    "conspiracy_framing",
    "rage_farming",
    "public_shaming",
    "cruelty_to_animals",
    "substance_abuse_glorification",
]


# Potentially beneficial content signals.
# These describe presentation patterns, not guaranteed viewer benefits.
POSITIVE_CONTENT_SIGNALS = [
    "educational",
    "informative",
    "supportive",
    "encouraging",
    "inspirational",
    "empathetic",
    "constructive_discussion",
    "positive_social_interaction",
    "practical_advice",
    "skill_building",
    "healthy_habits",
    "community_building",
    "positive_role_models",
    "emotional_validation",
    "conflict_resolution",
    "media_literacy",
    "fact_checking",
    "creative_expression",
]


# Combined signals for model validation and classification.
CONTENT_SIGNALS = (
    NEGATIVE_CONTENT_SIGNALS
    + POSITIVE_CONTENT_SIGNALS
)

# Server-owned polarity metadata, also exposed by the taxonomy API. The model
# selects supported signal IDs; it does not decide which group an ID belongs to.
SIGNAL_POLARITIES = {
    **{signal: "negative" for signal in NEGATIVE_CONTENT_SIGNALS},
    **{signal: "positive" for signal in POSITIVE_CONTENT_SIGNALS},
}
