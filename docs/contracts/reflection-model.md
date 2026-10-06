# Contract — Reflection model: Qwen3.5-9B side by side, then swap

**Why:** before release, use the same model family (Qwen) for embeddings and reflection. Qwen is Apache 2.0, while Llama 3.1 uses its own community licence. The swap ships only if the user prefers Qwen's writing in a side-by-side comparison.

**Inputs:**
- Current model: `models/reflection-model.gguf` (Meta Llama 3.1 8B Instruct Q4_K_M).
- Candidate model: `models/Qwen3.5-9B-Q4_K_M.gguf` (unsloth/Qwen3.5-9B-GGUF, 5.68 GB, text only, no mmproj).
- `sample-entries.json` (20 entries).
- The app's own `reflect`, `describePattern` and `writeLetterForTimeframe` in `src/main/llamacpp.ts`, run as they are, not re-implemented.

**Part A — side-by-side eval (commit 1):**
- `scripts/eval-reflection.mjs` (`npm run eval:reflection`) runs each model in turn through the app's code. Pick the model with `WORDS_REFLECTION_MODEL_FILE`. For each model it produces:
  - 20 reflections plus mood marks, one per sample entry, with latency;
  - 1 pattern (`describePattern`) on the 4 paraphrases of one idea group;
  - 1 week letter from 5 or more of the sample entries.
- Output: `docs/reflection-eval.md`, a Llama | Qwen table per entry with the entry text shortened to about 120 characters, plus the pattern and the letter side by side. Also report average and p95 latency, model load time, and any JSON parse failures or nulls. Raw results go to `docs/reflection-eval.json`.
- Qwen3.5 must not leak thinking. No `<think>` blocks or reasoning may appear in the output. Turn thinking off through node-llama-cpp's chat wrapper or a token budget, not by stripping text afterwards. The eval flags any output containing `<think` or `</think`.
- If node-llama-cpp 3.20 can't load the Qwen3.5 architecture, upgrade `node-llama-cpp` (latest is 3.22.1). Report that, and confirm Llama still loads after the upgrade.

**Part B — swap (commit 2, kept separate; it merges only after the user approves Part A):**
- `modelDownload.ts`: the reflection download becomes the unsloth Qwen3.5-9B Q4_K_M URL.
- Default reflection filename: `Qwen3.5-9B-Q4_K_M.gguf`. `WORDS_REFLECTION_MODEL_FILE` still overrides it. The old `reflection-model.gguf` is not deleted.
- Update the model names, sizes and licences in README.md, docs/PROJECT_OVERVIEW.md, docs/memory-models.md and THIRD_PARTY_LICENSES.md.
- Prompts change only if the eval shows a Qwen-specific failure. List any prompt change in the report.

**Part C — Qwen fix round (the user chose Qwen on 2026-10-06; A and B are merged as 555cddc and ac6f625):**
- C1, model code (`src/main/llamacpp.ts`):
  - Wait for each context sequence to be fully released (`await sequence.dispose()`, or whatever node-llama-cpp provides) before a call returns, so back-to-back calls never hit "No sequences left".
  - Change the `describePattern` prompt so Qwen marks the 4-paraphrase group (entries 1, 6, 11, 16) as a pattern, with a title and description.
  - Change the reflection prompt so Qwen writes one short sentence (≤ 25 words, ideally ≤ 20).
  - Don't loosen grounding: the c53a8e4 rule that one entry can't become a pattern still applies. The 4 unrelated sample entries must not be marked as a pattern.
- C2, everything else:
  - `App.tsx` model label shows Qwen3.5-9B (~5.7 GB).
  - `test:memory` passes again (stub `shared/types` / `DEFAULT_HANDWRITING`).
  - `seed:demo` reads `demo-entries.json`, accepting any number of entries, instead of the fixed 20 in `sample-entries.json`.

**Errors:** if a model file is missing, the script exits with a clear message. The script must **never** read or write the real journal (`%APPDATA%\words`); it uses a temporary folder and deletes it afterwards. One failed entry is recorded as a failure and does not stop the run.

**Perf budget:** a Qwen reflection should take no more than about 1.5× Llama's latency on the same machine. The eval completes in under 15 minutes.

**Out of scope:** the embedding model, the mirror thresholds, UI, a model-picker UI and migrating existing reflections.

**Done-check:** `npm run eval:reflection` runs end to end for both models. `docs/reflection-eval.md` exists with no `<think` leaks. `npm run typecheck`, `npm run test:memory` and `npm run test:letters` pass after each commit.
