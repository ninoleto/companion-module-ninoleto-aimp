# Changelog

## 1.0.0-beta.8

- Fixes host validation blocking active/focused/playing actions after an unused saved source playlist ID disappears.
- Keeps explicit source resolution strict and copy/move destination choices restricted; no fallback to a different playlist.
- Corrects Unqueue/Remove Selection captions to Unqueue/Remove Focused Track and explains queue versus playlist scope.
- Pairs with native plugin 0.3.1, which rejects absent playlist/track focus rather than substituting the first track for extended library operations.
- Preserves action/preset IDs and earlier fixes; visualisation behavior is unchanged.

## 1.0.0-beta.7

- Gives populated music-library results a display title using title, canonical provider Title, filename, then page-aware Result N.
- Uses the same label for the selected-result variables and result dropdowns; trims blank strings and avoids stringifying invalid metadata.
- Keeps absent/disconnected result slots empty and leaves provider metadata, row/query IDs and playback parameters unchanged.
- Preserves all existing actions, feedbacks, presets, size-20/shrink styling and rotary bindings. Native plugin remains 0.3.0.

## 1.0.0-beta.6

- Enables required per-playlist view/grouping/format overrides before dependent property changes; pins target identity and verifies native readback.
- Publishes separate readable summaries for explicit playlist/track/file/property inspection, including failed reads and no playing file. Background polling does not replace the summaries.
- Moves data-reading presets into an Information section and displays returned summaries on fresh buttons.
- Clarifies setup-only templates, Close confirmation, playlist edit locks and single focused-track enable/disable semantics.
- Preserves previous action/preset IDs, interface migration, existing layouts and native plugin 0.3.0.

## 1.0.0-beta.5

- Fixes interface presets rejected by Companion 5 before execution: persist required DSP tab value 0 and explicit confirmation false.
- Migrates existing interface actions automatically, adding only missing values; preserves selected commands, confirmation choices, DSP tabs and expressions.
- Logs deferred native interface/registered-action failures once per observed execution, with command identity and hexadecimal HRESULT; keeps failure details across read-only polling.
- Adds real host option-validator coverage for every generated preset action/feedback across legacy and expanded capabilities, migration checks, and packaged About execution checks.
- Keeps native plugin 0.3.0, existing action/preset IDs, layouts and network configuration. Direct native About was confirmed working on the user's Windows installation.

## 1.0.0-beta.4

- Adds native 0.3.0 capability-gated artwork, lyrics, music-library queries and optional storage operations.
- Adds playlist selection/groups/sources/properties, cross-playlist copy/move, confirmed file-tag editing, installed skins/color encoders, windows/notifications and known-ID actions.
- Adds confirmed EQ preset rename/delete, playlist cleanup and application quit.
- Keeps existing IDs and native Companion 5 size-20/shrink-to-fit styling; includes live artwork, lyric buttons, result browsing and rotary presets.
- Waits for AIMP's loaded state; guards stale media, cached query results and file identities. Maintains older bridge compatibility and non-replaying reconnect behavior.
- See VERIFICATION.md for package/host checks and Windows runtime limitations.

## 1.0.0-beta.3

- Adds capability discovery for native plugin 0.2.0, while retaining the original playback controls on plugin 0.1.0.
- Adds pitch, tempo, speed, sound effects, complete reported EQ bands/preamp, EQ preset selection and unique band-preset saving.
- Adds playback/end actions, mixing/fade timings, output devices, radio capture, A–B loop and named AIMP interface commands.
- Adds queue and playlist editing, track ratings/enable state, rich metadata and direct file/URL playback.
- Adds live variables/feedback and matching native Companion 5 presets, including rotary controls. Preserves all beta.2 IDs/artwork and text20/shrink styling.
- Keeps authoritative partial-failure state, atomic audio/EQ relative changes, and non-replaying reconnect behavior.
- Validated with41tests, official module checker/packager/host, portable native protocol interoperability, and actual Companion5.1 graphics rendering. Windows/AIMP runtime remains untested here.

# 1.0.0-beta.2

- Uses Companion 5 native layered presets with explicit text size 20 and shrink-to-fit.
- Adds original SVG/embedded PNG line icons, category accents and live gauges.
- Separates long metadata from icons and gives metadata a caption.
- Offers 46 everyday presets, two controls per playlist and one Play button per track. Advanced restores the full catalogue.
- Keeps action IDs, connection ID, playback transport and WebSocket code unchanged.
- Updates @companion-module/base from 2.0.4 to 2.1.3 for the Companion 5 graphics API.

Copied buttons are not restyled automatically. Linked variants outside the default catalogue keep their cached data in Companion 5.1 until Advanced is enabled.
