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
