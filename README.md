# AIMP Companion Control — Companion module 1.0.0-beta.8

A Companion 5 connection module for the AIMP Companion Control native plugin. This release preserves the working transport and existing action/preset IDs, and extends the native plugin through documented AIMP 5.40 services. Use it with native plugin **0.3.1** for the focused-track safety fix. The previous **0.2.1 + beta.3** pair remains the rollback version confirmed working on the user's 64-bit AIMP.

## Install the update — no build required

1. Keep your working 0.2.1 plugin installer and beta.3 module package for rollback. Export a Companion backup before updating.
2. Download **AimpCompanionControl-0.3.1-preview.aimppack** from the [matching native release](https://github.com/ninoleto/AIMP-Companion-Control/releases/tag/v0.3.1-preview), verify its release checksum and retain its notices. Install it in AIMP and restart AIMP. This release includes a native focused-track fix as well as the module update.
3. Download **ninoleto-aimp-1.0.0-beta.8.tgz** and `SHA256SUMS.txt` from the [beta.8 release](https://github.com/ninoleto/companion-module-ninoleto-aimp/releases/tag/v1.0.0-beta.8). Verify with `Get-FileHash .\ninoleto-aimp-1.0.0-beta.8.tgz -Algorithm SHA256`. In Companion, open **Modules → Import module package** and select the TGZ without extracting it.
4. Edit your existing **ninoleto: AIMP Companion Control** connection, select **1.0.0-beta.8**, and Save. Keep its label, host and port so saved buttons and variable references remain valid.
5. Existing placed actions receive the stale-playlist fix when beta.8 loads. Drag fresh Unqueue/Remove Focused Track presets for their corrected captions; copied artwork is preserved. These six removal controls do not require a confirmation checkbox. Close AIMP remains a separate action with explicit confirmation.

Companion **5.0 and newer** is the target, with the Companion 5 layered graphics API. The native target is stable **AIMP 5.40**. AIMP 6 beta is not runtime-validated. The old 0.1 plugin can still use the existing module controls; it cannot supply the new feature groups.

Use the exact address selected in the AIMP plugin's listening settings, with port `19122`. A listener bound to a LAN address does not also accept `127.0.0.1`, even on the same PC. The reported working endpoint for this installation is `192.168.1.11:19122`. For different PCs, allow the Companion PC's IPv4 address in the plugin settings.

## Fixed in beta.8

- Active/focused/playing actions no longer fail Companion validation because an unused saved playlist ID disappeared. Previously the host could reject the action with **Value is not in the list of choices** before the module sent a command.
- Explicitly chosen playlists still must exist. Removed explicit targets are rejected instead of substituting another playlist. Copy/move destination dropdowns remain restricted to current playlists.
- **Unqueue Focused Track** and **Remove Focused Track** now describe their single-track scope accurately; they do not operate on every highlighted row.
- Native 0.3.1 resolves the actual active playlist and actual focused track for extended library operations. No focused track now reports an error; it cannot silently substitute track zero.
- Existing IDs, action bindings, rotary controls, text size 20, shrink-to-fit, and earlier fixes are preserved.

### Remove, Clear and Close controls

| Control                 | Effect                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- |
| Unqueue Focused Track   | Removes the focused track from the playback queue. It must already be queued. |
| Remove first Queue item | Removes queue position 0. The queue must contain an entry.                    |
| Clear queue             | Empties the playback queue. An already empty queue has nothing to remove.     |
| Close Playlist          | Closes the active AIMP playlist tab and preserves the saved playlist file.    |
| Clear Playlist          | Removes every entry from the active AIMP playlist.                            |
| Remove Focused Track    | Removes one focused entry from its playlist.                                  |

These controls preserve the original audio files and have no confirmation setup requirement. The playback queue is separate from the ordinary playlist. Read-only playlist protection remains in effect; this update does not unlock playlists. A track must actually have focus for focused operations.

The stale-dropdown rejection is reproduced; the screenshot alone does not establish which of these six commands failed on the user's computer. Queue-empty behavior is unchanged. Visualisation Start is a separate unresolved runtime report and is not changed by this release.

## Fixed in beta.7

- Music-library result labels no longer disappear when a populated row has no usable title. Display uses its title, canonical provider Title, filename, then **Result N** (including the page offset). Artist and album also accept the canonical provider fields.
- The selected-result display and result dropdowns use the same labels. Original row IDs, file paths, metadata and playback commands are preserved.
- **Current Results is a selector:** press a placed result button to select it (green), then use **Play**, **Queue** or **Add**. Selecting a result alone does not start playback. Empty slots remain unavailable.
- Existing result presets already reference these variables, so no layout replacement is required for this fix. Text size 20, shrink-to-fit, layouts and rotary bindings are unchanged.

This addresses blank labels; it does not prove why a particular library provider omitted title/artist data. A filename or Result N label is a fallback, not recovered tag metadata.

## Fixed in beta.6

- Playlist display, grouping and formatting actions now enable their required per-playlist override before writing and check the returned value. An unavailable property or rejected change is reported instead of implying success.
- Property actions resolve the playlist once and reuse its identity for the dependent writes. They preserve explicit requests to turn an override off and do not unlock a read-only playlist automatically.
- Playlist information, track information, playing-file details and property inspection now publish separate readable summary variables. New information presets display these summaries on the button after a successful request; failed reads show an error instead of an unchanged-looking button.
- Presets distinguish configuration templates from immediate controls. Track enable/disable captions correctly say **Focused track**, and Read-only On states that it locks playlist editing.
- Existing action IDs and beta.5 migration are retained. Existing placed property actions receive the functional fix when beta.6 loads. Copied button artwork is retained; drag fresh presets to get the clearer captions and information summaries.

## Using the controls shown in the screenshots

| Control                                                 | Expected behavior / setup                                                                                                                                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New playlist                                            | Ready to run. Creates and activates a tab named New playlist.                                                                                                                                                                            |
| Rename / Add media / Import playlist / Sort template    | Edit the placed button's Press action and enter the name, path, URL or formatting template. These do not open a text-entry dialog. File paths refer to the AIMP computer.                                                                |
| Read playlist / track / audio information               | Fetches a snapshot and displays a compact result on the new preset. It does not open an AIMP window. The full response remains in the connection variable `last_response` (up to 4096 characters).                                       |
| Read properties                                         | Fetches a snapshot of the target playlist's properties. The summary identifies inherited/custom groups, formatting and view settings; it is not continuous live monitoring.                                                              |
| Show ratings/numbers/durations, grouping and formatting | Sets the chosen value on the target playlist; beta.6 enables the required override automatically. On and Off are explicit values, not toggles. Repeating the same value need not change the display.                                     |
| Read-only playlist On / Off                             | On locks playlist editing. Use Off before adding, renaming or moving entries in a locked playlist.                                                                                                                                       |
| Enable / Disable focused track                          | Changes the playback-enabled flag of one focused track. It does not enable/disable all selected entries.                                                                                                                                 |
| Move track to start                                     | Moves the focused track to index 0. A track already first will remain there.                                                                                                                                                             |
| Close AIMP                                              | Edit the placed button's Press action and enable **I intend to close AIMP**. This is a saved setup choice, not an on-screen confirmation dialog. Pressing an unconfigured preset reports the missing confirmation in the connection log. |

The `active` playlist is the selected AIMP playlist tab. The module's focused track is the focus tracked by the bridge and can differ from the currently playing track. If a control still has no expected effect, inspect `last_command_error` and the AIMP connection log; include the placed button's Press action and the reported error when troubleshooting.

## Fixed in beta.5

- Interface presets now persist the DSP tab value (`0`) required by Companion 5 validation, even for commands that do not use it. Previously the editor displayed a default while the action was rejected before reaching the module.
- An upgrade script fills missing values on existing interface buttons, preserving selected commands, custom DSP tabs, expressions and confirmation choices. It does not enable confirmation automatically.
- Deferred native command failures now appear in the connection log and `last_command_error`, with command identity and HRESULT. Repeated state polls retain the error without flooding the log.
- The native plugin remains 0.3.0. About was confirmed opening from a direct WebSocket request on the user's Windows installation.

## Added in beta.4

- Album artwork, optional title overlay, plain/synchronized lyrics and live current/next lines.
- Music-library storage/schema discovery, bounded asynchronous search/filter/sort queries, paging and result-selection rotary; play/add results and queue matching loaded tracks.
- Provider-specific library import, tag refresh, rating, confirmed single-row record removal, and dialogs where supported. Removing a record does not delete the media file.
- Playlist selection, copying/moving tracks between playlists, groups, formatting properties, tag refresh and folder/file smart-playlist sources with synchronization.
- Inspect/edit supported file tags. File writes require an explicit confirmation option and the exact file identity from a fresh read. Applying merged tags can normalize differences between tag formats.
- Installed skin selection/default/reapply and hue/intensity rotary controls; AIMP window show/hide/minimize/restore, notifications, known action-ID lookup/execution and confirmed application quit.
- Confirmed EQ preset rename/delete and playlist cleanup. AIMP does not identify factory EQ presets, so these actions can affect them.

## Added controls

| Family                   | Controls                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pitch, tempo and speed   | Separate set/adjust/reset actions, live values, decrease/increase/reset buttons, rotary turn to adjust and press to reset                                         |
| Sound effects            | Balance, chorus, echo, enhancer, flanger, reverb and bass enhancement; actual SDK ranges and neutral values                                                       |
| Equalizer                | Enable, preamp, every reported band and frequency, flat reset, installed preset selection, saving band settings to a new named preset, automatic preset selection |
| Playback                 | Track/playlist end behavior, one-track playlist repeat, cross-mixing, automatic/manual transitions, fades and inter-track pause                                   |
| Playback queue           | Add focused/playing/specified tracks first or last, remove, move, clear, suspend/resume, count/status                                                             |
| Playlists and tracks     | Create, rename, unload, add media, clear entries, sort/shuffle/reverse; move/remove/enable tracks and set 0–5 ratings in half-star steps                          |
| A–B repeat and recording | Mark/cycle/clear loop points, set explicit points, internet-radio capture toggle                                                                                  |
| Output and interface     | Enumerated output-device selection, topmost/tray/visualization settings, 29 named AIMP interface commands including DSP, bookmarks and file dialogs               |
| Inspection               | Current audio/effect state, rich file/playlist metadata, queue state, native operation errors and deferred UI-command status                                      |

Original playback, mute/volume, seek, shuffle/repeat, focus navigation, playlist/track selection and seven original encoder presets remain. A direct file/URL playback action uses AIMP's own asynchronous loader; loading a playlist file may import its entries. Feature availability depends on AIMP's services and the currently loaded media. The module does not fabricate success when AIMP rejects a command.

Pitch uses the SDK range **−10…+10**; the official SDK does not specify its unit. Tempo is **0.8…1.5×**, speed **0.5…1.5×**. EQ gain and preamp are **−15…+15 dB**. Enhancer uses **1…4**, the shared range of conflicting official header/documentation limits.

## Presets and encoders

All text uses **size 20 with Shrink to fit**, in native Companion 5 layers, with embedded line icons and the beta.2 palette. The catalogue shows one instance of each preset. New numeric controls provide decrease, increase, reset and an encoder, grouped by purpose. Encoder buttons contain rotation actions; turn left/right to adjust and press to reset where appropriate.

**Show advanced preset variants** reveals explicit on/off variants, extra steps and playlist editing templates. Entry removal and clearing use a distinct warning colour and are kept in Advanced. They edit AIMP playlists/queues; they do not delete audio files from disk. Named-input operations such as adding a URL or renaming a playlist must be configured before use.

Existing **Copy** buttons keep their appearance. Drag new presets onto buttons to use the new layouts. **Linked** presets update when their IDs are present; enable Advanced if a previously linked variant is hidden from the everyday catalogue.

## State and library behavior

The module waits for AIMP's documented loaded state before becoming ready. It discovers capabilities when it connects, then polls extended state every two seconds when the transport is idle. Numeric audio/EQ adjustments happen atomically inside the AIMP plugin using a fresh value, so rapid encoder turns accumulate. Option toggles read state before changing it. Failed or partial operations retain the actual readback and display an error.

The existing serialized WebSocket transport and reconnect behavior are retained. A timeout discards queued commands; playback operations are never replayed after reconnection. A valid player-status reply is required before the connection reports ready.

Artwork and lyrics are requested only when needed and cached by track identity; pending media/lyric timing use a bounded faster poll. Music-library results are bounded and asynchronous, with provider-specific paging and explicit pending/error states.

Playlist inventory refreshes every 30 seconds and after module edits. Adding media is asynchronous in AIMP; the module schedules a delayed refresh and normal polling picks up longer loads. Use **Refresh library** after external reordering/renaming, or if a large import is still completing. The default preset limit is 10,000 tracks per playlist, configurable from 100 to 100,000. A status variable reports truncation. Saved GUID/path choices are resolved to the current numeric index when an action runs; avoid simultaneous playlist reordering during a live cue.

AIMP window commands are acknowledged as queued, then run on AIMP's UI thread. `last_app_command_status` reports their later status. An open modal dialog can keep this status at `executing` until it is closed. `last_app_command_error` and `last_app_command_hresult` report a failed execution. Dialogs appear on the AIMP computer and may require local interaction. Radio capture uses AIMP's existing recording configuration; it is not system-audio recording.

## Documented limits

Saving an EQ preset stores its band gains, without preamp: the SDK preset interface has no preamp field. Preset saves require a unique name. Renaming/deleting requires explicit confirmation because the SDK does not distinguish built-in presets from user presets.

The official SDK does not expose universal direct parameters for vocal removal, arbitrary DSP/VST plugins, ReplayGain/normalization or silence-removal settings, converter jobs, or scheduler job editing. Music-library operations are limited to each provider's advertised services. This release can open documented settings dialogs; opening a dialog is not automation of its settings. The full source bundle includes `docs/CAPABILITY-MATRIX-0.3.0.md` and individual protocol contracts with official references, API discrepancies and these boundaries.

## Diagnostics and rollback

Read the connection's status message and logs. Connection refused usually means no listener at the configured address. An HTTP upgrade rejection means the port belongs to another service. Check AIMP's plugin settings for **WebSocket listening**, the port and IP allowlist.

From the source folder, PowerShell can perform read-only checks:

```powershell
.\scripts\Test-Connection.ps1
.\scripts\Test-Features.ps1
```

Add `-Address 192.168.1.20` for a remote AIMP PC, using its real address. Feature testing does not change playback or audio settings.

To roll back, close AIMP, reinstall your saved 0.2.1 plugin package and restart AIMP; select beta.3 on the same Companion connection. The original files/settings remain compatible. The beta.4 additions require native plugin 0.3.0.

## Build from source

Use Node.js 22.20 or a later Node 22 release:

```powershell
npm ci
npm test
npm run check
npm run package
npm run test:host
npm run test:host -- --features
npm run test:host -- --features --beta3
npm run test:host -- --features --advanced
```

Output: `ninoleto-aimp-1.0.0-beta.8.tgz`. Dependencies are pinned. `npm run test:native` also checks the unchanged portable native WebSocket frame/handshake implementation; it needs a C++17 compiler and does not exercise the Windows event pump or AIMP SDK.

See `VERIFICATION.md` for actual checks and their limits. The new Windows/AIMP behavior has not been run in a real AIMP process here. This is a prerelease for testing, not a claim of production validation or antivirus clearance. Original MIT and dependency notices remain.

See [docs/FINAL-REVIEW.md](docs/FINAL-REVIEW.md) for publication checks and remaining findings. The tested TGZ is a release asset; dependencies and build output are excluded from Git.
