# Contract — Journal grid view ("echo" cards)

**Goal:** a grid view of the journal where every card tells you what you wrote, and leans on the mirror by surfacing the line that echoes across your writing.

**Toggle:** list/grid toggle on the journal view, in the same style and position as the Letters page toggle. The choice is remembered the same way Letters remembers its own; if Letters doesn't remember it, use a new setting `journalView: 'list' | 'grid'`, default `'list'`. List view stays exactly as it is now.

**Card, at rest** (paper card in the same style as `.letters__card`: parchment gradient, soft shadow, both themes):
1. Date and mood dot, as in the list.
2. **Hint line:** the entry's first sentence (struck text removed via `stripStruckMarkup`), at most one line with an ellipsis, in `--ink`. This line is always present, so the writer always knows which entry it is.
3. **Echo:** if the entry has an echo passage that is different from the hint line, show it in 2–3 lines (clamped), with a small knot mark (reuse `Knot` from `Rope.tsx`) and a `title` of "this returns in N other entries". Without an echo, show the next 2–3 lines of the entry instead (no knot).
4. The reflection in italic `--ink-soft`, one line, clamped. Omit it if there's no reflection.
5. Sample entries keep their "sample" label.

**Card, on hover or keyboard focus:** it lifts, as `.letters__card` does, and **unfolds** to show the first ~8 lines of the entry, from the start, with struck words shown struck as in the reading view. Transition ~250ms, like opening a folded note. It overlays its neighbours (raised z-index) without reflowing the grid. Off under `prefers-reduced-motion` (it just shows the expanded state). Click, Enter or Space opens the entry as today.

**Echo data:**
- New IPC `entries:echoes` returns `{ [entryId]: { passage: string, count: number } }`.
- For each entry, pick the passage whose stored vector matches passages in the most *other* entries at or above the active `resurfaceSimilarityThreshold()`. Use the **stored passage vectors only, with no model calls**, and only vectors from the active model identity. Ties go to the higher similarity.
- Cache it in the main process and invalidate on save, delete, import and memory rebuild.
- Under 300 ms for 500 entries. If that's not achievable with brute force, compute in the background and return what's ready; cards without data fall back to the next lines.

**Errors:** no embeddings or no model → no echoes, and cards fall back gracefully. Never block the grid render on echoes.

**Layout:** responsive grid, cards at least ~220px wide, 2 columns at 640px and 3 or more on wider windows. The ink scrollbar applies. Newest first, like the list.

**Out of scope:** calendar view, search, filters, editing, changes to list view or memory thresholds.

**Done-check:** `npm run typecheck`, `build`, `test:memory`, `test:release` pass. A test (add to `scripts/test-memory.mjs` or a new script) covers:
- echo selection: picks the most-connected passage;
- ignores vectors from other models;
- returns nothing below the threshold;
- cache invalidates on delete.
