# Sample entries — for comparing models

Not part of the app. Just eight fake journal entries to paste into the writing page (one at a time,
Ctrl/Cmd+Enter to save) so you can see what a model actually produces — reflection tone, mood dot, whether
resurfacing kicks in on the ones with obvious echoes — and compare that against a different model dropped
into `models/`.

**Workflow for an actual A/B comparison:**
1. Paste entry 1, save, note the reflection + mood dot.
2. Swap `models/reflection-model.gguf` (and/or the embedding model) for a different one.
3. Restart `npm run dev` (models load once at startup and stay warm — a swap needs a restart to pick up).
4. Paste the *same* entry text again and save it as a new entry, compare the two reflections side by side
   in the journal view.

There's no "regenerate this entry's reflection" action right now — every entry's reflection is generated
once, at save time, with whatever model was loaded then. So comparing models means literally re-saving the
same text under each one, which is what this list is for. (I flagged this as one of the open gaps below —
it'd be a reasonable small feature if this kind of comparison is something you want to do often.)

Entries 3 and 7 are near-duplicates on purpose, dated far enough apart in feel that they're worth pasting
with a real gap between saves if you want to see resurfacing actually trigger (it only looks at entries
14+ days old, so back-to-back saves in one sitting won't surface each other no matter how similar they are
— that's deliberate in the app, not a bug in the test).

---

### 1 — short, low-key

Rained most of the day. Made soup, read for a bit, didn't do much else. Kind of a nothing day, in a good way.

---

### 2 — stressed, work

Presentation got moved up to tomorrow morning and half the deck isn't done. I know I'll get it done, I always
do, but I hate this feeling of the evening being eaten by it. Snapped at nobody in particular, just felt it.

---

### 3 — reflective, a relationship (first of the near-duplicate pair)

Had dinner with my sister tonight, first time in a couple months. It's strange how we can go that long without
talking and then just pick back up like nothing happened. I think I take that for granted. Should call more.

---

### 4 — excited, a small win

Finally fixed the bug that's been chasing me for two days. It was one dumb off-by-one thing. Felt so good to
see it work I actually said "yes!" out loud alone in my apartment like an idiot. Going to celebrate with the
good coffee tomorrow.

---

### 5 — sad, heavier

Found out an old coworker passed away. We weren't close anymore but he was kind to me back when I was new and
didn't know anything. Keep thinking about a dumb joke he used to make every Monday. Not sure what to do with
this feeling, so I'm just writing it down.

---

### 6 — neutral, observational

Walked a different route home and noticed a whole community garden I never knew was there, tucked behind the
laundromat. Someone had put out a little handwritten sign about tomatoes being free to take. Nice to be
reminded the neighborhood has more going on than I usually notice.

---

### 7 — reflective, a relationship (second of the near-duplicate pair)

Called my sister on the way back from the store. We talked for almost an hour about nothing in particular. I
keep telling myself I should reach out more often and then I don't, and then when I finally do it's always
this easy. Not sure why I make it a bigger deal in my head than it is.

---

### 8 — mixed, a bigger day

Got the offer. Better pay, but it means leaving a team I actually like, which I wasn't expecting to be the
hard part. Spent the whole train ride home going back and forth. Going to sleep on it, but I think I already
know what I'm going to say.
