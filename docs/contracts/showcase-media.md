# Contract: showcase screenshots and video

**Why:** the README and the GitHub Pages page need clear screenshots and a short video of the real app, so people can see what Words is before they install it.

**Inputs:**
- The built app (`npm run build` → `out/`), launched in Electron.
- `demo-entries.json`: the demo journal (T11). Never the user's journal.
- Models via `WORDS_MODELS_DIR` (read-only). The reflection model is whatever main ships by default (Qwen3.5-9B after T10).
- `ffmpeg` on PATH.

**Outputs:**
- `scripts/capture-showcase.mjs` (+ `.ts` if it needs the main-process modules, like `seed-demo`), run with `npm run capture:showcase`. It is re-runnable after any UI change.
- **Screenshots only (user, 2026-10-06): the user records the video themselves.** The script runs the flow below and saves a PNG at each step (1440×900 window, device scale 1, cream theme) to `docs/media/`.
- The run-through, in the user's order (2026-10-06):
  1. Start on the empty writing page. Type exactly `It has been a great day!` at a natural pace (~10 chars/s with small random jitter). → `write.png` once typing ends.
  2. Save it (the visible **save entry** control, or Ctrl+Enter). Wait for the reflection to fade in. → `saved.png`.
  3. Go to the journal. Wait for it to fully populate (the grid and its echo passage cards have rendered, and the new entry is there). → `journal.png`.
  4. From the journal, explore the other pages, holding ~2 s on each:
     - open an entry → `entry.png`;
     - Patterns, with one pattern expanded → `patterns.png`;
     - Letters, with one letter open → `letter.png`.

  Hold 1–2 s after each step. Waits come from real events (the reflection has arrived, the page has rendered), never fixed sleeps. No dial changes and no dark theme; keep to the flow above.

**Isolation (hard rule):**
- The app runs with a temporary userData folder seeded from `demo-entries.json`. The script must never read or write `%APPDATA%\words`, and it deletes the temp folder afterwards.
- If the app needs a userData override, add one guarded env var (`WORDS_USER_DATA_DIR`) in `src/main/index.ts`. Change nothing else in app behaviour.
- Seeding happens inside the temp profile, with real reflections and embeddings, so Patterns and letters actually appear.

**Errors:** if a model is missing, `ffmpeg` is missing, or an expected screen never appears within 120 s, exit non-zero with a clear message naming the step. Leave no half-written media: write to `.tmp` and rename at the end.

**Perf budget:** a full run (seed + capture) takes under 20 minutes on the dev machine (RTX 5070).

**Out of scope:** the Pages site itself (T13), README layout, any UI or copy change, audio or voice-over, and mac/linux.

**Done-check:** `npm run capture:showcase` exits 0. All 6 PNGs exist. `%APPDATA%\words` is untouched (its newest mtime is unchanged). `npm run typecheck` passes. The user does a visual check of every file.
