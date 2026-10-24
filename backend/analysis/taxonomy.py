"""Fixed content signals only. Topic trees are discovered after session completion."""

TAXONOMY_VERSION = "session-1"

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
