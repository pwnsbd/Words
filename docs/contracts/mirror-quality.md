# Contract — Mirror quality (resurfacing thresholds)

**Why:** the mirror is Words' one job. Thresholds (`RESURFACE_THRESHOLDS` in `src/main/settings.ts`: rare 0.8, balanced 0.68, often 0.64) are uncalibrated starting values.

**Inputs:**
- `sample-entries.json` (20 entries: 4 idea groups × 4 paraphrases + 4 unrelated).
- A new labelled eval set `scripts/eval/mirror-eval.json` (synthetic, journal-style): ≥10 idea groups of 3–4 paraphrases each (different wording, varying length, some ideas buried mid-entry in a long entry), plus hard negatives: same *topic* but a different idea, same *mood* but a different topic, and everyday filler. Every pair is labelled related / unrelated.
- The real Qwen3 Embedding 0.6B Q8_0 model in `models/`, through the app's own passage splitting and retrieval code (not a re-implementation).

**Outputs:**
- `scripts/eval-mirror.mjs` (`npm run eval:mirror`): runs retrieval exactly as the app does, top 3 per entry restricted to earlier dates. It reports precision@3, recall (share of related earlier entries surfaced), the false-positive rate on hard negatives, and how many entries get zero matches, at each threshold from 0.55 to 0.85 in steps of 0.01. Results go to `docs/mirror-eval.md` (a table plus a few worst false positives and misses, quoted) and `docs/mirror-eval.json`.
- Recommended thresholds for rare/balanced/often:
  - **balanced:** maximise precision with recall ≥ 0.6. The mirror must rarely show an unrelated memory; being quiet is better than being wrong.
  - **rare:** precision ≈ 1.0 on the eval.
  - **often:** recall ≥ 0.8 with precision ≥ 0.7.
  - Apply them to `RESURFACE_THRESHOLDS` only if they improve on the current values, and say so either way.

**Errors:** model missing → script exits with a clear message. It must **never** read or write the real journal (`%APPDATA%\words`). All data stays in an isolated temporary folder that is deleted afterwards.

**Perf budget:** eval completes in under 10 minutes on CPU or GPU.

**Out of scope:** changing the embedding model, passage splitting, Patterns, UI, or reflection.

**Done-check:** `npm run eval:mirror` runs end to end; `docs/mirror-eval.md` exists with before/after numbers; `npm run test:memory` and `npm run typecheck` still pass.
