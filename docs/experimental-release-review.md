# Experimental release review

Reviewed October 4, 2026. Scope: local source review, storage/download failure tests, renderer smoke tests, and an existing real-model integration smoke. No release was published, installer replaced, or personal journal modified.

## Assessment

Words has a working local-first foundation for an experimental preview. This pass addressed concrete reliability defects. A fresh-machine installer test is still required before calling this release ready; passing a development build does not establish installer readiness or performance on other hardware.

## Changes made

- Recover the unfinished draft locally, including crossed-out characters and the quill correction budget. Recovery uses the Electron profile's local storage; it is not a backup and is not encrypted by Words.
- Provide a visible Save control and saved confirmation. Prevent duplicate submissions and temporarily make input read-only while a save is pending. Failed saves retain the writing and show an actionable message.
- Show failures for settings, reading, deletion, import, letter generation, reflection regeneration, and model folder changes. Import counts now distinguish files that failed from successfully saved writing.
- Write journal entries, letters, and settings through temporary files before replacing their destination. Reject unsafe file IDs and invalid values; skip malformed saved records without breaking the entire journal list.
- Preserve source model files until relocation succeeds and settings are persisted. Stage copies before making them visible as usable models.
- Destroy interrupted download streams, clean up partial files, enforce request timeouts, handle relative redirects, and check received content lengths when supplied.
- Restrict external links to HTTP(S) and prevent in-window navigation away from the application.
- Explain experimental status, model download size, draft recovery, and fallible AI output in Settings.

## Verification

| Check | Result |
| --- | --- |
| TypeScript checks | Passed |
| Production application build | Passed |
| Existing memory regression suite | Passed |
| Existing pattern regression suite | Passed |
| New backend regression suite | Passed: invalid IDs, malformed files, settings write failure, failed model relocation, interrupted download cleanup and retry |
| New isolated Electron renderer smoke | Passed: restart recovery, correction budget, failed save, duplicate submit, successful save feedback, next draft, malformed recovery data |
| Existing real-model Electron memory smoke | Save/match/source-link/source-passage assertions passed; process subsequently returned exit code 1. Native model shutdown remains unverified. |
| Dependency security advisory scan | Not completed; user requested a local-only review after automatic approval review blocked metadata disclosure to npm. |
| Fresh install, upgrade and uninstall | Not run |

Reproduce local checks with `npm run typecheck`, `npm run test:memory`, `npm run test:patterns`, `npm run test:backend`, and `npm run test:release`. The renderer smoke uses synthetic data and a temporary profile. Its hidden Chromium window may require execution outside the command sandbox on Windows.

## Remaining release gates

1. **Test the actual installer on a clean Windows account or VM.** Verify first launch, writing before models arrive, restart, offline use, interrupted download and retry, a read-only models folder, and low disk space. Check upgrade and uninstall both with keeping and deleting the journal. The existing installer in `dist` has not been rebuilt by this review and does not include these fixes.
2. **Investigate the nonzero native-model smoke shutdown.** Confirm a packaged app exits cleanly with loaded models, and with model work still running. Do not count the smoke's assertion success as a clean process-exit result.
3. **Measure supported hardware.** The default model download is about 5.5 GB; model memory use and latency need measurements on the least powerful machine you intend to support. Automatic download still begins at launch; there is no pause/resume or metered-connection choice.
4. **Verify dependency advisories before wider distribution.** This local review cannot establish the current security status of Electron or its dependencies. It made no dependency upgrades.

## Known preview limitations

- The installer is configured without a signing certificate. Test its actual Windows first-run experience and describe the publisher status accurately in release notes.
- There is no dedicated backup/export flow. For testing, close Words and copy its complete `%APPDATA%\words` profile to a separate location; model files in a custom location live elsewhere. Confirm recovery on a disposable copy before relying on a backup.
- Draft recovery is best effort; it is not a guarantee against abrupt power loss or storage failure. Saving remains explicit.
- Corrupt records are skipped and retained on disk, but no in-app recovery browser identifies them yet.
- Model downloads do not verify a pinned cryptographic checksum and restart from zero after interruption.
- A failed multi-file model relocation can leave complete duplicate model files at the destination; original files are retained.
- The custom editor is append-oriented and has no native spellcheck or conventional cursor/selection editing. Existing IME support still needs hands-on multilingual testing.
- AI reflections and similarities are suggestions; broader quality evaluation remains outstanding.
- The repository requests Lingo dictionary updates, but no Lingo tools were available in this session.

## Suggested preview description

> Words is an experimental, local-first journaling app exploring how local AI can help you revisit your own writing. Entries stay on your device. Reflections and connections may be imperfect, and initial AI setup downloads about 5.5 GB of models. Keep a separate backup of important writing while testing.
