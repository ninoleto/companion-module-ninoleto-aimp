import { getFeatureVariableDefinitions, getFeatureVariableValues } from './feature-controls.js'
import { initialInspectionResults, inspectionVariableDefinitions } from './inspection-results.js'
// ─────────────────────────────────────────────
//  Variables
// ─────────────────────────────────────────────

function fmtTime(seconds) {
	if (!seconds || seconds < 0) seconds = 0
	const m = Math.floor(seconds / 60)
	const s = Math.floor(seconds % 60)
	return `${m}:${s.toString().padStart(2, '0')}`
}

export function registerVariables(instance) {
	instance.setVariableDefinitions({
		...getFeatureVariableDefinitions(instance),
		...inspectionVariableDefinitions(),
		connected: { name: 'Connected to AIMP (true/false)' },
		connection_status: { name: 'Connection status / diagnostic' },
		endpoint: { name: 'WebSocket endpoint' },
		last_command_error: { name: 'Last command error' },
		last_response: { name: 'Last requested response (JSON, max 4096 characters)' },
		library_status: { name: 'Library load status / track limit warning' },
		playlist_count: { name: 'Loaded playlist count' },
		loaded_track_count: { name: 'Loaded track count' },
		focus_track_number: { name: 'Focused track number (1-based; 0 = none)' },
		playing_track_number: { name: 'Playing track number (1-based; 0 = none)' },
		player_state: { name: 'Player State (playing/paused/stopped)' },
		volume_pct: { name: 'Volume (0–100)' },
		muted: { name: 'Muted (true/false)' },
		shuffle: { name: 'Shuffle (true/false)' },
		repeat: { name: 'Repeat (true/false)' },
		auto_jump: { name: 'Auto Jump (true/false)' },
		position: { name: 'Position (s)' },
		position_fmt: { name: 'Position (mm:ss)' },
		duration: { name: 'Duration (s)' },
		duration_fmt: { name: 'Duration (mm:ss)' },
		remaining: { name: 'Remaining (s)' },
		remaining_fmt: { name: 'Remaining (mm:ss)' },
		progress_pct: { name: 'Progress (%)' },
		playing_track_title: { name: 'Playing Track Title' },
		playing_track_artist: { name: 'Playing Track Artist' },
		playing_playlist_id: { name: 'Playing Playlist AIMP ID' },
		playing_playlist_name: { name: 'Playing Playlist Name' },
		playing_track_id: { name: 'Playing Track ID' },
		focus_playlist_id: { name: 'Focus Playlist AIMP ID' },
		focus_playlist_name: { name: 'Focus Playlist Name' },
		focus_track_id: { name: 'Focus Track ID' },
		focus_track_index: { name: 'Focus Track Index (0-based)' },
		focus_track_title: { name: 'Focus Track Title' },
		focus_track_artist: { name: 'Focus Track Artist' },
		next_track_title: { name: 'Next Track Title' },
		next_track_artist: { name: 'Next Track Artist' },
	})
}

export function updateVariables(instance) {
	const s = instance.state
	const remaining = Math.max(0, s.duration - s.position)
	const progress = s.duration > 0 ? Math.round((s.position / s.duration) * 100) : 0

	instance.setVariableValues({
		...getFeatureVariableValues(instance),
		...(instance.inspectionResults || initialInspectionResults()),
		connected: !!s.connected,
		connection_status: s.connectionStatus,
		endpoint: s.endpoint,
		last_command_error: s.lastCommandError,
		last_response: s.lastResponse,
		library_status: s.libraryStatus,
		playlist_count: s.playlistCount,
		loaded_track_count: s.loadedTrackCount,
		focus_track_number: (s.focusTrackIndex ?? -1) + 1,
		playing_track_number: (s.playingTrackIndex ?? -1) + 1,
		player_state: s.playerState,
		volume_pct: Math.round(s.volume),
		muted: s.muted,
		position: s.position.toFixed(1),
		position_fmt: fmtTime(s.position),
		duration: s.duration.toFixed(1),
		duration_fmt: fmtTime(s.duration),
		remaining: remaining.toFixed(1),
		remaining_fmt: fmtTime(remaining),
		progress_pct: progress,
		shuffle: s.shuffle,
		repeat: s.repeat,
		auto_jump: s.autoJump,
		playing_track_title: s.playingTrackTitle,
		playing_track_artist: s.playingTrackArtist,
		playing_playlist_id: s.playingPlaylistId,
		playing_playlist_name: s.playingPlaylistName,
		playing_track_id: s.playingTrackId,
		focus_playlist_id: s.focusPlaylistId,
		focus_playlist_name: s.focusPlaylistName,
		focus_track_id: s.focusTrackId,
		focus_track_index: s.focusTrackIndex,
		focus_track_title: s.focusTrackTitle,
		focus_track_artist: s.focusTrackArtist,
		next_track_title: s.nextTrackTitle,
		next_track_artist: s.nextTrackArtist,
	})
}
