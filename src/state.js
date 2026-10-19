// ─────────────────────────────────────────────
//  Initial state
// ─────────────────────────────────────────────

export function buildInitialState() {
	return {
		playerState: 'stopped',
		volume: 50,
		muted: false,
		position: 0,
		duration: 0,

		// Playing — keyed by playlist aimp_id and track file_path
		playingPlaylistId: '', // aimp_id (GUID)
		playingPlaylistName: '',
		playingTrackId: '', // file_path (stable identifier)
		playingTrackTitle: '',
		playingTrackArtist: '',

		// Focus — keyed by playlist aimp_id and track file_path
		focusPlaylistId: '', // aimp_id (GUID)
		focusPlaylistName: '',
		focusTrackId: '', // file_path (stable identifier)
		focusTrackIndex: 0,
		focusTrackTitle: '',
		focusTrackArtist: '',

		// Next track (from API)
		nextTrackTitle: '',
		nextTrackArtist: '',

		// Shuffle / Repeat / Auto-jump
		shuffle: false,
		repeat: false,
		autoJump: false,

		// Internal — change tracking by aimp_id
		_playlistAimpIds: '',
	}
}
