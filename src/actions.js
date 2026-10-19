// ─────────────────────────────────────────────

import { extraActions } from './extended-actions.js'
//  Actions
//
//  Commands are sent to the AIMP HTTP Remote Control plugin's WS server
//  as JSON frames `{ action, ...params }`.
// ─────────────────────────────────────────────

export function buildActions(instance) {
	const plChoices = instance.playlistChoices.length ? instance.playlistChoices : [{ id: '', label: '(no playlists)' }]

	const defaultPlId = plChoices[0]?.id ?? ''

	return {
		// ══════════════════════════════════════════
		//  PLAYER CONTROLS
		// ══════════════════════════════════════════

		play: {
			name: '▶ Play',
			options: [],
			callback: async () => {
				await instance._send('player/play')
			},
		},
		pause: {
			name: '⏸ Pause',
			options: [],
			callback: async () => {
				await instance._send('player/pause')
			},
		},
		play_pause: {
			name: '▶⏸ Play / Pause Toggle',
			options: [],
			callback: async () => {
				if (instance.state.playerState === 'playing') {
					await instance._send('player/pause')
				} else {
					await instance._send('player/play')
				}
			},
		},
		stop: {
			name: '⏹ Stop',
			options: [],
			callback: async () => {
				await instance._send('player/stop')
			},
		},
		next: {
			name: '⏭ Next Track',
			options: [],
			callback: async () => {
				await instance._send('player/next')
			},
		},
		prev: {
			name: '⏮ Previous Track',
			options: [],
			callback: async () => {
				await instance._send('player/prev')
			},
		},

		// ══════════════════════════════════════════
		//  VOLUME & MUTE
		// ══════════════════════════════════════════

		mute_toggle: {
			name: '🔇 Mute Toggle',
			options: [],
			callback: async () => {
				await instance._send('player/mute')
			},
		},
		set_volume: {
			name: '🔊 Set Volume (absolute)',
			options: [{ type: 'number', id: 'volume', label: 'Volume (0–100)', default: 50, min: 0, max: 100 }],
			callback: async (action) => {
				await instance._send('player/volume/set', { volume: action.options.volume })
			},
		},
		volume_up: {
			name: '🔊 Volume Up',
			options: [{ type: 'number', id: 'step', label: 'Step', default: 5, min: 1, max: 50 }],
			callback: async (action) => {
				const next = Math.min(100, Math.round(instance.state.volume) + (action.options.step ?? 5))
				await instance._send('player/volume/set', { volume: next })
			},
		},
		volume_down: {
			name: '🔉 Volume Down',
			options: [{ type: 'number', id: 'step', label: 'Step', default: 5, min: 1, max: 50 }],
			callback: async (action) => {
				const next = Math.max(0, Math.round(instance.state.volume) - (action.options.step ?? 5))
				await instance._send('player/volume/set', { volume: next })
			},
		},

		// ══════════════════════════════════════════
		//  SHUFFLE / REPEAT / AUTO-JUMP
		// ══════════════════════════════════════════

		shuffle_toggle: {
			name: '🔀 Shuffle Toggle',
			options: [],
			callback: async () => {
				await instance._send('player/shuffle/toggle')
			},
		},
		repeat_toggle: {
			name: '🔁 Repeat Toggle',
			options: [],
			callback: async () => {
				await instance._send('player/repeat/toggle')
			},
		},
		auto_jump_toggle: {
			name: '⏭ Auto Jump Toggle',
			options: [],
			callback: async () => {
				await instance._send('player/auto-jump/toggle')
			},
		},

		// ══════════════════════════════════════════
		//  SEEK
		// ══════════════════════════════════════════

		seek_seconds: {
			name: '⏩ Seek to Position (seconds)',
			options: [{ type: 'number', id: 'position', label: 'Position (s)', default: 0, min: 0, max: 36000 }],
			callback: async (action) => {
				await instance._send('player/position/set', { position: action.options.position })
			},
		},
		seek_percent: {
			name: '⏩ Seek to Position (%)',
			options: [{ type: 'number', id: 'percent', label: 'Percent (0–100)', default: 0, min: 0, max: 100 }],
			callback: async (action) => {
				if (instance.state.duration > 0) {
					const pos = (action.options.percent / 100) * instance.state.duration
					await instance._send('player/position/set', { position: pos })
				}
			},
		},

		// ══════════════════════════════════════════
		//  FOCUS NAVIGATION
		// ══════════════════════════════════════════

		focus_playlist_next: {
			name: '▶ Focus: Next Playlist',
			options: [],
			callback: async () => {
				await instance._send('focus/playlist/next')
			},
		},
		focus_playlist_prev: {
			name: '◀ Focus: Previous Playlist',
			options: [],
			callback: async () => {
				await instance._send('focus/playlist/prev')
			},
		},
		focus_track_next: {
			name: '▶ Focus: Next Track',
			options: [],
			callback: async () => {
				await instance._send('focus/track/next')
			},
		},
		focus_track_prev: {
			name: '◀ Focus: Previous Track',
			options: [],
			callback: async () => {
				await instance._send('focus/track/prev')
			},
		},
		focus_play: {
			name: '▶ Focus: Play Focused Track',
			options: [],
			callback: async () => {
				await instance._send('focus/play')
			},
		},

		// ══════════════════════════════════════════
		//  PLAYLIST ACTIONS
		// ══════════════════════════════════════════

		playlist_play: {
			name: '▶ Playlist: Play from Beginning',
			options: [{ type: 'dropdown', id: 'playlistId', label: 'Playlist', choices: plChoices, default: defaultPlId }],
			callback: async (action) => {
				const idx = instance._playlistIndex(action.options.playlistId)
				if (idx == null) return
				await instance._send('playlists/play', { playlist_id: idx })
			},
		},
		playlist_select: {
			name: '☑ Playlist: Select (activate tab)',
			options: [{ type: 'dropdown', id: 'playlistId', label: 'Playlist', choices: plChoices, default: defaultPlId }],
			callback: async (action) => {
				const idx = instance._playlistIndex(action.options.playlistId)
				if (idx == null) return
				await instance._send('playlists/select', { playlist_id: idx })
			},
		},
		playlist_action: {
			name: '🎶 Playlist: Play or Focus',
			options: [
				{
					type: 'dropdown',
					id: 'playlistId',
					label: 'Playlist',
					choices: plChoices,
					default: defaultPlId,
				},
				{
					type: 'dropdown',
					id: 'action',
					label: 'Action',
					choices: [
						{ id: 'play', label: '▶ Play from beginning' },
						{ id: 'select', label: '☑ Set focus (select tab)' },
					],
					default: 'play',
				},
			],
			callback: async (action) => {
				const idx = instance._playlistIndex(action.options.playlistId)
				if (idx == null) return
				if (action.options.action === 'play') {
					await instance._send('playlists/play', { playlist_id: idx })
				} else {
					await instance._send('playlists/select', { playlist_id: idx })
				}
			},
		},

		// ══════════════════════════════════════════
		//  PLAYLIST TRACK NAVIGATION
		// ══════════════════════════════════════════

		playlist_track_next: {
			name: '⏭ Playlist: Next Track (in playlist)',
			options: [{ type: 'dropdown', id: 'playlistId', label: 'Playlist', choices: plChoices, default: defaultPlId }],
			callback: async (action) => {
				const aimpId = action.options.playlistId
				const plIdx = instance._playlistIndex(aimpId)
				if (plIdx == null) return
				await instance._ensureTracksLoaded(aimpId)
				const tracks = instance.tracksCache[String(aimpId)]
				if (!tracks || tracks.length === 0) return
				const currentTrackId =
					String(instance.state.playingPlaylistId) === String(aimpId)
						? instance.state.playingTrackId
						: instance.state.focusTrackId
				const currentIdx = tracks.findIndex((t) => t.id === currentTrackId)
				const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % tracks.length : 0
				const trackApiIdx = instance._trackIndex(aimpId, tracks[nextIdx].id)
				if (trackApiIdx == null) return
				await instance._send('playlists/track/play', { playlist_id: plIdx, track_id: trackApiIdx })
			},
		},
		playlist_track_prev: {
			name: '⏮ Playlist: Previous Track (in playlist)',
			options: [{ type: 'dropdown', id: 'playlistId', label: 'Playlist', choices: plChoices, default: defaultPlId }],
			callback: async (action) => {
				const aimpId = action.options.playlistId
				const plIdx = instance._playlistIndex(aimpId)
				if (plIdx == null) return
				await instance._ensureTracksLoaded(aimpId)
				const tracks = instance.tracksCache[String(aimpId)]
				if (!tracks || tracks.length === 0) return
				const currentTrackId =
					String(instance.state.playingPlaylistId) === String(aimpId)
						? instance.state.playingTrackId
						: instance.state.focusTrackId
				const currentIdx = tracks.findIndex((t) => t.id === currentTrackId)
				const prevIdx = currentIdx > 0 ? currentIdx - 1 : tracks.length - 1
				const trackApiIdx = instance._trackIndex(aimpId, tracks[prevIdx].id)
				if (trackApiIdx == null) return
				await instance._send('playlists/track/play', { playlist_id: plIdx, track_id: trackApiIdx })
			},
		},

		// ══════════════════════════════════════════
		//  TRACK ACTIONS
		// ══════════════════════════════════════════

		track_action: {
			name: '🎵 Track: Play or Focus (enter track index)',
			options: [
				{ type: 'dropdown', id: 'playlistId', label: 'Playlist', choices: plChoices, default: defaultPlId },
				{ type: 'number', id: 'trackId', label: 'Track index (0-based)', default: 0, min: 0, max: 99999 },
				{
					type: 'dropdown',
					id: 'action',
					label: 'Action',
					choices: [
						{ id: 'play', label: '▶ Play track' },
						{ id: 'select', label: '☑ Set focus (select)' },
					],
					default: 'play',
				},
			],
			callback: async (action) => {
				const { playlistId, trackId, action: act } = action.options
				const idx = instance._playlistIndex(playlistId)
				if (idx == null) return
				const command = act === 'select' ? 'playlists/track/select' : 'playlists/track/play'
				await instance._send(command, { playlist_id: idx, track_id: trackId })
			},
		},

		...extraActions(instance, plChoices, defaultPlId),
	}
}
