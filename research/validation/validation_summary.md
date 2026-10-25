# Hostility detector validation

## What we measured

Person-targeted hostility: a comment that demeans, mocks, or attacks a real
person (creator, idol, someone in the video) or their fans, including coded
fandom slang. Excited swearing, jokes, sadness, criticism of the video itself,
and criticism of companies do not count.

## Labels

One human labeler (Helena) labeled comments blind: the model's answers were
hidden while labeling. Labels are `yes`, `no`, or `unsure` (unsure is excluded
from scoring).

Each test set has 100 comments from 100 held-out videos that were never used
to write the prompt or the slang glossary: 50 random comments plus 50 the
sentiment model marked negative, shuffled together, so the set contains enough
hostile examples to measure.

| File | Role |
|---|---|
| `test_set_1_practice_labels.csv` | Practice (development) set: used to find mistakes and improve the prompt |
| `test_set_2_final_labels.csv` | Final test set: labeled after the prompt was locked, model run once |

## Results on the final test set (98 scored comments, 14 hostile)

| Detector | Cohen's kappa | Hostile caught | False alarms |
|---|---|---|---|
| Gemma 4 E2B, plain prompt (v1) | 0.09 | 1 of 14 | 1 |
| Gemma 4 E2B, + indirect-hostility rules (v3) | 0.34 | 4 of 14 | 2 |
| **Gemma 4 E2B, + rules + reason first (v3_explain)** | **0.58** | **11 of 14** | **9** |

The pass mark (kappa of at least 0.5) and the primary version (v3_explain)
were decided before the final test was run.

Earlier baselines on the first test (not shown above): toxic-bert's insult
score had kappa -0.06 (it flags excited swearing as hostile), and treating the
sentiment model's "negative" label as hostile scored kappa 0.18 (it caught 13
of 14 hostile comments but raised 42 false alarms).

## Limits

- One labeler, so no human-vs-human agreement number yet.
- 14 hostile examples is small; the true kappa could plausibly be about 0.4 to 0.75.
- About half of v3_explain's flags are borderline, so hostility rates lean high.
  Comparisons between categories are fairer than absolute numbers.
- English works best; slang changes fast.
- The full run used Hugging Face transformers on a Colab T4 GPU. Ollama's
  `gemma4:e2b` may be quantized differently, so re-check on the final test set
  before relying on live scoring.
