# AIMP Companion Control — Companion module 1.0.0-beta.8

Pair with [native plugin 0.3.1 preview](https://github.com/ninoleto/AIMP-Companion-Control/releases/tag/v0.3.1-preview). Targets Companion 5 and stable AIMP 5.40. This is an independent prerelease fork.

Beta.8 fixes stale, unused playlist dropdown values blocking active/focused/playing actions before dispatch. Explicit targets and move/copy destinations still require a current identity. Two removal captions now accurately describe one focused track. Native 0.3.1 separately prevents absent focus from silently targeting track zero. Existing IDs, saved actions, rotary bindings and styling are retained.

The attached TGZ is the original supplied, tested package, unchanged. Publication adds documentation; it does not rebuild or repack the module. The TGZ retains its embedded dependency licence notices. Source, tests, lockfile, provenance and licences are committed; dependencies and build output are excluded from Git.

## Install

1. Keep the working native 0.2.1 / module beta.3 packages and export a Companion configuration backup.
2. Download native 0.3.1's AIMPPACK, checksum file and notices from the linked native release. Verify its checksum, fully close AIMP, install the AIMPPACK and restart AIMP.
3. Download `ninoleto-aimp-1.0.0-beta.8.tgz` and `SHA256SUMS.txt` here. Verify `Get-FileHash .\ninoleto-aimp-1.0.0-beta.8.tgz -Algorithm SHA256` against the digest below.
4. In Companion 5, use **Modules → Import module package** and select the TGZ without extracting it. Select beta.8 on the existing **ninoleto: AIMP Companion Control** connection, preserving its label, working host and port, then enable/save it.
5. Test existing controls and the focused removal behavior on a disposable playlist. Drag fresh Unqueue/Remove Focused Track presets to obtain their corrected captions; copied artwork remains as saved. These six Remove/Clear/Close Playlist presets do not require confirmation; Close AIMP and tag writes have their own explicit confirmation.

```text
6bb1e2d6cc6c0c5d789e12720f2b5768cd21526fab6f6260194c76d9de9a614e  ninoleto-aimp-1.0.0-beta.8.tgz
```

The TGZ is for Companion; the AIMPPACK is for AIMP. Fresh native settings default to `127.0.0.1:19122`; retain working settings when updating.

## Verification and known limits

Publication checks on Node 22.23.3: **102 tests passed**, zero failures/skips; official checker passed. The actual Companion host loaded the supplied TGZ against a simulated WebSocket server: **192 actions, 46 feedbacks, 503 presets, 624 variables**, zero unexpected warnings and two separately expected diagnostics. Saved stale removal presets, read-only failures and earlier regressions passed. All 123 original module inventory digests and the packaged main.js hash matched. See [supplied verification](https://github.com/ninoleto/companion-module-ninoleto-aimp/blob/v1.0.0-beta.8/VERIFICATION.md) and [final review](https://github.com/ninoleto/companion-module-ninoleto-aimp/blob/v1.0.0-beta.8/docs/FINAL-REVIEW.md).

- These are mock-host tests, not complete Windows AIMP validation. Actual installation, focus/group UI, SDK operations, reconnect and shutdown/reload still need testing. AIMP 6 beta is unvalidated. The supplied native cross-build/ASan/UBSan/SDK-double checks were not rerun during publication; leak detection was disabled in the supplied native tests. PowerShell diagnostics were parsed but not run against AIMP.
- **Visualisation Start** remains an unresolved runtime report.
- Cached GUID-to-numeric-index mapping can race external playlist reordering. Refresh inventory and avoid concurrent reordering during cues; the native protocol has no atomic expected-GUID precondition.
- Native DLLs are unsigned; Microsoft Defender scanning and publisher signing were not performed. No Defender clearance is claimed.
- A rare failed SDK cancellation/reentrant native unload may retain the plugin until AIMP exits; fully restart before replacing it.
- The bridge uses WebSocket without TLS/token authentication on a trusted local network with an IPv4 allowlist. Focused removal affects one track, empty queue actions may show no effect, and read-only protection remains. Async acknowledgements mean accepted/queued; providers, media formats, skins and SDK capabilities limit operations as documented in the README/contracts.

To roll back, fully close AIMP, reinstall the retained native 0.2.1 package and restart AIMP, then select beta.3 on the same Companion connection. Restore the saved Companion configuration if needed.
