# Contract — Letters: eligibility, entry count, write again

**Eligibility (replaces the flat `RECAP_MIN_ENTRIES = 5` for letters only; recurring themes/recap keep 5):**
- Only **completed** periods are eligible: a week after its Saturday 23:59, a month after its last day, a year after Dec 31. All in local time, with weeks running Sunday to Saturday (existing `computePeriod`).
- **Week:** ≥ 2 entries with a reflection in that week.
- **Month:** either ≥ 1 entry with a reflection in *every* Sun–Sat week that overlaps the month, **or** ≥ 5 entries with a reflection in the month.
- **Year:** either ≥ 12 entries with a reflection in the year, **or** ≥ 1 in each of at least 6 different months.
- `letters:next-period` returns the oldest eligible, uncovered period (as today). `letters:generate` re-checks the same rule.
- When nothing qualifies, the message is specific: "a weekly letter needs 2 entries in a finished week"; "a monthly letter needs an entry every week of a finished month, or 5 in it"; "a yearly letter needs 12 entries in a finished year, or entries in 6 of its months".

**Entry count:**
- Save `entryCount` on each letter: the number of entries used.
- Show "from N entries" as a quiet line under the letter's date in the reading view, and in both the list and grid views.
- Letters saved before this change, which have no count, show nothing. Don't guess a count.

**Write again:**
- In the letter reading view, a small **feather icon** button in ink colour, the same size and weight as the other corner marks. On hover and focus its tooltip says "write again" (`title`), with `aria-label="write again"`.
- While it runs, the feather moves gently, like a quill writing (CSS animation, respects `prefers-reduced-motion`), and the button is disabled.
- It rewrites the letter for the same period from the same entries, through `modelJob`, and replaces content and `entryCount` in place (same id; update the timestamp).
- New IPC channel `letters:regenerate`.
- If it fails, the old letter is kept and the soft existing error line is shown. If the model is missing, the button is hidden. A double click is ignored.

**Out of scope:** recurring themes and recap gating, letter prompt and voice, candle UI, list and grid layout beyond the count line.

**Done-check:** `npm run typecheck`, `npm run build`, `npm run test:backend`, `npm run test:release` pass. A new test (added to `scripts/test-backend.mjs` or a new `scripts/test-letters.mjs` behind `npm run test:letters`) covers:
- the week, month and year rules, including both "or" branches;
- that an unfinished current period is excluded;
- the week/month boundary;
- that a letter with no saved count still loads.

## Auto-fill (added 2026-10-04)

**Trigger:** opening the Letters page. Nothing runs in the background otherwise, and nothing is shown as a notification.

**Behaviour:**
- Main process finds every eligible, uncovered period (week, month and year, using the rules above), sorted oldest first, and writes them one after another through `modelJob`.
- Each letter appears in the list or grid as soon as it's saved. The queue keeps going if the user leaves the page or turns the candle to another timeframe.
- If a fill is already running, a second one isn't started.
- Pushed events: `letters:written` (one per saved letter) and `letters:fill-progress` (`{ done, total, currentLabel }`).
- Status line on the Letters page while running: "writing the week of Jul 5, 2026… (2 of 7)" (use the period label). It's hidden when finished.
- New IPC channel `letters:fill-missing`, started by the renderer when Letters opens.

**Button:** "write a … letter" is removed from normal use.
- When nothing is missing for the selected timeframe, show the existing specific "needs…" message as a quiet hint, not an error.
- If any letter failed to write, show a quiet "try again" link that re-runs the fill.

**Errors:**
- Model missing or disabled → no fill. Show the existing soft model-unavailable tone.
- One letter fails → skip it, keep going, and offer "try again".
- The app quits mid-fill → nothing is half-saved, thanks to the atomic writes.

**Done-check:** `test:letters` covers:
- fill order (oldest first, across timeframes);
- skipping covered periods;
- no duplicates when fill is called twice concurrently;
- continuing after one failure.

Plus typecheck, build, `test:backend` and `test:release`.
