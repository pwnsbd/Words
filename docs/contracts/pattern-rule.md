# Contract — Pattern rule: recurring feelings about one subject count

**Why:** the strict negative rule in `describePattern` (from c53a8e4) rejects any group that shares a feeling. That also rejects real recurring thoughts, for example "I doubt whether I can build this alone" written three times. The user chose to refine the rule on 2026-10-06.

**The rule:**
- **Pattern (isPattern=true):**
  - the same idea, question or technique restated in different words;
  - a feeling that keeps returning about the **same specific subject** (doubt about this project, excitement about this release);
  - a belief or idea the writer **states explicitly** in each excerpt (for example "happiness lives in unplanned, ordinary moments").
- **Not a pattern (isPattern=false):**
  - the same mood in response to **unrelated** events, with no shared subject or stated idea (calm on a walk, calm hearing music, calm after a nap);
  - a philosophy or trait the model infers but the text doesn't express.
- The title and description name the shared subject or the stated idea, never a personality trait. All other existing constraints stay: no advice, no diagnoses, no schools of thought, no "you", no invented facts.

**Inputs:** `describePattern` in `src/main/llamacpp.ts` (prompt only), and the Qwen3.5-9B model.

**Test set (run through the app's real `describePattern`):**
- **Must be true:**
  - test/fixtures/demo-entries.json entries 5/9/13 (doubt), 2/6/18 (identity), 7/11/19 (unplanned happiness), 12/16/20 (release excitement);
  - test/fixtures/sample-entries.json entries 1/6/11/16.
- **Must be false:**
  - test/fixtures/sample-entries.json entries 5/10/15/20 (unrelated);
  - a synthetic set of 3 excerpts with the same mood and unrelated events (calm walk / calm music / calm nap);
  - a synthetic set of 3 excerpts that are happy about unrelated things with no stated idea (a good dinner / sunny weather / a finished book);
  - a mixed set of demo entries 5/7/16 (different themes).

**Outputs:** the updated prompt, and `scripts/eval-patterns.mjs` (`npm run eval:patterns`) that runs the test set and prints each set's isPattern and title, exiting non-zero on any miss.

**Errors / perf:** same as for the reflection model. No reading or writing of `%APPDATA%\words`. Each call stays within the existing latency.

**Out of scope:** grouping thresholds (`patternGrouping.ts`), reflections, letters and UI.

**Done-check:** `npm run eval:patterns` passes all 9 sets; `npm run eval:reflection -- --quick` still passes; `npm run typecheck` passes.
