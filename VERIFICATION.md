# Verification — 1.0.0-beta.8

Verified 19 October 2026. Pair with AIMP Companion Control native plugin 0.3.1.

## Reproduced faults and scope

Four removal presets store a source playlist ID although their active/focused target mode does not use it. After that playlist disappears, Companion 5 validates the obsolete dropdown value before invoking the callback and rejects it with `Value is not in the list of choices`. This was reproduced using the actual host validators. The screenshot alone does not prove it is the cause of every reported inert button.

Source target dropdowns now accept a saved stale value. The callback ignores that value only for active/focused/playing modes. Explicit targets still resolve against the current loaded playlist mapping and fail without sending a mutation if missing. Move/copy destination selectors retain strict host and callback validation. Existing property identity/readback checks are unchanged.

Two captions now accurately say Unqueue/Remove Focused Track. These operate on one focused track; they do not implement multi-row selection deletion. None of the six Remove, Clear and Close presets requires a confirmation checkbox. Playback queue operations are separate from playlist operations; Clear Queue has no visible effect if the queue is already empty.

Native 0.3.1 separately corrects absent-focus fallback in extended library operations. It reads the actual active playlist and SDK focus index; no focused track reports an error rather than silently targeting track zero. Legacy navigation remains unchanged. See the native source verification for those checks.

## Passed for this release

- Pinned Node 22: **102 automated tests passed**, zero failures or skips.
- Six new regressions verify all six removal presets after playlist replacement, stale/blank unused IDs, dynamic modes, rejection of deleted explicit identities, library-tool source selectors, and strict move/copy destinations.
- Official Companion module checker and production packager passed.
- Final TGZ loaded through **@companion-module/host 1.2.1** against a controlled WebSocket server: **192 actions, 46 feedbacks, 503 presets, 624 variables**.
- The packaged test captured the original six saved presets, changed the playlist inventory, validated those unchanged saved options with the real host validators, and exercised exact queue/remove/clear, track/remove, playlist/clear and playlist/close requests.
- One simulated read-only rejection produced its expected diagnostic and retained entries. Two expected warning log entries were checked separately; there were **zero unexpected host warnings**.
- Existing About migration and exact command checks, playlist override/readback, inspection summaries, music-library display fallbacks/playback, pitch/EQ and media/library smoke tests passed.
- Production preset changes are limited to the two captions and explanatory category text. IDs, actions, target bindings, feedbacks, rotaries, text size 20 and shrink-to-fit are unchanged.

## Package identity

- TGZ SHA-256: `6bb1e2d6cc6c0c5d789e12720f2b5768cd21526fab6f6260194c76d9de9a614e`
- Packaged main.js SHA-256: `4efce140b20e5ac0b34e3fb01523eb7ad1894a1b82163560fb9fe32c097908fb`

## Runtime boundary

Tests establish host validation, module dispatch and handling of controlled replies; they are not Windows AIMP runtime tests. Native SDK-double focus tests exercise the actual resolver function bodies, not the Windows COM implementation. This pair still needs installation and testing on the user's computer.

Existing explicit playlist operations use module GUID-to-index resolution, while native commands take numeric indices. An external reorder not yet reflected in that mapping remains a race outside this change. Read-only protection is preserved; no playlist is automatically unlocked.

The separate visualisation Start report is unresolved pending a runtime result. No visualisation command behavior changed. Earlier music-library label, interface validation, property override and inspection-summary fixes are retained.
