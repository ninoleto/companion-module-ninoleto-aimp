# Companion beta.4 client integration

The module keeps existing action, feedback and preset IDs. New controls are registered from the connected bridge's capability catalogs. Older plugins keep their established controls; unknown `capabilities/get` is an expected legacy response.

## Loading and connection lifecycle

`AIMP_LOADING` during startup is retried every 500 ms for up to 30 seconds. Startup remains Connecting while waiting. Disconnects invalidate the current generation, queued commands and all media/library timers. Writes are not replayed.

## Media

Capabilities: `media.artwork`, `media.lyrics`, `media.synchronized_lyrics`, with byte/dimension/line bounds.

`extensions/get` carries only the lightweight `media` summary, including the native opaque `track_key`. Artwork and lyric content are requested separately with `media/artwork/get` and `media/lyrics/get`, both carrying `expected_track_key`. Stale content replies cannot replace the current track's display. Artwork accepts bounded PNG data only, up to 262144 bytes and 144 pixels per side. The module does not fetch artwork or lyric URLs itself.

Content requests run once per track, followed by 500 ms polling only while pending, for at most 30 seconds. Missing/error results require a track change or manual refresh to retry. Artwork is cached for eight track identities. Once synchronized lyrics are ready, a lightweight `include_content:false` request runs every 500 ms while playing and only when the command channel is idle. Native current/previous/next lines remain authoritative.

The Companion 5 artwork feedback is a value feedback returning a PNG data URI, bound to the image element through a preset-local feedback variable. Image data is not copied into the public variable table.

## Music library

`musiclibrary/storages/get`, `fields/get`, and the capability catalog identify queryable storage providers. The browser supports search, up to eight JSON filters, three sort fields, 100 results per page, offset providers and opaque provider cursors. Query startup returns an ID; `query/get` polls pending work every 500 ms for up to 30 seconds. Cancellation remains pending until the native worker acknowledges it.

Previous-page navigation uses up to 16 retained query IDs. Fixed page-slot presets show live row variables and select the current slot. Play/Add/Queue buttons resolve the currently selected row into `{query_id,row_id}` at execution. Manually configured fixed-row actions additionally require the matching query ID, preventing a copied old button from addressing a different later result.

Queue operations are labeled as requiring a track already present in a loaded playlist. Cached-row operations never accept an arbitrary URI from the client.

Optional storage commands, row marking/reloading/database removal, and grouping-tree UI operations are capability-filtered. Queued native operation status is polled once per second for up to one minute; a manual status refresh remains available. Database removal requires explicit confirmation and preserves the media file.

## Playlist sources and file tags

Playlist and track targets preserve the existing focused/playing/explicit semantics. Saved playlist IDs are resolved to the current native index at execution. Source creation accepts explicit folder JSON or a saved playlist URI, with synchronization settings supplied by the user.

Tag writes require an explicit confirmation checkbox. Each action first reads `tags/get` and then supplies the exact returned `expected_file_path` to `tags/write`, allowing the native bridge to reject focus/file changes between those requests. Tag fields and types come from `capabilities.tags.fields`; no generic private-property writer is provided.

## Application controls

Window operations use advertised SDK window identities. Registered action execution first inspects the supplied action ID and rejects unavailable/disabled actions. Quit, playlist cleanup, EQ preset rename/delete and database record removal use explicit confirmation fields. Queued acknowledgements are displayed as queued, not as completed operations.

Skin selection is limited to enumerated installed skins or AIMP's default. Hue/intensity adjustments use native atomic commands and advertised bounds; the client does not invent a neutral reset value.
