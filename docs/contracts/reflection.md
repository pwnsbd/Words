# Contract — Regenerate reflection

**Inputs:** a saved entry id, triggered by the user from the opened entry (journal view), via a quiet text control ("listen again" style — same visual weight as the existing "delete" link). Never on the writing surface.

**Outputs:** the entry's reflection + mood mark are regenerated with the current reflection model, using the same `reflect(stripStruckMarkup(text))` path as on save (`src/main/index.ts` ~L209), persisted with `updateEntry`, and pushed to the renderer via the existing `entries:reflection` event. Entry text stays immutable (entries are delete-only). New IPC channel `entries:regenerateReflection` (main handler + preload + shared types).

**Errors:** model missing/disabled → control hidden or shows the existing soft "model unavailable" tone, no crash. Model fails → previous reflection kept unchanged. Double-click while running → ignored (one job per entry). Runs through the existing `modelJob` queue so it doesn't overlap other model work.

**Perf budget:** no blocking of UI; same latency as a save-time reflection.

**Out of scope:** editing entry text, batch regenerate-all, model choice UI, changes to memory/embeddings.

**Done-check:** `npm run typecheck` and `npm run build` pass; `npm run test:memory` and `npm run test:patterns` still pass; IPC handler exists end-to-end (main, preload, types, App.tsx caller); the README "Known gaps" line about regenerate is removed and the feature added under "What's built".
